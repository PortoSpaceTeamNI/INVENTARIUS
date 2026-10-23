package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"inventarius/internal/auth"
	"inventarius/internal/codes"
	"inventarius/internal/db"
	"inventarius/internal/search"
)

// ---- locations ----

func (s *Server) listLocations(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	locs, err := s.store.ListLocations(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, locs)
}

// locationCounts returns how many stock lots and units sit directly in
// each location, for the location tree.
func (s *Server) locationCounts(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	rows, err := s.store.ListLocationCounts(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, nonNil(rows))
}

type locationBody struct {
	ParentID    *int64 `json:"parent_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PrintLabel  bool   `json:"print_label"`
}

func (b *locationBody) validate() error {
	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" {
		return badRequest("name is required")
	}
	return nil
}

func (s *Server) createLocation(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b locationBody
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := b.validate(); err != nil {
		return err
	}
	loc, err := s.store.CreateLocation(r.Context(), db.CreateLocationParams{ParentID: b.ParentID, Name: b.Name, Description: b.Description})
	if err != nil {
		return err
	}
	if b.PrintLabel {
		s.enqueueLabel(r.Context(), u, codes.Location, loc.ID, loc.Name)
	}
	return writeJSON(w, loc)
}

// ancestors returns the path from the root to loc's parent.
func ancestors(all []db.Location, loc db.Location) []db.Location {
	byID := map[int64]db.Location{}
	for _, l := range all {
		byID[l.ID] = l
	}
	var path []db.Location
	for p := loc.ParentID; p != nil && len(path) < 64; {
		l, ok := byID[*p]
		if !ok {
			break
		}
		path = append(path, l)
		p = l.ParentID
	}
	slices.Reverse(path)
	return path
}

func (s *Server) getLocation(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	loc, err := s.store.GetLocation(ctx, id)
	if err != nil {
		return err
	}
	all, err := s.store.ListLocations(ctx)
	if err != nil {
		return err
	}
	children := []db.Location{}
	for _, l := range all {
		if l.ParentID != nil && *l.ParentID == id {
			children = append(children, l)
		}
	}
	stock, err := s.store.ListStockByLocation(ctx, id)
	if err != nil {
		return err
	}
	assets, err := s.store.ListAssetsByLocation(ctx, &id)
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{
		"location": loc,
		"path":     nonNil(ancestors(all, loc)),
		"children": children,
		"stock":    nonNil(stock),
		"assets":   nonNil(assets),
	})
}

func (s *Server) updateLocation(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var b locationBody
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := b.validate(); err != nil {
		return err
	}
	if b.ParentID != nil {
		// Refuse to make a location its own ancestor.
		all, err := s.store.ListLocations(r.Context())
		if err != nil {
			return err
		}
		parent, err := s.store.GetLocation(r.Context(), *b.ParentID)
		if err != nil {
			return badRequest("unknown parent location")
		}
		if parent.ID == id || slices.ContainsFunc(ancestors(all, parent), func(l db.Location) bool { return l.ID == id }) {
			return badRequest("a location cannot be inside itself")
		}
	}
	loc, err := s.store.UpdateLocation(r.Context(), db.UpdateLocationParams{ParentID: b.ParentID, Name: b.Name, Description: b.Description, ID: id})
	if err != nil {
		return err
	}
	return writeJSON(w, loc)
}

func (s *Server) deleteLocation(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if err := requireAdmin(u); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	n, err := s.store.CountLocationUsage(r.Context(), &id)
	if err != nil {
		return err
	}
	if n > 0 {
		return badRequest("empty it first: it still holds locations, stock or assets")
	}
	if err := s.store.DeleteLocation(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- categories ----

func (s *Server) listCategories(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	cats, err := s.store.ListCategories(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, cats)
}

// categoryCounts answers how many items each category holds directly.
func (s *Server) categoryCounts(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	rows, err := s.store.ListCategoryCounts(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, nonNil(rows))
}

type categoryBody struct {
	ParentID *int64 `json:"parent_id"`
	Name     string `json:"name"`
}

func (s *Server) createCategory(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b categoryBody
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := s.checkCategory(r.Context(), 0, &b); err != nil {
		return err
	}
	c, err := s.store.CreateCategory(r.Context(), db.CreateCategoryParams{ParentID: b.ParentID, Name: b.Name})
	if err != nil {
		return err
	}
	return writeJSON(w, c)
}

func (s *Server) updateCategory(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var b categoryBody
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := s.checkCategory(r.Context(), id, &b); err != nil {
		return err
	}
	c, err := s.store.UpdateCategory(r.Context(), db.UpdateCategoryParams{ParentID: b.ParentID, Name: b.Name, ID: id})
	if err != nil {
		return err
	}
	return writeJSON(w, c)
}

// checkCategory trims b's name and checks that category id (0 for a new
// one) can have it under b's parent: the parent exists, is not the category
// or inside it, and has no other subcategory of that name.
func (s *Server) checkCategory(ctx context.Context, id int64, b *categoryBody) error {
	if b.Name = strings.TrimSpace(b.Name); b.Name == "" {
		return badRequest("name is required")
	}
	cats, err := s.store.ListCategories(ctx)
	if err != nil {
		return err
	}
	parent := map[int64]*int64{}
	for _, c := range cats {
		parent[c.ID] = c.ParentID
	}
	if b.ParentID != nil {
		if _, ok := parent[*b.ParentID]; !ok {
			return badRequest("unknown parent category")
		}
		for p, n := b.ParentID, 0; p != nil && n < 64; p, n = parent[*p], n+1 {
			if *p == id {
				return badRequest("a category cannot be inside itself")
			}
		}
	}
	for _, c := range cats {
		if c.ID != id && sameParent(c.ParentID, b.ParentID) && strings.EqualFold(c.Name, b.Name) {
			return badRequest("there is already a category with that name there")
		}
	}
	return nil
}

func sameParent(a, b *int64) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func (s *Server) deleteCategory(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if err := requireAdmin(u); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	n, err := s.store.CountCategoryUsage(r.Context(), &id)
	if err != nil {
		return err
	}
	if n > 0 {
		return badRequest("it still has subcategories or items")
	}
	if err := s.store.DeleteCategory(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- items ----

// findItems matches items whose name, part number, maker, package or
// description contain every word of q ("10k 0603"). The database filters on
// the first word; the others are checked here.
// kindWords let people search by type in Portuguese or English.
var kindWords = map[string]string{
	"consumable": "consumable consumivel componente peca part",
	"tool":       "tool ferramenta equipamento equipment",
	"hazmat":     "hazmat hazardous perigoso quimico chemical",
	"flight_hw":  "flight hardware voo foguete rocket",
}

// findItems lists items matching q (see package search), best first; with
// an empty q, all items by name.
func (s *Server) findItems(ctx context.Context, q string, p db.ListItemSummariesParams) ([]db.ListItemSummariesRow, error) {
	query := search.Parse(q)
	if query.Empty() {
		return s.store.ListItemSummaries(ctx, p)
	}
	want := p.Lim
	p.Q, p.Lim = nil, 1_000_000
	rows, err := s.store.ListItemSummaries(ctx, p)
	if err != nil {
		return nil, err
	}
	cats, err := s.store.ListCategories(ctx)
	if err != nil {
		return nil, err
	}
	catName := map[int64]db.Category{}
	for _, c := range cats {
		catName[c.ID] = c
	}
	catPath := func(id *int64) string {
		var parts []string
		for d := 0; id != nil && d < 16; d++ {
			c, ok := catName[*id]
			if !ok {
				break
			}
			parts = append(parts, c.Name)
			id = c.ParentID
		}
		return strings.Join(parts, " ")
	}
	docs := make([]search.Doc, len(rows))
	for i, it := range rows {
		docs[i] = search.NewDoc(
			search.Field{Text: it.Name, Weight: 3},
			search.Field{Text: it.Package + " " + it.Mpn + " " + it.LabelText, Weight: 2},
			search.Field{Text: catPath(it.CategoryID), Weight: 1.5},
			search.Field{Text: it.Manufacturer, Weight: 1},
			search.Field{Text: kindWords[it.Kind], Weight: 0.8},
			search.Field{Text: it.Description, Weight: 0.5},
		)
	}
	ranked := search.Rank(query, docs)
	out := make([]db.ListItemSummariesRow, 0, min(len(ranked), int(want)))
	for _, i := range ranked {
		if int64(len(out)) == want {
			break
		}
		out = append(out, rows[i])
	}
	return out, nil
}

func (s *Server) listItems(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	p := db.ListItemSummariesParams{
		CategoryID: queryInt(r, "category_id"),
		Lim:        limit(r, 200, 5000),
	}
	if k := r.URL.Query().Get("kind"); k != "" {
		p.Kind = &k
	}
	items, err := s.findItems(r.Context(), r.URL.Query().Get("q"), p)
	if err != nil {
		return err
	}
	return writeJSON(w, nonNil(items))
}

type itemBody struct {
	Name         string   `json:"name"`
	Kind         string   `json:"kind"`
	CategoryID   *int64   `json:"category_id"`
	Description  string   `json:"description"`
	Manufacturer string   `json:"manufacturer"`
	Mpn          string   `json:"mpn"`
	SupplierUrl  string   `json:"supplier_url"`
	DatasheetUrl string   `json:"datasheet_url"`
	Unit         string   `json:"unit"`
	MinStock     *float64 `json:"min_stock"`
	HazardClass  string   `json:"hazard_class"`
	StorageNotes string   `json:"storage_notes"`
	Package      string   `json:"package"`
	// Short text for labels; "" prints the name.
	LabelText string `json:"label_text"`
	owner
}

func (b *itemBody) validate() error {
	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" {
		return badRequest("name is required")
	}
	switch b.Kind {
	case "consumable", "tool", "hazmat", "flight_hw":
	default:
		return badRequest("kind must be consumable, tool, hazmat or flight_hw")
	}
	b.Package = strings.TrimSpace(b.Package)
	b.LabelText = strings.TrimSpace(b.LabelText)
	if b.Unit = strings.TrimSpace(b.Unit); b.Unit == "" {
		b.Unit = "pcs"
	}
	for _, u := range []string{b.SupplierUrl, b.DatasheetUrl} {
		if u != "" && !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "http://") {
			return badRequest("links must start with http:// or https://")
		}
	}
	return b.owner.inv().Validate()
}

func (s *Server) createItem(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b itemBody
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := b.validate(); err != nil {
		return err
	}
	it, err := s.store.CreateItem(r.Context(), db.CreateItemParams{
		Name: b.Name, Kind: b.Kind, CategoryID: b.CategoryID, Description: b.Description,
		Manufacturer: b.Manufacturer, Mpn: b.Mpn, SupplierUrl: b.SupplierUrl, DatasheetUrl: b.DatasheetUrl,
		Unit: b.Unit, MinStock: b.MinStock, HazardClass: b.HazardClass, StorageNotes: b.StorageNotes,
		OwnerProjectID: b.OwnerProjectID, OwnerDepartmentID: b.OwnerDepartmentID, Package: b.Package,
		LabelText: b.LabelText,
	})
	if err != nil {
		return err
	}
	return writeJSON(w, it)
}

func (s *Server) getItem(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	it, err := s.store.GetItem(ctx, id)
	if err != nil {
		return err
	}
	stock, err := s.store.ListStockByItem(ctx, id)
	if err != nil {
		return err
	}
	assets, err := s.store.ListAssetsByItem(ctx, id)
	if err != nil {
		return err
	}
	moves, err := s.store.ListMovements(ctx, db.ListMovementsParams{ItemID: &id, Lim: 30})
	if err != nil {
		return err
	}
	res, err := s.reservations(ctx, id, nil)
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{
		"item":         it,
		"reservations": res,
		"stock":        nonNil(stock),
		"assets":       nonNil(assets),
		"movements":    nonNil(moves),
		"can_edit":     s.canEdit(u, it.OwnerProjectID, it.OwnerDepartmentID),
	})
}

func (s *Server) updateItem(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	cur, err := s.store.GetItem(r.Context(), id)
	if err != nil {
		return err
	}
	if err := s.checkEdit(u, cur.OwnerProjectID, cur.OwnerDepartmentID); err != nil {
		return err
	}
	var b itemBody
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := b.validate(); err != nil {
		return err
	}
	// Giving it away is fine; you just can't edit it afterwards.
	it, err := s.store.UpdateItem(r.Context(), db.UpdateItemParams{
		Name: b.Name, Kind: b.Kind, CategoryID: b.CategoryID, Description: b.Description,
		Manufacturer: b.Manufacturer, Mpn: b.Mpn, SupplierUrl: b.SupplierUrl, DatasheetUrl: b.DatasheetUrl,
		Unit: b.Unit, MinStock: b.MinStock, HazardClass: b.HazardClass, StorageNotes: b.StorageNotes,
		OwnerProjectID: b.OwnerProjectID, OwnerDepartmentID: b.OwnerDepartmentID, Package: b.Package,
		LabelText: b.LabelText, ID: id,
	})
	if err != nil {
		return err
	}
	return writeJSON(w, it)
}

func (s *Server) deleteItem(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if err := requireAdmin(u); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	it, err := s.store.GetItem(r.Context(), id)
	if err != nil {
		return err
	}
	if err := s.store.DeleteItem(r.Context(), id); err != nil {
		return err
	}
	if it.Photo != "" {
		os.Remove(filepath.Join(s.photoDir(), it.Photo))
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// uploadPhoto takes a raw image body, shrinks it to 1024 px and stores it as JPEG.
func (s *Server) uploadPhoto(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	it, err := s.store.GetItem(r.Context(), id)
	if err != nil {
		return err
	}
	if err := s.checkEdit(u, it.OwnerProjectID, it.OwnerDepartmentID); err != nil {
		return err
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 20<<20))
	if err != nil {
		return badRequest("photo too large (max 20 MB)")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return badRequest("not a JPEG, PNG, GIF or WebP image")
	}
	img = shrink(img, 1024)
	var rnd [8]byte
	rand.Read(rnd[:])
	name := fmt.Sprintf("item-%d-%s.jpg", id, hex.EncodeToString(rnd[:]))
	if err := os.MkdirAll(s.photoDir(), 0o755); err != nil {
		return err
	}
	f, err := os.Create(filepath.Join(s.photoDir(), name))
	if err != nil {
		return err
	}
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 82}); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := s.store.SetItemPhoto(r.Context(), db.SetItemPhotoParams{Photo: name, ID: id}); err != nil {
		return err
	}
	if it.Photo != "" {
		os.Remove(filepath.Join(s.photoDir(), it.Photo))
	}
	return writeJSON(w, map[string]string{"photo": name})
}

func shrink(img image.Image, maxSide int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxSide && h <= maxSide {
		return img
	}
	if w > h {
		h, w = h*maxSide/w, maxSide
	} else {
		w, h = w*maxSide/h, maxSide
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	return dst
}

// ---- search and codes ----

func (s *Server) search(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	out := map[string]any{"items": []any{}, "locations": []any{}, "code": nil}
	if q == "" {
		return writeJSON(w, out)
	}
	if k, id, err := codes.Parse(q); err == nil {
		if path, err := s.codePath(r.Context(), k, id); err == nil {
			out["code"] = map[string]any{"code": codes.Format(k, id), "path": path}
		}
	}
	items, err := s.findItems(r.Context(), q, db.ListItemSummariesParams{Lim: 30})
	if err != nil {
		return err
	}
	out["items"] = nonNil(items)
	locs, err := s.store.ListLocations(r.Context())
	if err != nil {
		return err
	}
	// Places match on their own name, and less on the names of what they
	// are inside ("caixa 1 gaveta 5").
	byID := map[int64]db.Location{}
	for _, l := range locs {
		byID[l.ID] = l
	}
	docs := make([]search.Doc, len(locs))
	for i, l := range locs {
		var parents []string
		for p, d := l.ParentID, 0; p != nil && d < 32; d++ {
			pl, ok := byID[*p]
			if !ok {
				break
			}
			parents = append(parents, pl.Name)
			p = pl.ParentID
		}
		docs[i] = search.NewDoc(
			search.Field{Text: l.Name, Weight: 3},
			search.Field{Text: strings.Join(parents, " "), Weight: 1},
			search.Field{Text: l.Description, Weight: 0.5},
		)
	}
	var matched []db.Location
	for _, i := range search.Rank(search.Parse(q), docs) {
		if len(matched) == 10 {
			break
		}
		matched = append(matched, locs[i])
	}
	out["locations"] = nonNil(matched)
	return writeJSON(w, out)
}

// codePath checks the code exists and returns the app page for it.
func (s *Server) codePath(ctx context.Context, k codes.Kind, id int64) (string, error) {
	var err error
	var path string
	switch k {
	case codes.Location:
		_, err = s.store.GetLocation(ctx, id)
		path = fmt.Sprintf("/locations/%d", id)
	case codes.Item:
		_, err = s.store.GetItem(ctx, id)
		path = fmt.Sprintf("/items/%d", id)
	case codes.Stock:
		_, err = s.store.GetStock(ctx, id)
		path = fmt.Sprintf("/stock/%d", id)
	case codes.Asset:
		_, err = s.store.GetAsset(ctx, id)
		path = fmt.Sprintf("/assets/%d", id)
	}
	return path, err
}

func (s *Server) resolveCode(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	k, id, err := codes.Parse(r.PathValue("code"))
	if err != nil {
		return badRequest(err.Error())
	}
	path, err := s.codePath(r.Context(), k, id)
	if err != nil {
		return &httpError{http.StatusNotFound, "no " + k.Name() + " with code " + codes.Format(k, id)}
	}
	return writeJSON(w, map[string]any{"code": codes.Format(k, id), "kind": k.Name(), "id": id, "path": path})
}

// nonNil makes empty lists encode as [] instead of null.
func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
