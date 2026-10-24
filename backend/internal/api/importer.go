package api

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"inventarius/internal/auth"
	"inventarius/internal/db"
	"inventarius/internal/inventory"
)

// importColumns are the CSV headers understood by the importer (any order,
// case-insensitive). Only "name" is required.
var importColumns = []string{
	"name", "kind", "category", "manufacturer", "mpn", "description", "unit", "min_stock",
	"supplier_url", "datasheet_url", "quantity", "location", "lot", "expires_on", "serial", "owner",
	"package", "status", "reserved", "reserved_for", "reserved_note",
}

type importRow struct {
	Line       int      `json:"line"`
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	Quantity   float64  `json:"quantity"`
	CountState string   `json:"count_state"`
	Location   string   `json:"location"`
	Errors     []string `json:"errors"`

	fields    map[string]string
	expiresOn *time.Time
	minStock  *float64
	owner     inventory.Owner
	qtyNote   string
	// Reservation made after the stock or units are added.
	reserveQty  float64 // 0 = none; for "all" it is the full quantity
	reserveFor  inventory.Owner
	reserveNote string
}

func isUnitKind(kind string) bool { return kind == "tool" || kind == "flight_hw" }

// importItems: POST /api/import/items?commit=1 with a CSV body. Without
// commit it only validates and reports. With commit it refuses to write
// anything unless every row is valid, and it imports in one transaction: if
// a row fails, nothing is imported.
func (s *Server) importItems(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	rows, err := s.parseImport(http.MaxBytesReader(w, r.Body, 5<<20))
	if err != nil {
		return err
	}
	valid := true
	for _, row := range rows {
		valid = valid && len(row.Errors) == 0
	}
	commit := r.URL.Query().Get("commit") == "1"
	result := map[string]any{"rows": rows, "valid": valid, "committed": false}
	if !commit || !valid {
		return writeJSON(w, result)
	}
	im := &importer{s: s, user: u, locs: map[string]int64{}, cats: map[string]int64{}}
	err = s.store.TxContext(r.Context(), func(ctx context.Context, q *db.Queries) error {
		im.ctx, im.q = ctx, q
		if err := im.load(); err != nil {
			return err
		}
		for _, row := range rows {
			if err := im.apply(row); err != nil {
				return badRequest(fmt.Sprintf("line %d: %v (nothing was imported)", row.Line, err))
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	result["committed"] = true
	result["created_items"] = im.createdItems
	return writeJSON(w, result)
}

func (s *Server) parseImport(body io.Reader) ([]*importRow, error) {
	cr := csv.NewReader(body)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true
	header, err := cr.Read()
	if err != nil {
		return nil, badRequest("could not read the CSV header")
	}
	col := map[string]int{}
	for i, h := range header {
		h = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(h, "\uFEFF")))
		col[h] = i
	}
	if _, ok := col["name"]; !ok {
		return nil, badRequest(`the CSV needs a "name" column; known columns: ` + strings.Join(importColumns, ", "))
	}
	var rows []*importRow
	for line := 2; ; line++ {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, badRequest(fmt.Sprintf("line %d: %v", line, err))
		}
		row := &importRow{Line: line, fields: map[string]string{}, Errors: []string{}}
		for _, c := range importColumns {
			if i, ok := col[c]; ok && i < len(rec) {
				row.fields[c] = strings.TrimSpace(rec[i])
			}
		}
		if strings.Join(rec, "") == "" {
			continue
		}
		s.validateRow(row)
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return nil, badRequest("the CSV has no rows")
	}
	if len(rows) > 5000 {
		return nil, badRequest("at most 5000 rows per import")
	}
	return rows, nil
}

func (s *Server) validateRow(row *importRow) {
	f := row.fields
	bad := func(format string, a ...any) { row.Errors = append(row.Errors, fmt.Sprintf(format, a...)) }

	row.Name = f["name"]
	if row.Name == "" {
		bad("name is empty")
	}
	row.Kind = strings.ToLower(f["kind"])
	if row.Kind == "" {
		row.Kind = "consumable"
	}
	switch row.Kind {
	case "consumable", "hazmat", "tool", "flight_hw":
	default:
		bad("kind %q: use consumable, tool, hazmat or flight_hw", row.Kind)
	}
	q, err := parseQuantity(f["quantity"])
	if err != nil {
		bad("%v", err)
	}
	row.Quantity, row.CountState, row.qtyNote = q.Value, q.State, q.Note
	if q.Unit != "" && f["unit"] == "" {
		f["unit"] = q.Unit
	}
	if isUnitKind(row.Kind) {
		if f["quantity"] == "" {
			row.Quantity = 1
		}
		if row.CountState != inventory.Exact || row.Quantity != float64(int(row.Quantity)) || row.Quantity > 50 {
			bad("tools and hardware are counted one by one: quantity must be a whole number up to 50")
		}
	}
	row.Location = f["location"]
	if (row.Quantity > 0 || row.CountState == inventory.Uncounted) && row.Location == "" {
		bad("quantity needs a location")
	}
	switch st := strings.ToLower(f["status"]); {
	case st == "":
	case !isUnitKind(row.Kind):
		bad("status only applies to tools and hardware")
	case st == "available" || st == "broken" || st == "in_repair" || st == "retired":
		f["status"] = st
	default:
		bad("status %q: use available, broken, in_repair or retired", st)
	}
	if e := f["expires_on"]; e != "" {
		t, err := time.Parse("2006-01-02", e)
		if err != nil {
			bad("expires_on %q: use YYYY-MM-DD", e)
		}
		row.expiresOn = &t
	}
	if m := f["min_stock"]; m != "" {
		v, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", "."), 64)
		if err != nil {
			bad("min_stock %q is not a number", m)
		}
		row.minStock = &v
	}
	if f["serial"] != "" && row.Quantity > 1 {
		bad("a serial number only fits a single tool")
	}
	if o := f["owner"]; o != "" {
		owner, err := s.parseOwner(o)
		if err != nil {
			bad("%v", err)
		}
		row.owner = owner
	}
	s.validateReservation(row, bad)
}

// validateReservation reads reserved ("all" or a number), reserved_for
// (owner format; defaults to the row's owner) and reserved_note (required).
func (s *Server) validateReservation(row *importRow, bad func(string, ...any)) {
	f := row.fields
	r := strings.ToLower(f["reserved"])
	if r == "" {
		if f["reserved_note"] != "" || f["reserved_for"] != "" {
			bad("reserved_for/reserved_note need a reserved quantity (a number or \"all\")")
		}
		return
	}
	row.reserveNote = f["reserved_note"]
	if row.reserveNote == "" {
		bad("a reservation needs reserved_note (what it is for)")
	}
	switch {
	case r == "all" && row.CountState == inventory.Uncounted:
		bad(`"all" of an uncounted lot can't be reserved; give a number`)
	case r == "all":
		row.reserveQty = row.Quantity
	default:
		v, err := strconv.ParseFloat(strings.ReplaceAll(r, ",", "."), 64)
		if err != nil || v <= 0 {
			bad("reserved %q: use a number or \"all\"", f["reserved"])
		}
		if row.CountState != inventory.Uncounted && v > row.Quantity {
			bad("reserved %g is more than the quantity %g", v, row.Quantity)
		}
		if isUnitKind(row.Kind) && v != float64(int(v)) {
			bad("reserve whole units")
		}
		row.reserveQty = v
	}
	row.reserveFor = row.owner
	if rf := f["reserved_for"]; rf != "" {
		o, err := s.parseOwner(rf)
		if err != nil {
			bad("reserved_for: %v", err)
		}
		row.reserveFor = o
	}
}

// parseOwner accepts "", "INVICTUS" or "INVICTUS/Propulsion".
func (s *Server) parseOwner(o string) (inventory.Owner, error) {
	proj, dep, hasDep := strings.Cut(o, "/")
	proj, dep = strings.TrimSpace(proj), strings.TrimSpace(dep)
	var projectID int64
	switch strings.ToUpper(proj) {
	case "INVICTUS":
		projectID = 1
	case "ICARUS":
		projectID = 2
	case "TEAM", "":
		return inventory.Owner{}, nil
	default:
		return inventory.Owner{}, fmt.Errorf("owner %q: use INVICTUS, ICARUS or PROJECT/Department", o)
	}
	if !hasDep {
		return inventory.Owner{ProjectID: &projectID}, nil
	}
	for _, d := range s.departments {
		if d.ProjectID == projectID && strings.EqualFold(d.Name, dep) {
			id := d.ID
			return inventory.Owner{DepartmentID: &id}, nil
		}
	}
	return inventory.Owner{}, fmt.Errorf("owner %q: no such department in %s", o, proj)
}

type importer struct {
	s *Server
	// ctx carries the import's transaction; q runs in it.
	ctx          context.Context
	q            *db.Queries
	user         *auth.User
	locs, cats   map[string]int64 // "parentID/lowercase name" -> id
	createdItems int
}

func key(parent *int64, name string) string {
	p := int64(0)
	if parent != nil {
		p = *parent
	}
	return fmt.Sprintf("%d/%s", p, strings.ToLower(name))
}

func (im *importer) load() error {
	locs, err := im.q.ListLocations(im.ctx)
	if err != nil {
		return err
	}
	for _, l := range locs {
		im.locs[key(l.ParentID, l.Name)] = l.ID
	}
	cats, err := im.q.ListCategories(im.ctx)
	if err != nil {
		return err
	}
	for _, c := range cats {
		im.cats[key(c.ParentID, c.Name)] = c.ID
	}
	return nil
}

// resolvePath walks "A/B/C", creating missing levels with create.
func resolvePath(path string, known map[string]int64, create func(parent *int64, name string) (int64, error)) (*int64, error) {
	var parent *int64
	for _, part := range strings.Split(path, "/") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		k := key(parent, part)
		id, ok := known[k]
		if !ok {
			var err error
			if id, err = create(parent, part); err != nil {
				return nil, err
			}
			known[k] = id
		}
		parent = &id
	}
	return parent, nil
}

func (im *importer) apply(row *importRow) error {
	ctx, f := im.ctx, row.fields
	var catID *int64
	if c := f["category"]; c != "" {
		var err error
		catID, err = resolvePath(c, im.cats, func(parent *int64, name string) (int64, error) {
			c, err := im.q.CreateCategory(ctx, db.CreateCategoryParams{ParentID: parent, Name: name})
			return c.ID, err
		})
		if err != nil {
			return err
		}
	}

	item, err := im.findItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		unit := f["unit"]
		if unit == "" {
			unit = "pcs"
		}
		item, err = im.q.CreateItem(ctx, db.CreateItemParams{
			Name: row.Name, Kind: row.Kind, CategoryID: catID, Description: f["description"],
			Manufacturer: f["manufacturer"], Mpn: f["mpn"], SupplierUrl: f["supplier_url"],
			DatasheetUrl: f["datasheet_url"], Unit: unit, MinStock: row.minStock,
			OwnerProjectID: row.owner.ProjectID, OwnerDepartmentID: row.owner.DepartmentID,
			Package: f["package"],
		})
		if err == nil {
			im.createdItems++
		}
	}
	if err != nil {
		return err
	}
	if row.Quantity == 0 && row.CountState != inventory.Uncounted {
		return nil
	}
	note := joinNote("imported", row.qtyNote)

	locID, err := resolvePath(row.Location, im.locs, func(parent *int64, name string) (int64, error) {
		l, err := im.q.CreateLocation(ctx, db.CreateLocationParams{ParentID: parent, Name: name})
		return l.ID, err
	})
	if err != nil {
		return err
	}
	if locID == nil {
		return fmt.Errorf("location %q is empty", row.Location)
	}
	why := inventory.Purpose{ProjectID: row.reserveFor.ProjectID, DepartmentID: row.reserveFor.DepartmentID, Note: row.reserveNote}
	if isUnitKind(row.Kind) {
		for i := range int(row.Quantity) {
			a, err := im.s.inv.CreateAsset(ctx, im.user.ID, inventory.AssetParams{
				ItemID: item.ID, Serial: f["serial"], LocationID: locID, Owner: row.owner, Notes: note,
				Status: f["status"],
			})
			if err != nil {
				return err
			}
			if float64(i) < row.reserveQty {
				if _, err := im.s.inv.Reserve(ctx, im.user.ID, inventory.ReserveParams{AssetID: &a.ID, Purpose: why}); err != nil {
					return err
				}
			}
		}
		return nil
	}
	st, err := im.s.inv.Receive(ctx, im.user.ID, inventory.ReceiveParams{
		ItemID: item.ID, LocationID: *locID, Quantity: row.Quantity, Lot: f["lot"],
		ExpiresOn: row.expiresOn, Owner: row.owner, Note: note, CountState: row.CountState,
	})
	if err != nil || row.reserveQty == 0 {
		return err
	}
	_, err = im.s.inv.Reserve(ctx, im.user.ID, inventory.ReserveParams{StockID: &st.ID, Quantity: row.reserveQty, Purpose: why})
	return err
}

func joinNote(a, b string) string {
	if b == "" {
		return a
	}
	return a + " " + b
}

// findItem matches an existing item by MPN, then by name and kind.
func (im *importer) findItem(row *importRow) (db.Item, error) {
	if mpn := row.fields["mpn"]; mpn != "" {
		it, err := im.q.FindItemByMPN(im.ctx, mpn)
		if !errors.Is(err, sql.ErrNoRows) {
			return it, err
		}
	}
	return im.q.FindItemByName(im.ctx, db.FindItemByNameParams{Name: row.Name, Kind: row.Kind, Package: row.fields["package"]})
}
