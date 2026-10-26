package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"testing"

	"inventarius/internal/db"
)

// Two people open the same item; the second save would overwrite the first.
func TestEditFromOldVersionIsRefused(t *testing.T) {
	e := newEnv(t)
	ana := e.login("ana@portospaceteam.pt")
	var it db.Item
	ana.do("POST", "/api/items", map[string]any{"name": "Multimeter", "kind": "tool"}, 200, &it)

	edit := map[string]any{"name": "Multimeter UT61E", "kind": "tool", "version": it.Version}
	var saved db.Item
	ana.do("PATCH", fmt.Sprintf("/api/items/%d", it.ID), edit, 200, &saved)
	if saved.Version != it.Version+1 {
		t.Fatalf("version %d after edit of %d", saved.Version, it.Version)
	}
	edit["name"] = "Fluke multimeter"
	ana.do("PATCH", fmt.Sprintf("/api/items/%d", it.ID), edit, http.StatusConflict, nil)
	// Without a version (older clients) the edit goes through as before.
	delete(edit, "version")
	ana.do("PATCH", fmt.Sprintf("/api/items/%d", it.ID), edit, 200, nil)

	var loc db.Location
	ana.do("POST", "/api/locations", map[string]any{"name": "Bin 1"}, 200, &loc)
	ana.do("PATCH", fmt.Sprintf("/api/locations/%d", loc.ID), map[string]any{"name": "Bin 2", "version": loc.Version}, 200, nil)
	ana.do("PATCH", fmt.Sprintf("/api/locations/%d", loc.ID), map[string]any{"name": "Bin 3", "version": loc.Version}, http.StatusConflict, nil)
}

func TestNoDuplicateNames(t *testing.T) {
	e := newEnv(t)
	ana := e.login("ana@portospaceteam.pt")
	var room db.Location
	ana.do("POST", "/api/locations", map[string]any{"name": "Room"}, 200, &room)
	ana.do("POST", "/api/locations", map[string]any{"name": "room"}, 400, nil)
	ana.do("POST", "/api/locations", map[string]any{"name": "Shelf 1", "parent_id": room.ID}, 200, nil)
	var other db.Location
	ana.do("POST", "/api/locations", map[string]any{"name": "Shelf 2", "parent_id": room.ID}, 200, &other)
	ana.do("PATCH", fmt.Sprintf("/api/locations/%d", other.ID), map[string]any{"name": "Shelf 1", "parent_id": room.ID}, 400, nil)

	ana.do("POST", "/api/categories", map[string]any{"name": "Spares"}, 200, nil)
	ana.do("POST", "/api/categories", map[string]any{"name": "SPARES"}, 400, nil)

	ana.do("POST", "/api/items", map[string]any{"name": "Resistor 10k", "kind": "consumable", "package": "0603"}, 200, nil)
	ana.do("POST", "/api/items", map[string]any{"name": "resistor 10k", "kind": "consumable", "package": "0603"}, 400, nil)
	ana.do("POST", "/api/items", map[string]any{"name": "Resistor 10k", "kind": "consumable", "package": "0402"}, 200, nil)

	// Several people creating the same shelf at the same moment get one shelf.
	cookies := ana.c.Jar.Cookies(mustURL(e.ts.URL))
	var wg sync.WaitGroup
	var mu sync.Mutex
	created := 0
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{"name": "Shelf 9", "parent_id": room.ID})
			req, _ := http.NewRequest("POST", e.ts.URL+"/api/locations", bytes.NewReader(body))
			for _, c := range cookies {
				req.AddCookie(c)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			resp.Body.Close()
			if resp.StatusCode == 200 {
				mu.Lock()
				created++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if created != 1 {
		t.Fatalf("%d shelves created", created)
	}
}

func TestCancelWhilePrintingIsRefused(t *testing.T) {
	e := newEnv(t)
	ana := e.login("ana@portospaceteam.pt")
	var loc db.Location
	ana.do("POST", "/api/locations", map[string]any{"name": "Bin 1"}, 200, &loc)
	var jobs []db.PrintJob
	ana.do("POST", "/api/print", map[string]any{"labels": []map[string]string{{"code": fmt.Sprintf("L%d", loc.ID)}}}, 200, &jobs)
	// The printer takes the job before the cancel arrives.
	if _, err := e.store.ClaimPrintJob(t.Context(), jobs[0].ID); err != nil {
		t.Fatal(err)
	}
	ana.do("POST", fmt.Sprintf("/api/print/jobs/%d/cancel", jobs[0].ID), nil, 400, nil)
	j, _ := e.store.GetPrintJob(t.Context(), jobs[0].ID)
	if j.Status == "cancelled" {
		t.Fatal("a printing job was marked cancelled")
	}

	// A job cancelled before the printer gets to it is never printed.
	code := fmt.Sprintf("L%d", loc.ID)
	cancelled, err := e.store.CreatePrintJob(t.Context(), db.CreatePrintJobParams{UserID: 1, Code: code, Symbology: "qr"})
	if err != nil {
		t.Fatal(err)
	}
	ana.do("POST", fmt.Sprintf("/api/print/jobs/%d/cancel", cancelled.ID), nil, 204, nil)
	before := len(e.printer.printed())
	ana.do("POST", "/api/print", map[string]any{"labels": []map[string]string{{"code": code}}}, 200, &jobs)
	waitFor(t, "next job printed", func() bool {
		j, _ := e.store.GetPrintJob(t.Context(), jobs[0].ID)
		return j.Status == "done"
	})
	j, _ = e.store.GetPrintJob(t.Context(), cancelled.ID)
	if printed := e.printer.printed(); j.Status != "cancelled" || len(printed) != before+1 || printed[before] != 1 {
		t.Fatalf("cancelled job: status %s, print jobs %v", j.Status, printed)
	}
}

func mustURL(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}
