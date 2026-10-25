package api

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"inventarius/internal/auth"
	"inventarius/internal/config"
	"inventarius/internal/db"
	"inventarius/internal/labels"
	"inventarius/internal/printqueue"
	"inventarius/internal/ptouch"
)

// recordingPrinter counts printed labels per job.
type recordingPrinter struct {
	mu      sync.Mutex
	jobs    []int
	fail    error
	tapeMM  int   // loaded tape; 0 means 12 mm
	heights []int // image height of every printed label
}

func (p *recordingPrinter) Status(context.Context) (ptouch.Status, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return ptouch.Status{Model: ptouch.ModelPTE550W, MediaWidth: cmp.Or(p.tapeMM, 12)}, nil
}

func (p *recordingPrinter) Print(_ context.Context, imgs []image.Image, wantTapeMM int) (ptouch.Result, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.fail != nil {
		return ptouch.Result{}, p.fail
	}
	if loaded := cmp.Or(p.tapeMM, 12); wantTapeMM != loaded {
		return ptouch.Result{}, fmt.Errorf("printer has %d mm tape loaded, labels need %d mm", loaded, wantTapeMM)
	}
	p.jobs = append(p.jobs, len(imgs))
	for _, img := range imgs {
		p.heights = append(p.heights, img.Bounds().Dy())
	}
	return ptouch.Result{Confirmed: true}, nil
}

func (p *recordingPrinter) printed() []int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]int(nil), p.jobs...)
}

type env struct {
	t       *testing.T
	ts      *httptest.Server
	store   *db.Store
	printer *recordingPrinter
}

func newEnv(t *testing.T) *env {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	store, err := db.Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	cfg := config.Config{
		DataDir: t.TempDir(), BaseURL: "http://test", LabelURL: "https://inv.portospaceteam.pt",
		AllowedDomain: "portospaceteam.pt", DevAuth: true, Symbology: "datamatrix",
		SessionTTL: time.Hour, PrintBatchDelay: 50 * time.Millisecond,
	}
	p := &recordingPrinter{}
	var srv *Server
	q := printqueue.New(store, p, cfg.PrintBatchDelay, func(j db.PrintJob, t labels.Tape) (image.Image, error) { return srv.RenderJob(j, t) })
	srv, err = New(ctx, cfg, store, auth.New(cfg, store), q, nil)
	if err != nil {
		t.Fatal(err)
	}
	go q.Run(ctx)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return &env{t: t, ts: ts, store: store, printer: p}
}

type client struct {
	e *env
	c *http.Client
}

// login signs in through the development login (the first user becomes admin).
func (e *env) login(email string) *client {
	jar, _ := cookiejar.New(nil)
	c := &client{e: e, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	c.do("POST", "/auth/dev/login", map[string]string{"email": email}, http.StatusNoContent, nil)
	return c
}

func (c *client) do(method, path string, body any, wantStatus int, out any) {
	c.e.t.Helper()
	var rd io.Reader
	if s, ok := body.(string); ok {
		rd = strings.NewReader(s)
	} else if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.e.ts.URL+path, rd)
	resp, err := c.c.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		c.e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, wantStatus, data)
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			c.e.t.Fatalf("%s %s: decode %s: %v", method, path, data, err)
		}
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestRequiresLogin(t *testing.T) {
	e := newEnv(t)
	resp, err := http.Get(e.ts.URL + "/api/items")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestInventoryFlow(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")

	var me auth.User
	admin.do("GET", "/api/me", nil, 200, &me)
	if me.Role != "admin" {
		t.Fatalf("first user should be admin, got %s", me.Role)
	}

	// Two locations created together print as one strip.
	var room, shelf db.Location
	admin.do("POST", "/api/locations", map[string]any{"name": "Room", "print_label": true}, 200, &room)
	admin.do("POST", "/api/locations", map[string]any{"name": "Shelf A", "parent_id": room.ID, "print_label": true}, 200, &shelf)
	waitFor(t, "labels printed", func() bool { return len(e.printer.printed()) > 0 })
	if got := e.printer.printed(); len(got) != 1 || got[0] != 2 {
		t.Fatalf("print jobs %v, want one job of 2 labels", got)
	}
	var jobs []db.PrintJob
	admin.do("GET", "/api/print/jobs", nil, 200, &jobs)
	waitFor(t, "jobs done", func() bool {
		admin.do("GET", "/api/print/jobs", nil, 200, &jobs)
		return len(jobs) == 2 && jobs[0].Status == "done" && jobs[1].Status == "done"
	})
	if jobs[1].Code != fmt.Sprintf("L%d", room.ID) || jobs[1].Caption != "Room" {
		t.Fatalf("job %+v", jobs[1])
	}

	// Moving a location into its own child is refused.
	admin.do("PATCH", fmt.Sprintf("/api/locations/%d", room.ID), map[string]any{"name": "Room", "parent_id": shelf.ID}, 400, nil)

	var item db.Item
	admin.do("POST", "/api/items", map[string]any{"name": "BMP390 breakout", "kind": "consumable", "mpn": "BMP390"}, 200, &item)
	var st db.Stock
	admin.do("POST", "/api/stock", map[string]any{"item_id": item.ID, "location_id": shelf.ID, "quantity": 5}, 200, &st)
	admin.do("POST", fmt.Sprintf("/api/stock/%d/take", st.ID), map[string]any{"quantity": 2, "department_id": 3}, 200, &st)
	if st.Quantity != 3 {
		t.Fatalf("qty %v", st.Quantity)
	}
	admin.do("POST", fmt.Sprintf("/api/stock/%d/take", st.ID), map[string]any{"quantity": 9}, 400, nil)

	var search struct {
		Items []db.ListItemSummariesRow `json:"items"`
		Code  *struct{ Path string }    `json:"code"`
	}
	admin.do("GET", "/api/search?q=bmp390", nil, 200, &search)
	if len(search.Items) != 1 || search.Items[0].TotalQuantity != 3 {
		t.Fatalf("search %+v", search)
	}
	admin.do("GET", fmt.Sprintf("/api/search?q=s%d", st.ID), nil, 200, &search)
	if search.Code == nil || search.Code.Path != fmt.Sprintf("/stock/%d", st.ID) {
		t.Fatalf("code search %+v", search.Code)
	}

	// Shared tool: borrowed by one person, visible to everyone, returned by another.
	var scope db.Item
	admin.do("POST", "/api/items", map[string]any{"name": "Oscilloscope", "kind": "tool"}, 200, &scope)
	var assets []db.Asset
	admin.do("POST", "/api/assets", map[string]any{"item_id": scope.ID, "location_id": shelf.ID}, 200, &assets)
	bruno := e.login("bruno@portospaceteam.pt")
	bruno.do("POST", fmt.Sprintf("/api/assets/%d/borrow", assets[0].ID), map[string]any{"department_id": 7}, 200, nil)
	var loans []loanView
	admin.do("GET", "/api/loans", nil, 200, &loans)
	if len(loans) != 1 || loans[0].UserName != "bruno" || *loans[0].Loan.ProjectID != 2 {
		t.Fatalf("loans %+v", loans)
	}
	admin.do("POST", fmt.Sprintf("/api/assets/%d/borrow", assets[0].ID), map[string]any{}, 400, nil)
	admin.do("POST", fmt.Sprintf("/api/assets/%d/return", assets[0].ID), map[string]any{}, 204, nil)
	admin.do("GET", "/api/loans", nil, 200, &loans)
	if len(loans) != 0 {
		t.Fatalf("still on loan: %+v", loans)
	}

	// Label codes from QR codes redirect into the app.
	resp, err := admin.c.Get(e.ts.URL + fmt.Sprintf("/a%d", assets[0].ID))
	if err != nil {
		t.Fatal(err)
	}
	if loc := resp.Header.Get("Location"); resp.StatusCode != 302 || loc != fmt.Sprintf("/c/A%d", assets[0].ID) {
		t.Fatalf("redirect %d %q", resp.StatusCode, loc)
	}
	resp, err = admin.c.Get(e.ts.URL + fmt.Sprintf("/api/labels/A%d?symbology=qr", assets[0].ID))
	if err != nil || resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("label preview: %v %v", err, resp.Status)
	}
}

func TestOwnershipPermissions(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")
	member := e.login("rui@portospaceteam.pt")

	// Item owned by INVICTUS/Propulsion (department 4).
	var item db.Item
	admin.do("POST", "/api/items", map[string]any{"name": "Igniter", "kind": "hazmat", "owner_department_id": 4}, 200, &item)
	body := map[string]any{"name": "Igniter v2", "kind": "hazmat", "owner_department_id": 4}
	member.do("PATCH", fmt.Sprintf("/api/items/%d", item.ID), body, 403, nil)

	member.do("PUT", "/api/me/departments", map[string]any{"department_ids": []int64{4}}, 204, nil)
	member.do("PATCH", fmt.Sprintf("/api/items/%d", item.ID), body, 200, nil)

	// Project-owned: any department of the project may edit.
	var proj db.Item
	admin.do("POST", "/api/items", map[string]any{"name": "Nosecone mould", "kind": "tool", "owner_project_id": 1}, 200, &proj)
	member.do("PATCH", fmt.Sprintf("/api/items/%d", proj.ID), map[string]any{"name": "Nosecone mould", "kind": "tool", "owner_project_id": 1}, 200, nil)
	var icarus db.Item
	admin.do("POST", "/api/items", map[string]any{"name": "CubeSat frame", "kind": "flight_hw", "owner_project_id": 2}, 200, &icarus)
	member.do("PATCH", fmt.Sprintf("/api/items/%d", icarus.ID), map[string]any{"name": "x", "kind": "flight_hw"}, 403, nil)

	// Admin-only operations.
	member.do("DELETE", fmt.Sprintf("/api/items/%d", item.ID), nil, 403, nil)
	member.do("PATCH", "/api/users/1", map[string]any{"role": "member"}, 403, nil)
	admin.do("PATCH", "/api/users/1", map[string]any{"role": "member"}, 400, nil) // can't demote yourself
	admin.do("POST", "/api/items", map[string]any{"name": "x", "kind": "tool", "owner_project_id": 1, "owner_department_id": 4}, 400, nil)
}

func TestPrintFailureAndRetry(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")
	e.printer.mu.Lock()
	e.printer.fail = fmt.Errorf("printer: cover open")
	e.printer.mu.Unlock()

	var loc db.Location
	admin.do("POST", "/api/locations", map[string]any{"name": "Bin 1", "print_label": true}, 200, &loc)
	var jobs []db.PrintJob
	waitFor(t, "job failed", func() bool {
		admin.do("GET", "/api/print/jobs", nil, 200, &jobs)
		return len(jobs) == 1 && jobs[0].Status == "failed"
	})
	if jobs[0].Error != "printer: cover open" {
		t.Fatalf("error %q", jobs[0].Error)
	}

	e.printer.mu.Lock()
	e.printer.fail = nil
	e.printer.mu.Unlock()
	admin.do("POST", fmt.Sprintf("/api/print/jobs/%d/retry", jobs[0].ID), nil, 204, nil)
	waitFor(t, "job done", func() bool {
		admin.do("GET", "/api/print/jobs", nil, 200, &jobs)
		return jobs[0].Status == "done"
	})
	admin.do("POST", "/api/print", map[string]any{"labels": []map[string]string{{"code": "A999"}}}, 400, nil)
	// Bags carry item labels; stock codes are never printed.
	admin.do("POST", "/api/print", map[string]any{"labels": []map[string]string{{"code": "S1"}}}, 400, nil)
}

func TestPrintFollowsLoadedTape(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")
	var jobs []db.PrintJob
	printLabel := func(tapeMM int) {
		t.Helper()
		e.printer.mu.Lock()
		e.printer.tapeMM = tapeMM
		e.printer.mu.Unlock()
		admin.do("POST", "/api/locations", map[string]any{"name": fmt.Sprintf("Shelf %d", tapeMM), "print_label": true}, 200, nil)
		waitFor(t, "job done", func() bool {
			admin.do("GET", "/api/print/jobs", nil, 200, &jobs)
			return len(jobs) > 0 && jobs[0].Status != "queued" && jobs[0].Status != "printing"
		})
	}

	printLabel(24)
	printLabel(12)
	if h := e.printer.heights; len(h) != 2 || h[0] != labels.Tape24.BandDots || h[1] != labels.Tape12.BandDots {
		t.Fatalf("label heights %v, want [%d %d]", h, labels.Tape24.BandDots, labels.Tape12.BandDots)
	}

	printLabel(18)
	if jobs[0].Status != "failed" || !strings.Contains(jobs[0].Error, "12 or 24 mm") {
		t.Fatalf("job on 18 mm tape: %s %q", jobs[0].Status, jobs[0].Error)
	}
}

func TestImport(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")
	csv := "Name,Kind,Category,MPN,Quantity,Location,Owner\n" +
		"10k resistor 0603,consumable,Electronics/Passives,RC0603FR-0710KL,500,Room/Cabinet 1/Drawer 3,\n" +
		"Multimeter,tool,Tools,,3,Room/Tool wall,\n" +
		"N2O cylinder,hazmat,Propulsion,,1,Room/Hazmat cabinet,INVICTUS/Propulsion\n" +
		"10k resistor 0603,consumable,,RC0603FR-0710KL,100,Room/Cabinet 1/Drawer 3,\n"

	var res struct {
		Valid     bool         `json:"valid"`
		Committed bool         `json:"committed"`
		Rows      []*importRow `json:"rows"`
		Created   int          `json:"created_items"`
	}
	bad := csv + "Broken,widget,,,x,,MARS\n"
	admin.do("POST", "/api/import/items?commit=1", bad, 200, &res)
	if res.Valid || res.Committed || len(res.Rows[4].Errors) != 3 {
		t.Fatalf("invalid import was not refused: %+v", res.Rows[4])
	}
	var items []db.ListItemSummariesRow
	admin.do("GET", "/api/items", nil, 200, &items)
	if len(items) != 0 {
		t.Fatal("invalid import wrote data")
	}

	admin.do("POST", "/api/import/items?commit=1", csv, 200, &res)
	if !res.Committed || res.Created != 3 {
		t.Fatalf("import: %+v", res)
	}
	admin.do("GET", "/api/items", nil, 200, &items)
	byName := map[string]db.ListItemSummariesRow{}
	for _, it := range items {
		byName[it.Name] = it
	}
	if r := byName["10k resistor 0603"]; r.TotalQuantity != 600 {
		t.Fatalf("resistors %+v", r)
	}
	if m := byName["Multimeter"]; m.AssetCount != 3 {
		t.Fatalf("multimeters %+v", m)
	}
	if n := byName["N2O cylinder"]; n.OwnerDepartmentID == nil || *n.OwnerDepartmentID != 4 {
		t.Fatalf("N2O owner %+v", n)
	}
	var locs []db.Location
	admin.do("GET", "/api/locations", nil, 200, &locs)
	if len(locs) != 5 { // Room, Cabinet 1, Drawer 3, Tool wall, Hazmat cabinet
		t.Fatalf("%d locations", len(locs))
	}
}

func TestReservationsAPI(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")
	rui := e.login("rui@portospaceteam.pt")
	carla := e.login("carla@portospaceteam.pt")
	rui.do("PUT", "/api/me/departments", map[string]any{"department_ids": []int64{4}}, 204, nil)

	var loc db.Location
	admin.do("POST", "/api/locations", map[string]any{"name": "Shelf"}, 200, &loc)
	var item db.Item
	admin.do("POST", "/api/items", map[string]any{"name": "Igniter wire", "kind": "consumable", "unit": "m",
		"datasheet_url": "https://example.com/wire.pdf"}, 200, &item)
	var st db.Stock
	admin.do("POST", "/api/stock", map[string]any{"item_id": item.ID, "location_id": loc.ID, "quantity": 10}, 200, &st)

	var res db.Reservation
	rui.do("POST", "/api/reservations", map[string]any{"stock_id": st.ID, "quantity": 6, "department_id": 4,
		"note": "hot fire test", "until": "2099-01-01"}, 200, &res)

	var detail struct {
		Reservations []reservationView `json:"reservations"`
	}
	carla.do("GET", fmt.Sprintf("/api/stock/%d", st.ID), nil, 200, &detail)
	if len(detail.Reservations) != 1 || detail.Reservations[0].UserName != "rui" || detail.Reservations[0].Note != "hot fire test" {
		t.Fatalf("stock reservations %+v", detail.Reservations)
	}
	var items []db.ListItemSummariesRow
	carla.do("GET", "/api/items", nil, 200, &items)
	if items[0].ReservedQuantity != 6 || items[0].DatasheetUrl == "" {
		t.Fatalf("summary %+v", items[0])
	}

	// 4 m free: taking 5 needs confirmation, then works with the override.
	carla.do("POST", fmt.Sprintf("/api/stock/%d/take", st.ID), map[string]any{"quantity": 5}, 409, nil)
	carla.do("POST", fmt.Sprintf("/api/stock/%d/take", st.ID), map[string]any{"quantity": 5, "override_reserved": true}, 200, nil)

	// Only Propulsion, the reserver or an admin may release it.
	carla.do("POST", fmt.Sprintf("/api/reservations/%d/release", res.ID), nil, 403, nil)
	rui.do("POST", fmt.Sprintf("/api/reservations/%d/release", res.ID), nil, 204, nil)
	carla.do("GET", fmt.Sprintf("/api/stock/%d", st.ID), nil, 200, &detail)
	if len(detail.Reservations) != 0 {
		t.Fatal("released reservation still listed")
	}
}

func TestImportMessySpreadsheetData(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")
	csv := "name,kind,package,quantity,location,owner,status,reserved,reserved_note\n" +
		"Resistor 10k,consumable,0402,31,Núcleo PST/Caixa 1/Gaveta 6,,,,\n" +
		"Resistor 10k,consumable,0603,38,Núcleo PST/Caixa 1/Gaveta 6,,,,\n" +
		"Capacitor 33 pF,consumable,0603,9+1,Núcleo PST/Caixa 1/Gaveta 11,,,,\n" +
		"Diode RSX301L,consumable,,+++,Núcleo PST/Caixa 1/Gaveta 20,,,,\n" +
		"EMI shield S0981-46R,consumable,,~10,Núcleo PST/Caixa 2/Gaveta 37,,,,\n" +
		"Fio fluorocarbono 35.6 kg,consumable,,5 m,Sala FADEUP/Recuperação & Payload,INVICTUS/Recovery & Payload,,,\n" +
		"M4x12,consumable,,52,Sala FADEUP/Estruturas,INVICTUS/Structures,,all,Radax\n" +
		"Quick-link 8 mm,flight_hw,,3,Sala FADEUP/Recuperação & Payload,INVICTUS/Recovery & Payload,broken,,\n"
	var res struct {
		Valid     bool         `json:"valid"`
		Committed bool         `json:"committed"`
		Rows      []*importRow `json:"rows"`
	}
	admin.do("POST", "/api/import/items?commit=1", csv, 200, &res)
	if !res.Committed {
		for _, r := range res.Rows {
			if len(r.Errors) > 0 {
				t.Errorf("line %d: %v", r.Line, r.Errors)
			}
		}
		t.Fatal("not committed")
	}

	var items []db.ListItemSummariesRow
	admin.do("GET", "/api/items?q=resistor%2010k%200603", nil, 200, &items)
	if len(items) != 1 || items[0].Package != "0603" || items[0].TotalQuantity != 38 {
		t.Fatalf("multi-word search: %+v", items)
	}
	admin.do("GET", "/api/items", nil, 200, &items)
	got := map[string]db.ListItemSummariesRow{}
	for _, it := range items {
		got[it.Name+"/"+it.Package] = it
	}
	if len(got) != 8 {
		t.Fatalf("%d items, want 8 (the two resistor packages are separate items)", len(got))
	}
	if c := got["Capacitor 33 pF/0603"]; c.TotalQuantity != 10 {
		t.Errorf("9+1 = %v", c.TotalQuantity)
	}
	if d := got["Diode RSX301L/"]; d.UncountedLots != 1 || d.TotalQuantity != 0 {
		t.Errorf("uncounted: %+v", d)
	}
	if s := got["EMI shield S0981-46R/"]; s.ApproxLots != 1 || s.TotalQuantity != 10 {
		t.Errorf("approx: %+v", s)
	}
	if f := got["Fio fluorocarbono 35.6 kg/"]; f.Unit != "m" || f.TotalQuantity != 5 {
		t.Errorf("unit from quantity: %+v", f)
	}
	if m := got["M4x12/"]; m.ReservedQuantity != 52 {
		t.Errorf("reservation: %+v", m)
	}
	if q := got["Quick-link 8 mm/"]; q.AssetCount != 3 || q.AvailableCount != 0 {
		t.Errorf("broken units: %+v", q)
	}

	// Taking from an uncounted lot is logged and the lot stays "lots".
	var loc struct {
		Stock []db.ListStockByLocationRow `json:"stock"`
	}
	var locs []db.Location
	admin.do("GET", "/api/locations", nil, 200, &locs)
	for _, l := range locs {
		if l.Name == "Gaveta 20" {
			admin.do("GET", fmt.Sprintf("/api/locations/%d", l.ID), nil, 200, &loc)
		}
	}
	var st db.Stock
	admin.do("POST", fmt.Sprintf("/api/stock/%d/take", loc.Stock[0].Stock.ID), map[string]any{"quantity": 4}, 200, &st)
	if st.CountState != "uncounted" {
		t.Fatalf("after take: %+v", st)
	}
	admin.do("POST", fmt.Sprintf("/api/stock/%d/adjust", st.ID), map[string]any{"quantity": 61}, 200, &st)
	if st.CountState != "exact" || st.Quantity != 61 {
		t.Fatalf("after first count: %+v", st)
	}

	bad := "name,quantity,location,reserved,reserved_note\nX,10,Room,11,too many\nY,+++,Room,all,x\nZ,3,Room,2,\n"
	admin.do("POST", "/api/import/items", bad, 200, &res)
	for i, r := range res.Rows {
		if len(r.Errors) == 0 {
			t.Errorf("bad row %d accepted", i)
		}
	}
}

func TestSearchWithoutAccentsOrSymbols(t *testing.T) {
	e := newEnv(t)
	admin := e.login("ana@portospaceteam.pt")
	var cat db.Category
	admin.do("POST", "/api/categories", map[string]any{"name": "Resistências"}, 200, &cat)
	for _, it := range []map[string]any{
		{"name": "Resistência 10k Ω", "kind": "consumable", "package": "0603", "category_id": cat.ID},
		{"name": "Resistência 10 Ω", "kind": "consumable", "package": "0402", "category_id": cat.ID},
		{"name": "Condensador 100 nF", "kind": "consumable", "package": "0402"},
	} {
		admin.do("POST", "/api/items", it, 200, nil)
	}
	var loc db.Location
	admin.do("POST", "/api/locations", map[string]any{"name": "Recuperação & Payload"}, 200, &loc)

	names := func(q string) []string {
		var items []db.ListItemSummariesRow
		admin.do("GET", "/api/items?q="+url.QueryEscape(q), nil, 200, &items)
		var out []string
		for _, it := range items {
			out = append(out, it.Name+"/"+it.Package)
		}
		return out
	}
	for q, want := range map[string]string{
		"resistencia":      "Resistência 10 Ω/0402",
		"resistencias":     "Resistência 10 Ω/0402",
		"10 ohm":           "Resistência 10 Ω/0402",
		"10kohm":           "Resistência 10k Ω/0603",
		"resistencia 0603": "Resistência 10k Ω/0603",
		"100nf":            "Condensador 100 nF/0402",
	} {
		got := names(q)
		if len(got) == 0 || got[0] != want {
			t.Errorf("search %q = %v, want %q first", q, got, want)
		}
	}
	if got := names("resistencias"); len(got) != 2 {
		t.Errorf("resistencias = %v, want both resistors", got)
	}

	var res struct {
		Locations []db.Location `json:"locations"`
	}
	admin.do("GET", "/api/search?q=recuperacao", nil, 200, &res)
	if len(res.Locations) != 1 || res.Locations[0].ID != loc.ID {
		t.Fatalf("place search: %+v", res.Locations)
	}
}
