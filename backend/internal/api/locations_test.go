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
