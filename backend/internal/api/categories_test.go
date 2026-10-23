package api

import (
	"net/http"
	"strconv"
	"testing"

	"inventarius/internal/db"
)

func TestCategories(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt") // the first user is an admin
	member := e.login("rui@portospaceteam.pt")
	newCat := func(name string, parent *int64) db.Category {
		var c db.Category
		member.do("POST", "/api/categories", map[string]any{"name": name, "parent_id": parent}, http.StatusOK, &c)
		return c
	}
	path := func(c db.Category) string { return "/api/categories/" + strconv.FormatInt(c.ID, 10) }

	// The seed migration's starter tree.
	var seeded []db.Category
	member.do("GET", "/api/categories", nil, http.StatusOK, &seeded)
	if len(seeded) < 40 {
		t.Fatalf("seeded %d categories, want a starter tree", len(seeded))
	}

	parts := newCat("Parts", nil)
	pcb := newCat("Boards", &parts.ID)
	// Names are unique among siblings, ignoring case.
	member.do("POST", "/api/categories", map[string]any{"name": "boards", "parent_id": parts.ID}, http.StatusBadRequest, nil)
	member.do("POST", "/api/categories", map[string]any{"name": "Boards"}, http.StatusOK, nil)
	member.do("POST", "/api/categories", map[string]any{"name": "X", "parent_id": 99999}, http.StatusBadRequest, nil)

	// Rename and move; not inside itself.
	other := newCat("Other", nil)
	member.do("PATCH", path(pcb), map[string]any{"name": "PCBs", "parent_id": other.ID}, http.StatusOK, nil)
	member.do("PATCH", path(other), map[string]any{"name": "Other", "parent_id": pcb.ID}, http.StatusBadRequest, nil)

	var item db.Item
	member.do("POST", "/api/items", map[string]any{"name": "Proto board", "kind": "consumable", "category_id": pcb.ID}, http.StatusOK, &item)
	var counts []db.ListCategoryCountsRow
	member.do("GET", "/api/categories/counts", nil, http.StatusOK, &counts)
	found := false
	for _, c := range counts {
		if c.ID == pcb.ID {
			found = c.ItemCount == 1
		}
	}
	if !found {
		t.Errorf("counts %v: want 1 item in %d", counts, pcb.ID)
	}

	// Deleting: admins only, and only when empty.
	member.do("DELETE", path(parts), nil, http.StatusForbidden, nil)
	admin.do("DELETE", path(other), nil, http.StatusBadRequest, nil)
	admin.do("DELETE", path(parts), nil, http.StatusNoContent, nil)
}
