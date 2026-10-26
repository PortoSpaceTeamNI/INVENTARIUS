// Package api is the JSON HTTP API under /api/, plus label-code redirects
// and the single-page frontend.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"inventarius/internal/auth"
	"inventarius/internal/codes"
	"inventarius/internal/config"
	"inventarius/internal/db"
	"inventarius/internal/inventory"
	"inventarius/internal/parts"
	"inventarius/internal/printqueue"
)

type Server struct {
	cfg   config.Config
	store *db.Store
	inv   *inventory.Service
	auth  *auth.Auth
	queue *printqueue.Queue
	web   fs.FS         // built frontend; nil in tests
	parts *parts.Mouser // nil without an API key

	departments []db.Department // static seed data, loaded once
}

func New(ctx context.Context, cfg config.Config, store *db.Store, a *auth.Auth, q *printqueue.Queue, web fs.FS) (*Server, error) {
	deps, err := store.ListDepartments(ctx)
	if err != nil {
		return nil, err
	}
	srv := &Server{
		cfg: cfg, store: store, inv: &inventory.Service{Store: store}, auth: a, queue: q, web: web,
		departments: deps,
	}
	if cfg.MouserAPIKey != "" {
		srv.parts = &parts.Mouser{APIKey: cfg.MouserAPIKey}
	}
	return srv, nil
}

func (s *Server) photoDir() string { return filepath.Join(s.cfg.DataDir, "photos") }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.auth.Routes(mux)

	h := s.handle
	mux.Handle("GET /api/me", h(s.me))
	mux.Handle("PUT /api/me/departments", h(s.setMyDepartments))
	mux.Handle("GET /api/meta", h(s.meta))
	mux.Handle("GET /api/users", h(s.listUsers))
	mux.Handle("PATCH /api/users/{id}", h(s.updateUser))

	mux.Handle("GET /api/search", h(s.search))
	mux.Handle("GET /api/parts", h(s.partLookup))
	mux.Handle("GET /api/parts/image", h(s.partImage))
	mux.Handle("GET /api/codes/{code}", h(s.resolveCode))

	mux.Handle("GET /api/locations", h(s.listLocations))
	mux.Handle("GET /api/locations/counts", h(s.locationCounts))
	mux.Handle("POST /api/locations", h(s.createLocation))
	mux.Handle("POST /api/locations/range", h(s.createLocationRange))
	mux.Handle("GET /api/locations/{id}", h(s.getLocation))
	mux.Handle("PATCH /api/locations/{id}", h(s.updateLocation))
	mux.Handle("DELETE /api/locations/{id}", h(s.deleteLocation))

	mux.Handle("GET /api/categories", h(s.listCategories))
	mux.Handle("GET /api/categories/counts", h(s.categoryCounts))
	mux.Handle("POST /api/categories", h(s.createCategory))
	mux.Handle("PATCH /api/categories/{id}", h(s.updateCategory))
	mux.Handle("DELETE /api/categories/{id}", h(s.deleteCategory))

	mux.Handle("GET /api/items", h(s.listItems))
	mux.Handle("POST /api/items", h(s.createItem))
	mux.Handle("GET /api/items/{id}", h(s.getItem))
	mux.Handle("PATCH /api/items/{id}", h(s.updateItem))
	mux.Handle("DELETE /api/items/{id}", h(s.deleteItem))
	mux.Handle("PUT /api/items/{id}/photo", h(s.uploadPhoto))

	mux.Handle("POST /api/stock", h(s.receiveStock))
	mux.Handle("GET /api/stock/{id}", h(s.getStock))
	mux.Handle("PATCH /api/stock/{id}", h(s.updateStock))
	mux.Handle("DELETE /api/stock/{id}", h(s.deleteStock))
	mux.Handle("POST /api/stock/{id}/{op}", h(s.stockOp))

	mux.Handle("POST /api/assets", h(s.createAsset))
	mux.Handle("GET /api/assets/{id}", h(s.getAsset))
	mux.Handle("PATCH /api/assets/{id}", h(s.updateAsset))
	mux.Handle("DELETE /api/assets/{id}", h(s.deleteAsset))
	mux.Handle("POST /api/assets/{id}/borrow", h(s.borrowAsset))
	mux.Handle("POST /api/assets/{id}/return", h(s.returnAsset))

	mux.Handle("POST /api/reservations", h(s.reserve))
	mux.Handle("POST /api/reservations/{id}/release", h(s.release))

	mux.Handle("GET /api/loans", h(s.listLoans))
	mux.Handle("GET /api/movements", h(s.listMovements))

	mux.Handle("GET /api/labels/{code}", h(s.labelPreview))
	mux.Handle("POST /api/print", h(s.print))
	mux.Handle("GET /api/print/jobs", h(s.listPrintJobs))
	mux.Handle("GET /api/print/queue", h(s.printQueue))
	mux.Handle("POST /api/print/cancel", h(s.cancelPrints))
	mux.Handle("GET /api/print/hold", h(s.printHold))
	mux.Handle("PUT /api/print/hold", h(s.printHold))
	mux.Handle("POST /api/print/flush", h(s.flushPrints))
	mux.Handle("POST /api/print/jobs/{id}/{op}", h(s.printJobOp))
	mux.Handle("GET /api/printer", h(s.printerStatus))
	mux.Handle("POST /api/printer/tape", h(s.newTapeRoll))

	mux.Handle("POST /api/import/items", h(s.importItems))

	mux.Handle("GET /photos/{name}", s.requireUser(http.StripPrefix("/photos/", http.FileServer(http.Dir(s.photoDir())))))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "no such endpoint")
	})
	mux.HandleFunc("/", s.frontend)

	return s.auth.Middleware(securityHeaders(mux))
}

type handlerFunc func(w http.ResponseWriter, r *http.Request, u *auth.User) error

// handle requires a signed-in user and turns returned errors into JSON responses.
func (s *Server) handle(fn handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := auth.FromContext(r.Context())
		if u == nil {
			writeError(w, http.StatusUnauthorized, "sign in first")
			return
		}
		if err := fn(w, r, u); err != nil {
			s.writeErr(w, r, err)
		}
	})
}

func (s *Server) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.FromContext(r.Context()) == nil {
			http.Error(w, "sign in first", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// httpError is an error with a status code, returned by handlers.
type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string { return e.msg }

func badRequest(msg string) error { return &httpError{http.StatusBadRequest, msg} }
func forbidden(msg string) error  { return &httpError{http.StatusForbidden, msg} }

var errNotFound = &httpError{http.StatusNotFound, "not found"}

func (s *Server) writeErr(w http.ResponseWriter, r *http.Request, err error) {
	var he *httpError
	var ue *inventory.UserError
	var ce *inventory.ConflictError
	switch {
	case errors.As(err, &he):
		writeError(w, he.status, he.msg)
	case errors.As(err, &ue):
		writeError(w, http.StatusBadRequest, ue.Msg)
	case errors.As(err, &ce):
		// The client may confirm and retry with override_reserved.
		writeError(w, http.StatusConflict, ce.Msg)
	case errors.Is(err, inventory.ErrChanged):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, inventory.ErrNotFound), errors.Is(err, sql.ErrNoRows):
		writeError(w, http.StatusNotFound, "not found")
	case strings.Contains(err.Error(), "constraint failed"):
		slog.Info("constraint", "path", r.URL.Path, "err", err)
		writeError(w, http.StatusBadRequest, "invalid reference or value")
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, v any) error {
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(v)
}

func decode(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return badRequest("invalid JSON: " + err.Error())
	}
	return nil
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errNotFound
	}
	return id, nil
}

func queryInt(r *http.Request, key string) *int64 {
	v, err := strconv.ParseInt(r.URL.Query().Get(key), 10, 64)
	if err != nil {
		return nil
	}
	return &v
}

func limit(r *http.Request, def, max int64) int64 {
	if l := queryInt(r, "limit"); l != nil && *l > 0 {
		return min(*l, max)
	}
	return def
}

// owner is the JSON form of an owner on create/update requests.
type owner struct {
	OwnerProjectID    *int64 `json:"owner_project_id"`
	OwnerDepartmentID *int64 `json:"owner_department_id"`
}

func (o owner) inv() inventory.Owner {
	return inventory.Owner{ProjectID: o.OwnerProjectID, DepartmentID: o.OwnerDepartmentID}
}

// canEdit: admins edit anything; everyone edits team-owned things; project-
// and department-owned things are edited by members of that project or
// department.
func (s *Server) canEdit(u *auth.User, projectID, departmentID *int64) bool {
	if u.IsAdmin() || (projectID == nil && departmentID == nil) {
		return true
	}
	if departmentID != nil {
		return slices.Contains(u.DepartmentIDs, *departmentID)
	}
	for _, d := range s.departments {
		if d.ProjectID == *projectID && slices.Contains(u.DepartmentIDs, d.ID) {
			return true
		}
	}
	return false
}

func (s *Server) checkEdit(u *auth.User, projectID, departmentID *int64) error {
	if !s.canEdit(u, projectID, departmentID) {
		return forbidden("only its owners can change this")
	}
	return nil
}

func requireAdmin(u *auth.User) error {
	if !u.IsAdmin() {
		return forbidden("admins only")
	}
	return nil
}

var codePath = regexp.MustCompile(`^/([LlIiSsAa][1-9][0-9]*)$`)

// frontend serves the single-page app. Paths that are label codes (what a
// QR code opens, e.g. /A107) redirect to the in-app page for that code.
func (s *Server) frontend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if m := codePath.FindStringSubmatch(r.URL.Path); m != nil {
		http.Redirect(w, r, "/c/"+strings.ToUpper(m[1]), http.StatusFound)
		return
	}
	if s.web == nil {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name != "" {
		if f, err := s.web.Open(name); err == nil {
			st, _ := f.Stat()
			f.Close()
			if !st.IsDir() {
				if strings.HasPrefix(name, "assets/") {
					// Vite puts content hashes in these names.
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				http.FileServerFS(s.web).ServeHTTP(w, r)
				return
			}
		}
	}
	// Any other path is a client-side route.
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, s.web, "index.html")
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		// Camera is needed for the scanner.
		h.Set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) labelURL(code string) string {
	return s.cfg.LabelURL + "/" + code
}

func codeOf(k codes.Kind, id int64) string { return codes.Format(k, id) }

func utcNow() time.Time { return time.Now().UTC() }
