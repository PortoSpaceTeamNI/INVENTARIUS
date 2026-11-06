// Package auth handles Google sign-in (restricted to the team's Workspace
// domain), server-side sessions, and the development-only login.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"inventarius/internal/config"
	"inventarius/internal/db"
)

const (
	sessionCookie = "inv_session"
	flowCookie    = "inv_oauth"
)

// User is the signed-in user, as seen by handlers.
type User struct {
	db.User
	DepartmentIDs []int64 `json:"department_ids"`
}

func (u *User) IsAdmin() bool { return u.Role == "admin" }

type Auth struct {
	cfg   config.Config
	store *db.Store

	mu       sync.Mutex
	oauth    *oauth2.Config
	verifier *oidc.IDTokenVerifier
}

func New(cfg config.Config, store *db.Store) *Auth {
	return &Auth{cfg: cfg, store: store}
}

func (a *Auth) secure() bool { return strings.HasPrefix(a.cfg.BaseURL, "https://") }

// Routes registers the /auth/ endpoints.
func (a *Auth) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/methods", a.methods)
	mux.HandleFunc("POST /auth/logout", a.logout)
	if a.cfg.GoogleClientID != "" {
		mux.HandleFunc("GET /auth/google", a.googleStart)
		mux.HandleFunc("GET /auth/callback", a.googleCallback)
	}
	if a.cfg.DevAuth {
		mux.HandleFunc("GET /auth/dev/users", a.devUsers)
		mux.HandleFunc("POST /auth/dev/login", a.devLogin)
	}
}

func (a *Auth) methods(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"google": a.cfg.GoogleClientID != "",
		"dev":    a.cfg.DevAuth,
		"domain": a.cfg.AllowedDomain,
	})
}

// provider sets up OIDC lazily, so the server starts even when Google is
// unreachable (the room PC's network is not always up).
func (a *Auth) provider(ctx context.Context) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.oauth != nil {
		return a.oauth, a.verifier, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	p, err := oidc.NewProvider(ctx, "https://accounts.google.com")
	if err != nil {
		return nil, nil, err
	}
	a.oauth = &oauth2.Config{
		ClientID:     a.cfg.GoogleClientID,
		ClientSecret: a.cfg.GoogleClientSecret,
		Endpoint:     p.Endpoint(),
		RedirectURL:  a.cfg.BaseURL + "/auth/callback",
		Scopes:       []string{oidc.ScopeOpenID, "email", "profile"},
	}
	a.verifier = p.Verifier(&oidc.Config{ClientID: a.cfg.GoogleClientID})
	return a.oauth, a.verifier, nil
}

type flowState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Next     string `json:"x"`
}

func (a *Auth) googleStart(w http.ResponseWriter, r *http.Request) {
	oc, _, err := a.provider(r.Context())
	if err != nil {
		slog.Error("google oidc discovery", "err", err)
		http.Error(w, "Google sign-in is unreachable right now", http.StatusBadGateway)
		return
	}
	f := flowState{State: randomToken(), Nonce: randomToken(), Verifier: oauth2.GenerateVerifier(), Next: safeNext(r.URL.Query().Get("next"))}
	b, _ := json.Marshal(f)
	http.SetCookie(w, &http.Cookie{
		Name: flowCookie, Value: base64.RawURLEncoding.EncodeToString(b), Path: "/auth/",
		MaxAge: 600, HttpOnly: true, Secure: a.secure(), SameSite: http.SameSiteLaxMode,
	})
	opts := []oauth2.AuthCodeOption{
		oidc.Nonce(f.Nonce),
		oauth2.S256ChallengeOption(f.Verifier),
		// Pre-selects the domain in Google's account picker; the server
		// still checks the hd claim below.
		oauth2.SetAuthURLParam("hd", a.cfg.AllowedDomain),
		oauth2.SetAuthURLParam("prompt", "select_account"),
	}
	http.Redirect(w, r, oc.AuthCodeURL(f.State, opts...), http.StatusFound)
}

func (a *Auth) googleCallback(w http.ResponseWriter, r *http.Request) {
	fail := func(msg string, err error) {
		if err != nil {
			slog.Warn("google login failed", "reason", msg, "err", err)
		}
		http.Redirect(w, r, "/login?error="+url.QueryEscape(msg), http.StatusFound)
	}
	c, err := r.Cookie(flowCookie)
	if err != nil {
		fail("Login expired, try again.", nil)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: flowCookie, Path: "/auth/", MaxAge: -1})
	var f flowState
	if b, err := base64.RawURLEncoding.DecodeString(c.Value); err != nil || json.Unmarshal(b, &f) != nil {
		fail("Login expired, try again.", nil)
		return
	}
	if r.URL.Query().Get("state") != f.State || f.State == "" {
		fail("Login expired, try again.", nil)
		return
	}
	oc, verifier, err := a.provider(r.Context())
	if err != nil {
		fail("Google sign-in is unreachable right now.", err)
		return
	}
	tok, err := oc.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(f.Verifier))
	if err != nil {
		fail("Google sign-in failed.", err)
		return
	}
	raw, _ := tok.Extra("id_token").(string)
	idt, err := verifier.Verify(r.Context(), raw)
	if err != nil || idt.Nonce != f.Nonce {
		fail("Google sign-in failed.", err)
		return
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		HD            string `json:"hd"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := idt.Claims(&claims); err != nil {
		fail("Google sign-in failed.", err)
		return
	}
	if err := a.checkAccount(claims.Email, claims.EmailVerified, claims.HD); err != nil {
		fail(err.Error(), nil)
		return
	}
	u, err := a.upsertUser(r.Context(), claims.Email, claims.Name, claims.Picture)
	if err != nil {
		fail(err.Error(), err)
		return
	}
	if err := a.startSession(w, r, u.ID); err != nil {
		fail("Could not start session.", err)
		return
	}
	http.Redirect(w, r, f.Next, http.StatusFound)
}

// checkAccount allows only verified accounts of the team's Workspace.
func (a *Auth) checkAccount(email string, verified bool, hd string) error {
	domain := strings.ToLower(a.cfg.AllowedDomain)
	if !verified || !strings.EqualFold(hd, domain) || !strings.HasSuffix(strings.ToLower(email), "@"+domain) {
		return fmt.Errorf("Only @%s accounts can sign in.", domain)
	}
	return nil
}

// upsertUser finds or creates the user. New users are members, except those
// listed in INVENTARIUS_ADMINS and the very first user, who become admins.
func (a *Auth) upsertUser(ctx context.Context, email, name, picture string) (db.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	u, err := a.store.GetUserByEmail(ctx, email)
	if err == nil {
		if !u.Active {
			return u, errors.New("This account has been disabled.")
		}
		if u.Name != name || u.Picture != picture {
			a.store.UpdateUserProfile(ctx, db.UpdateUserProfileParams{Name: name, Picture: picture, ID: u.ID})
		}
		return u, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return u, err
	}
	role := "member"
	n, err := a.store.CountUsers(ctx)
	if err != nil {
		return u, err
	}
	if n == 0 || slices.Contains(a.cfg.Admins, email) {
		role = "admin"
	}
	return a.store.CreateUser(ctx, db.CreateUserParams{Email: email, Name: name, Picture: picture, Role: role})
}

func (a *Auth) startSession(w http.ResponseWriter, r *http.Request, userID int64) error {
	token := randomToken()
	err := a.store.CreateSession(r.Context(), db.CreateSessionParams{
		TokenHash: hashToken(token), UserID: userID, ExpiresAt: time.Now().Add(a.cfg.SessionTTL).UTC(),
	})
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", MaxAge: int(a.cfg.SessionTTL.Seconds()),
		HttpOnly: true, Secure: a.secure(), SameSite: http.SameSiteLaxMode,
	})
	return nil
}

func (a *Auth) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.store.DeleteSession(r.Context(), hashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

// devUsers lists users to pick from on the development login page.
func (a *Auth) devUsers(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListUsers(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, users)
}

// devLogin signs in as any email, creating the user if needed. Only
// registered with INVENTARIUS_DEV_AUTH=1.
func (a *Auth) devLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !strings.Contains(body.Email, "@") {
		http.Error(w, "email required", http.StatusBadRequest)
		return
	}
	if !strings.HasSuffix(strings.ToLower(body.Email), "@"+strings.ToLower(a.cfg.AllowedDomain)) {
		http.Error(w, "only @"+a.cfg.AllowedDomain+" addresses", http.StatusForbidden)
		return
	}
	u, err := a.upsertUser(r.Context(), body.Email, body.Name, "")
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if err := a.startSession(w, r, u.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type ctxKey struct{}

// Middleware attaches the session's user to the request context, if any.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err == nil {
			row, err := a.store.GetSessionUser(r.Context(), db.GetSessionUserParams{
				TokenHash: hashToken(c.Value), ExpiresAt: time.Now().UTC(),
			})
			if err == nil {
				deps, _ := a.store.ListUserDepartmentIDs(r.Context(), row.User.ID)
				u := &User{User: row.User, DepartmentIDs: deps}
				r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// FromContext returns the signed-in user, or nil.
func FromContext(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}

// CleanupSessions deletes expired sessions periodically until ctx ends.
func (a *Auth) CleanupSessions(ctx context.Context) {
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		a.store.DeleteExpiredSessions(ctx, time.Now().UTC())
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// safeNext only allows local paths as the post-login redirect.
func safeNext(next string) string {
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, "/\\") {
		return "/"
	}
	return next
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
