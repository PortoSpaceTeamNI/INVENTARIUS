package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"inventarius/internal/auth"
	"inventarius/internal/codes"
	"inventarius/internal/db"
	"inventarius/internal/inventory"
)

// ---- room maps ----

// mapShape is one rectangle on a room map, in centimetres from the room's
// top-left corner. A shape can stand for something in the inventory, named
// by its label code (L12 a place, I5 an item, S40 a stock lot, A7 a unit) or
// C3 for a category; clicking it shows that thing.
type mapShape struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Kind  string  `json:"kind"` // storage, furniture or fixture
	Color string  `json:"color"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Link  string  `json:"link"` // "" when it stands for nothing

	// Maps saved before links could be anything stored only a location.
	// It is read into Link and never written.
	LegacyLocationID *int64 `json:"location_id,omitempty"`
}

// upgrade moves a legacy location_id into Link.
func (s *mapShape) upgrade() {
	if s.LegacyLocationID != nil {
		if s.Link == "" {
			s.Link = codes.Format(codes.Location, *s.LegacyLocationID)
		}
		s.LegacyLocationID = nil
	}
}

// parseLink splits a shape link into its kind ('L', 'I', 'S', 'A' or 'C')
// and id, normalised to upper case.
func parseLink(link string) (byte, int64, error) {
	if c, ok := strings.CutPrefix(strings.ToUpper(strings.TrimSpace(link)), "C"); ok {
		id, err := strconv.ParseInt(c, 10, 64)
		if err != nil || id <= 0 || c[0] == '0' {
			return 0, 0, fmt.Errorf("invalid link %q", link)
		}
		return 'C', id, nil
	}
	k, id, err := codes.Parse(link)
	if err != nil || strings.Contains(link, "/") {
		return 0, 0, fmt.Errorf("invalid link %q", link)
	}
	return byte(k), id, nil
}

// linkExists reports whether the thing a link names is in the database.
func (s *Server) linkExists(ctx context.Context, kind byte, id int64) (bool, error) {
	var err error
	switch kind {
	case 'L':
		_, err = s.store.GetLocation(ctx, id)
	case 'I':
		_, err = s.store.GetItem(ctx, id)
	case 'S':
		_, err = s.store.GetStock(ctx, id)
	case 'A':
		_, err = s.store.GetAsset(ctx, id)
	case 'C':
		_, err = s.store.GetCategory(ctx, id)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// roomMap is a db.RoomMap with its shapes decoded.
type roomMap struct {
	ID         int64      `json:"id"`
	Name       string     `json:"name"`
	LocationID *int64     `json:"location_id"`
	Width      float64    `json:"width"`
	Height     float64    `json:"height"`
	Shapes     []mapShape `json:"shapes"`
	Version    int64      `json:"version"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func toRoomMap(m db.RoomMap) (roomMap, error) {
	out := roomMap{
		ID: m.ID, Name: m.Name, LocationID: m.LocationID, Width: m.Width, Height: m.Height,
		Version: m.Version, UpdatedAt: m.UpdatedAt, Shapes: []mapShape{},
	}
	if err := json.Unmarshal([]byte(m.Shapes), &out.Shapes); err != nil {
		return out, fmt.Errorf("map %d shapes: %w", m.ID, err)
	}
	for i := range out.Shapes {
		out.Shapes[i].upgrade()
	}
	return out, nil
}

type mapBody struct {
	Name       string     `json:"name"`
	LocationID *int64     `json:"location_id"`
	Width      float64    `json:"width"`
	Height     float64    `json:"height"`
	Shapes     []mapShape `json:"shapes"`
	Version    *int64     `json:"version"`
}

var (
	hexColor   = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	shapeKinds = map[string]bool{"storage": true, "furniture": true, "fixture": true}
)

const (
	maxMapSize   = 10000 // cm: 100 m
	maxMapShapes = 500
)

// validate checks the map and its shapes; locations are the known location
// IDs and exists says whether a shape's link names something real.
//
// Only links that are new must name something real: a link already saved
// (in known) may point at a place or item deleted since, and that must not
// stop the rest of the map from saving.
func (b *mapBody) validate(locations map[int64]bool, exists func(kind byte, id int64) (bool, error), known map[string]bool) error {
	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" {
		return badRequest("name is required")
	}
	if !(b.Width > 0 && b.Width <= maxMapSize && b.Height > 0 && b.Height <= maxMapSize) {
		return badRequest("the room must be between 1 cm and 100 m on each side")
	}
	if b.LocationID != nil && !locations[*b.LocationID] {
		return badRequest("unknown location")
	}
	if len(b.Shapes) > maxMapShapes {
		return badRequest("a map can have at most 500 shapes")
	}
	if b.Shapes == nil {
		b.Shapes = []mapShape{}
	}
	ids := map[string]bool{}
	for i := range b.Shapes {
		s := &b.Shapes[i]
		s.Label = strings.TrimSpace(s.Label)
		if s.ID == "" || len(s.ID) > 40 || ids[s.ID] {
			return badRequest("every shape needs its own id")
		}
		ids[s.ID] = true
		if len(s.Label) > 80 {
			return badRequest("shape names can be at most 80 characters")
		}
		if !shapeKinds[s.Kind] {
			return badRequest("shape kind must be storage, furniture or fixture")
		}
		if s.Color != "" && !hexColor.MatchString(s.Color) {
			return badRequest("colours must look like #2563eb")
		}
		// A little slack for rounding in the editor.
		const eps = 0.5
		if !(s.W > 0 && s.H > 0 && s.X >= -eps && s.Y >= -eps && s.X+s.W <= b.Width+eps && s.Y+s.H <= b.Height+eps) {
			return badRequest("shapes must lie inside the room")
		}
		s.upgrade()
		if s.Link == "" {
			continue
		}
		kind, id, err := parseLink(s.Link)
		if err != nil {
			return badRequest("links must be a code like L12, I5, S40, A7 or C3")
		}
		s.Link = fmt.Sprintf("%c%d", kind, id)
		if known[s.Link] {
			continue
		}
		if kind == 'L' && !locations[id] {
			return badRequest("the linked thing does not exist")
		}
		if kind != 'L' {
			ok, err := exists(kind, id)
			if err != nil {
				return err
			}
			if !ok {
				return badRequest("the linked thing does not exist")
			}
		}
	}
	return nil
}

func (s *Server) locationIDs(r *http.Request) (map[int64]bool, error) {
	locs, err := s.store.ListLocations(r.Context())
	if err != nil {
		return nil, err
	}
	ids := make(map[int64]bool, len(locs))
	for _, l := range locs {
		ids[l.ID] = true
	}
	return ids, nil
}

func (s *Server) listMaps(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	rows, err := s.store.ListRoomMaps(r.Context())
	if err != nil {
		return err
	}
	out := make([]roomMap, 0, len(rows))
	for _, m := range rows {
		rm, err := toRoomMap(m)
		if err != nil {
			return err
		}
		out = append(out, rm)
	}
	return writeJSON(w, out)
}

func (s *Server) getMap(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	m, err := s.store.GetRoomMap(r.Context(), id)
	if err != nil {
		return err
	}
	rm, err := toRoomMap(m)
	if err != nil {
		return err
	}
	return writeJSON(w, rm)
}

// decodeMap reads and checks a map; known are the links the map already has.
func (s *Server) decodeMap(r *http.Request, known map[string]bool) (mapBody, string, error) {
	var b mapBody
	if err := decode(r, &b); err != nil {
		return b, "", err
	}
	locs, err := s.locationIDs(r)
	if err != nil {
		return b, "", err
	}
	exists := func(kind byte, id int64) (bool, error) { return s.linkExists(r.Context(), kind, id) }
	if err := b.validate(locs, exists, known); err != nil {
		return b, "", err
	}
	shapes, err := json.Marshal(b.Shapes)
	return b, string(shapes), err
}

func (s *Server) createMap(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	b, shapes, err := s.decodeMap(r, nil)
	if err != nil {
		return err
	}
	m, err := s.store.CreateRoomMap(r.Context(), db.CreateRoomMapParams{
		Name: b.Name, LocationID: b.LocationID, Width: b.Width, Height: b.Height, Shapes: shapes,
	})
	if err != nil {
		return err
	}
	rm, err := toRoomMap(m)
	if err != nil {
		return err
	}
	return writeJSON(w, rm)
}

// updateMap replaces the whole map: the editor saves the layout in one go.
func (s *Server) updateMap(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	stored, err := s.store.GetRoomMap(r.Context(), id)
	if err != nil {
		return err
	}
	cur, err := toRoomMap(stored)
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, sh := range cur.Shapes {
		known[strings.ToUpper(sh.Link)] = true
	}
	b, shapes, err := s.decodeMap(r, known)
	if err != nil {
		return err
	}
	var m db.RoomMap
	err = s.store.Tx(r.Context(), func(q *db.Queries) error {
		cur, err := q.GetRoomMap(r.Context(), id)
		if err != nil {
			return err
		}
		if err := inventory.CheckVersion(cur.Version, b.Version); err != nil {
			return err
		}
		m, err = q.UpdateRoomMap(r.Context(), db.UpdateRoomMapParams{
			Name: b.Name, LocationID: b.LocationID, Width: b.Width, Height: b.Height, Shapes: shapes, ID: id,
		})
		return err
	})
	if err != nil {
		return err
	}
	rm, err := toRoomMap(m)
	if err != nil {
		return err
	}
	return writeJSON(w, rm)
}

func (s *Server) deleteMap(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if err := requireAdmin(u); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if _, err := s.store.GetRoomMap(r.Context(), id); err != nil {
		return err
	}
	if err := s.store.DeleteRoomMap(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
