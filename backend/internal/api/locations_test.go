package api

import (
	"net/http"
	"strconv"
	"testing"

	"inventarius/internal/db"
)

func TestDeleteLocation(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt") // the first user is an admin
	member := e.login("rui@portospaceteam.pt")
	newLoc := func(name string, parent *int64) db.Location {
		var l db.Location
		admin.do("POST", "/api/locations", map[string]any{"name": name, "parent_id": parent}, http.StatusOK, &l)
		return l
	}
	path := func(l db.Location) string { return "/api/locations/" + strconv.FormatInt(l.ID, 10) }

	cupboard := newLoc("Armario 1", nil)
	door := newLoc("Porta 2", &cupboard.ID)

	// Not empty: it holds a place.
	admin.do("DELETE", path(cupboard), nil, http.StatusBadRequest, nil)
	// Admins only.
	member.do("DELETE", path(door), nil, http.StatusForbidden, nil)

	admin.do("DELETE", path(door), nil, http.StatusNoContent, nil)
	admin.do("GET", path(door), nil, http.StatusNotFound, nil)
	// Now the cupboard is empty too.
	admin.do("DELETE", path(cupboard), nil, http.StatusNoContent, nil)
}

func TestCreateLocationRange(t *testing.T) {
	e := newEnv(t)
	u := e.login("ana@portospaceteam.pt")
	var cabinet db.Location
	u.do("POST", "/api/locations", map[string]any{"name": "Armario 3"}, http.StatusOK, &cabinet)

	var drawers []db.Location
	u.do("POST", "/api/locations/range", map[string]any{
		"name": " Gaveta ", "parent_id": cabinet.ID, "from": 1, "to": 30, "print_label": true,
	}, http.StatusOK, &drawers)
	if len(drawers) != 30 || drawers[0].Name != "Gaveta 1" || drawers[29].Name != "Gaveta 30" {
		t.Fatalf("got %d places, first %q", len(drawers), drawers[0].Name)
	}
	for _, d := range drawers {
		if d.ParentID == nil || *d.ParentID != cabinet.ID {
			t.Fatalf("%s is not in the cabinet", d.Name)
		}
	}
	labels := func() (n int) {
		for _, j := range e.printer.printed() {
			n += j
		}
		return n
	}
	waitFor(t, "labels printed", func() bool { return labels() == 30 })

	for _, bad := range []map[string]any{
		{"name": "Gaveta", "from": 5, "to": 4},
		{"name": "Gaveta", "from": 1, "to": 101},
		{"name": "", "from": 1, "to": 2},
		{"name": "Gaveta", "from": 1, "to": 2, "parent_id": 99999},
	} {
		u.do("POST", "/api/locations/range", bad, http.StatusBadRequest, nil)
	}
}
