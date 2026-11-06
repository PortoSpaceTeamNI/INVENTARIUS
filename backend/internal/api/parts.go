package api

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"

	"inventarius/internal/auth"
	"inventarius/internal/db"
	"inventarius/internal/parts"
	"inventarius/internal/search"
)

// partLookup answers GET /api/parts?mpn=GRM188R71H104KA93D with what the
// distributors' catalogues know about the part (description, datasheet,
// image, ...). Mouser and DigiKey are asked in turn; prefer=digikey asks
// DigiKey first (for a part from a DigiKey bag).
func (s *Server) partLookup(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if len(s.parts) == 0 {
		return &httpError{http.StatusServiceUnavailable,
			"part lookup is not set up (INVENTARIUS_MOUSER_API_KEY or INVENTARIUS_DIGIKEY_CLIENT_ID/SECRET)"}
	}
	mpn := strings.TrimSpace(r.URL.Query().Get("mpn"))
	if mpn == "" {
		return badRequest("mpn is required")
	}
	p, err := s.parts.Prefer(r.URL.Query().Get("prefer")).Lookup(r.Context(), mpn)
	if errors.Is(err, parts.ErrNotFound) {
		return &httpError{http.StatusNotFound, "part not found at the distributors"}
	} else if parts.Unreachable(err) {
		// Not err's text: it holds the request's URL, with Mouser's API key.
		slog.Warn("part lookup: distributors unreachable")
		return &httpError{http.StatusServiceUnavailable, "can't reach the distributors (no internet?): fill in the details by hand"}
	} else if err != nil {
		if strings.Contains(err.Error(), "Invalid unique identifier") {
			return &httpError{http.StatusBadGateway, "the Mouser API key is not valid"}
		}
		if strings.HasPrefix(err.Error(), "digikey: sign-in failed") {
			slog.Warn("digikey sign-in", "err", err)
			return &httpError{http.StatusBadGateway, "the DigiKey client ID or secret is not valid"}
		}
		return &httpError{http.StatusBadGateway, err.Error()}
	}
	out := struct {
		parts.Part
		// The team's category for this kind of part, if one exists...
		CategoryID *int64 `json:"category_id"`
		// ...otherwise a name for a new one ("Condensadores"), or "".
		NewCategory string `json:"new_category"`
		// Short text for labels ("Capacitors 1uF 0402").
		LabelText string `json:"label_text"`
	}{Part: p}
	g := parts.GroupOf(p.Category)
	out.LabelText = parts.ShortLabel(p, g)
	if g != nil {
		cats, err := s.store.ListCategories(r.Context())
		if err != nil {
			return err
		}
		out.CategoryID, out.NewCategory = matchCategory(cats, g)
	}
	return writeJSON(w, out)
}

// matchCategory finds a category named like g (in Portuguese or English, any
// level of the tree), or returns g's name to create one.
func matchCategory(cats []db.Category, g *parts.Group) (*int64, string) {
	for _, c := range cats {
		if slices.Contains(g.Names, search.Normalize(strings.TrimSpace(c.Name))) {
			return &c.ID, ""
		}
	}
	return nil, g.Name
}

// partImage answers GET /api/parts/image?url=... with a catalogue image, so
// the browser can make it the item's photo (the distributors do not allow
// fetching their images from other sites). Only Mouser and DigiKey image
// links are fetched.
func (s *Server) partImage(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	src, err := url.Parse(r.URL.Query().Get("url"))
	if err != nil || src.Scheme != "https" || src.User != nil || src.Port() != "" {
		return badRequest("not a distributor image link")
	}
	var links []string
	referer := ""
	switch h := src.Hostname(); {
	case hostIn(h, "mouser.com") && strings.HasPrefix(src.Path, "/images/"):
		// The API links a 150 px thumbnail; the product pages use a 600 px
		// version of the same photo under lrg/.
		links = []string{largeImage(src.String()), src.String()}
		referer = "https://www.mouser.com/"
	case (h == "mm.digikey.com" || h == "media.digikey.com") && path.Ext(src.Path) != "":
		links = []string{src.String()}
		referer = "https://www.digikey.com/"
	default:
		return badRequest("not a distributor image link")
	}
	var res *http.Response
	for _, link := range links {
		if res, err = fetchImage(r, link, referer); err == nil {
			break
		}
		slog.Info("part image", "url", link, "err", err)
	}
	if err != nil {
		return &httpError{http.StatusBadGateway, "could not fetch the image"}
	}
	defer res.Body.Close()
	ct := res.Header.Get("Content-Type")
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, err = io.Copy(w, io.LimitReader(res.Body, 10<<20))
	return err
}

// hostIn reports whether h is domain or one of its subdomains.
func hostIn(h, domain string) bool {
	return h == domain || strings.HasSuffix(h, "."+domain)
}

// largeImage turns .../images/<maker>/images/<file> into .../images/<maker>/lrg/<file>.
func largeImage(u string) string {
	return mouserThumb.ReplaceAllString(u, "/images/$1/lrg/")
}

var mouserThumb = regexp.MustCompile(`/images/([^/]+)/images/`)

func fetchImage(r *http.Request, u, referer string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// The distributors' image servers turn away requests that don't look like a browser.
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
	req.Header.Set("Accept", "image/jpeg,image/png,image/*;q=0.8")
	req.Header.Set("Referer", referer)
	res, err := parts.Client.Do(req)
	if err != nil {
		return nil, err
	}
	if ct := res.Header.Get("Content-Type"); res.StatusCode != http.StatusOK || !strings.HasPrefix(ct, "image/") {
		res.Body.Close()
		return nil, fmt.Errorf("HTTP %d, %s", res.StatusCode, ct)
	}
	return res, nil
}
