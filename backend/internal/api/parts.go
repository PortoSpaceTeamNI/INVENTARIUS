package api

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"inventarius/internal/auth"
	"inventarius/internal/db"
	"inventarius/internal/parts"
	"inventarius/internal/search"
)

// partLookup answers GET /api/parts?mpn=GRM188R71H104KA93D with what Mouser's
// catalogue knows about the part (description, datasheet, image, ...).
func (s *Server) partLookup(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if s.parts == nil {
		return &httpError{http.StatusServiceUnavailable, "part lookup is not set up (INVENTARIUS_MOUSER_API_KEY)"}
	}
	mpn := strings.TrimSpace(r.URL.Query().Get("mpn"))
	if mpn == "" {
		return badRequest("mpn is required")
	}
	p, err := s.parts.Lookup(r.Context(), mpn)
	if errors.Is(err, parts.ErrNotFound) {
		return &httpError{http.StatusNotFound, "part not found at Mouser"}
	} else if err != nil {
		if strings.Contains(err.Error(), "Invalid unique identifier") {
			return &httpError{http.StatusBadGateway, "the Mouser API key is not valid"}
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
// the browser can make it the item's photo (Mouser does not allow fetching
// its images from other sites). Only Mouser image links are fetched.
func (s *Server) partImage(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	src, err := url.Parse(r.URL.Query().Get("url"))
	if err != nil || src.Scheme != "https" || !mouserHost(src.Hostname()) || !strings.HasPrefix(src.Path, "/images/") {
		return badRequest("not a Mouser image link")
	}
	// The API links a 150 px thumbnail; the product pages use a 600 px
	// version of the same photo under lrg/.
	var res *http.Response
	for _, link := range []string{largeImage(src.String()), src.String()} {
		if res, err = fetchImage(r, link); err == nil {
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

func mouserHost(h string) bool {
	return h == "mouser.com" || strings.HasSuffix(h, ".mouser.com")
}

// largeImage turns .../images/<maker>/images/<file> into .../images/<maker>/lrg/<file>.
func largeImage(u string) string {
	return mouserThumb.ReplaceAllString(u, "/images/$1/lrg/")
}

var mouserThumb = regexp.MustCompile(`/images/([^/]+)/images/`)

func fetchImage(r *http.Request, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// Mouser's image server turns away requests that don't look like a browser.
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
	req.Header.Set("Accept", "image/jpeg,image/png,image/*;q=0.8")
	req.Header.Set("Referer", "https://www.mouser.com/")
	res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	if ct := res.Header.Get("Content-Type"); res.StatusCode != http.StatusOK || !strings.HasPrefix(ct, "image/") {
		res.Body.Close()
		return nil, fmt.Errorf("HTTP %d, %s", res.StatusCode, ct)
	}
	return res, nil
}
