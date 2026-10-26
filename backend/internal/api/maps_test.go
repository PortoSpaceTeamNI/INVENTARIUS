package api

import (
	"net/http"
	"strconv"
	"testing"

	"inventarius/internal/db"
)

func TestRoomMaps(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt") // the first user is an admin
	member := e.login("rui@portospaceteam.pt")

	// The PST room comes traced from its floor plan.
	var maps []roomMap
	member.do("GET", "/api/maps", nil, http.StatusOK, &maps)
	if len(maps) != 1 || maps[0].Name != "Sala PST" || len(maps[0].Shapes) == 0 {
		t.Fatalf("seeded maps = %+v", maps)
	}
	for _, s := range maps[0].Shapes {
		if s.X < 0 || s.Y < 0 || s.X+s.W > maps[0].Width || s.Y+s.H > maps[0].Height {
			t.Errorf("seeded shape %q lies outside the room", s.Label)
		}
	}

	var room, cupboard db.Location
	member.do("POST", "/api/locations", map[string]any{"name": "Sala PST"}, http.StatusOK, &room)
	member.do("POST", "/api/locations", map[string]any{"name": "Armario 1", "parent_id": room.ID}, http.StatusOK, &cupboard)

	m := maps[0]
	path := "/api/maps/" + strconv.FormatInt(m.ID, 10)
	body := map[string]any{
		"name": "Sala PST", "location_id": room.ID, "width": 500, "height": 300, "version": m.Version,
		"shapes": []map[string]any{
			{"id": "a", "label": "Armario 1", "kind": "storage", "color": "#8b5a2b", "x": 0, "y": 0, "w": 60, "h": 40, "location_id": cupboard.ID},
			{"id": "b", "label": "Mesa", "kind": "furniture", "x": 100, "y": 100, "w": 160, "h": 80},
		},
	}
	var saved roomMap
	member.do("PUT", path, body, http.StatusOK, &saved)
	if saved.Version != m.Version+1 || len(saved.Shapes) != 2 || *saved.Shapes[0].LocationID != cupboard.ID {
		t.Fatalf("saved = %+v", saved)
	}
	// Saving from the old version is refused.
	member.do("PUT", path, body, http.StatusConflict, nil)

	body["version"] = saved.Version
	bad := func(change func(s map[string]any)) {
		t.Helper()
		s := map[string]any{"id": "c", "label": "X", "kind": "storage", "x": 0, "y": 0, "w": 10, "h": 10}
		change(s)
		b := map[string]any{}
		for k, v := range body {
			b[k] = v
		}
		b["shapes"] = []map[string]any{s}
		member.do("PUT", path, b, http.StatusBadRequest, nil)
	}
	bad(func(s map[string]any) { s["x"] = 495 })           // sticks out of the room
	bad(func(s map[string]any) { s["kind"] = "window" })   // unknown kind
	bad(func(s map[string]any) { s["color"] = "red" })     // not a colour
	bad(func(s map[string]any) { s["location_id"] = 999 }) // unknown place
	bad(func(s map[string]any) { s["w"] = 0 })

	var created roomMap
	member.do("POST", "/api/maps", map[string]any{"name": "Sala FADEUP", "width": 800, "height": 600}, http.StatusOK, &created)
	if len(created.Shapes) != 0 {
		t.Fatalf("created = %+v", created)
	}
	cpath := "/api/maps/" + strconv.FormatInt(created.ID, 10)
	member.do("DELETE", cpath, nil, http.StatusForbidden, nil)
	admin.do("DELETE", cpath, nil, http.StatusNoContent, nil)
	admin.do("GET", cpath, nil, http.StatusNotFound, nil)
}
