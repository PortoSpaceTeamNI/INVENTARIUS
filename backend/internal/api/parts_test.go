package api

import (
	"net/http"
	"net/url"
	"strconv"
	"testing"

	"inventarius/internal/db"
	"inventarius/internal/parts"
)

func TestPartLookupWithoutKey(t *testing.T) {
	e := newEnv(t)
	c := e.login("ana@portospaceteam.pt")
	var meta struct {
		PartLookup bool `json:"part_lookup"`
	}
	c.do("GET", "/api/meta", nil, http.StatusOK, &meta)
	if meta.PartLookup {
		t.Fatal("part_lookup on without an API key")
	}
	c.do("GET", "/api/parts?mpn=LM358P", nil, http.StatusServiceUnavailable, nil)
}

func TestPartImageOnlyFromMouser(t *testing.T) {
	e := newEnv(t)
	c := e.login("ana@portospaceteam.pt")
	for _, u := range []string{
		"http://www.mouser.com/images/x.jpg",           // not https
		"https://evil.example/images/x.jpg",            // other host
		"https://mouser.com.evil.example/images/x.jpg", // look-alike host
		"https://www.mouser.com/api/v1/x",              // not an image path
		"https://127.0.0.1/images/x.jpg",
	} {
		c.do("GET", "/api/parts/image?url="+url.QueryEscape(u), nil, http.StatusBadRequest, nil)
	}
}

func TestLargeImage(t *testing.T) {
	got := largeImage("https://www.mouser.com/images/boschsensortec/images/262-BMP390_DSL.jpg")
	if want := "https://www.mouser.com/images/boschsensortec/lrg/262-BMP390_DSL.jpg"; got != want {
		t.Fatalf("largeImage = %q, want %q", got, want)
	}
}

func TestMatchCategory(t *testing.T) {
	g := parts.GroupOf("Multilayer Ceramic Capacitors MLCC - SMD/SMT")
	one := int64(1)
	cats := []db.Category{{ID: 3, Name: "Eletrónica"}, {ID: 7, ParentID: &one, Name: " Capacitor "}}
	if id, name := matchCategory(cats, g); id == nil || *id != 7 || name != "" {
		t.Fatalf("matchCategory = %v, %q; want the existing Capacitor (7)", id, name)
	}
	if id, name := matchCategory(cats[:1], g); id != nil || name != "Condensadores" {
		t.Fatalf("matchCategory = %v, %q; want a new Condensadores", id, name)
	}
}

func TestItemLabelText(t *testing.T) {
	e := newEnv(t)
	c := e.login("ana@portospaceteam.pt")
	var it db.Item
	c.do("POST", "/api/items", map[string]any{
		"name": "Multilayer Ceramic Capacitors MLCC - SMD/SMT X6S, 1uF, +/-10%, 16v, 0402", "kind": "consumable",
		"mpn": "CL05X105KO5NQWC", "label_text": " 1uF 0402 ",
	}, http.StatusOK, &it)
	if it.LabelText != "1uF 0402" {
		t.Fatalf("label_text = %q", it.LabelText)
	}
	c.do("PATCH", "/api/items/"+strconv.FormatInt(it.ID, 10), map[string]any{
		"name": it.Name, "kind": "consumable", "label_text": "1uF X6S 0402",
	}, http.StatusOK, &it)
	if it.LabelText != "1uF X6S 0402" {
		t.Fatalf("label_text after update = %q", it.LabelText)
	}
	// The label text is searchable too.
	var found []db.Item
	c.do("GET", "/api/items?q=1uF%200402", nil, http.StatusOK, &found)
	if len(found) != 1 || found[0].ID != it.ID {
		t.Fatalf("search found %+v", found)
	}
}

func TestStockPrintsItemLabel(t *testing.T) {
	e := newEnv(t)
	c := e.login("ana@portospaceteam.pt")
	var loc db.Location
	c.do("POST", "/api/locations", map[string]any{"name": "Gaveta 6"}, http.StatusOK, &loc)
	var it db.Item
	c.do("POST", "/api/items", map[string]any{"name": "Long Mouser name", "kind": "consumable", "label_text": "Capacitors 1uF 0402"}, http.StatusOK, &it)
	c.do("POST", "/api/stock", map[string]any{"item_id": it.ID, "location_id": loc.ID, "quantity": 30, "print_label": true}, http.StatusOK, nil)
	var jobs []db.PrintJob
	c.do("GET", "/api/print/jobs", nil, http.StatusOK, &jobs)
	if len(jobs) != 1 || jobs[0].Code != "I"+strconv.FormatInt(it.ID, 10) || jobs[0].Caption != "Capacitors 1uF 0402" {
		t.Fatalf("print jobs = %+v, want one I%d label with the label text", jobs, it.ID)
	}
	// Without print_label nothing is printed.
	c.do("POST", "/api/stock", map[string]any{"item_id": it.ID, "location_id": loc.ID, "quantity": 5}, http.StatusOK, nil)
	c.do("GET", "/api/print/jobs", nil, http.StatusOK, &jobs)
	if len(jobs) != 1 {
		t.Fatalf("%d print jobs, want still 1", len(jobs))
	}
}
