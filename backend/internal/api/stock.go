package api

import (
	"net/http"
	"time"

	"inventarius/internal/auth"
	"inventarius/internal/codes"
	"inventarius/internal/db"
	"inventarius/internal/inventory"
)

// date is a JSON "YYYY-MM-DD" (or null/"") date.
type date struct{ t *time.Time }

func (d *date) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" || s == `""` {
		d.t = nil
		return nil
	}
	t, err := time.Parse(`"2006-01-02"`, s)
	if err != nil {
		return badRequest("dates must look like 2026-12-31")
	}
	d.t = &t
	return nil
}

type purposeBody struct {
	ProjectID        *int64 `json:"project_id"`
	DepartmentID     *int64 `json:"department_id"`
	Note             string `json:"note"`
	ReservationID    *int64 `json:"reservation_id"`
	OverrideReserved bool   `json:"override_reserved"`
}

func (p purposeBody) inv() inventory.Purpose {
	return inventory.Purpose{
		ProjectID: p.ProjectID, DepartmentID: p.DepartmentID, Note: p.Note,
		ReservationID: p.ReservationID, OverrideReserved: p.OverrideReserved,
	}
}

// ---- stock ----

func (s *Server) receiveStock(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b struct {
		ItemID     int64   `json:"item_id"`
		LocationID int64   `json:"location_id"`
		Quantity   float64 `json:"quantity"`
		Lot        string  `json:"lot"`
		ExpiresOn  date    `json:"expires_on"`
		Note       string  `json:"note"`
		PrintLabel bool    `json:"print_label"`
		CountState string  `json:"count_state"`
		owner
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	st, err := s.inv.Receive(r.Context(), u.ID, inventory.ReceiveParams{
		ItemID: b.ItemID, LocationID: b.LocationID, Quantity: b.Quantity, Lot: b.Lot,
		ExpiresOn: b.ExpiresOn.t, Owner: b.owner.inv(), Note: b.Note, CountState: b.CountState,
	})
	if err != nil {
		return err
	}
	if b.PrintLabel {
		if it, err := s.store.GetItem(r.Context(), st.ItemID); err == nil {
			// Bags carry the item's label, not a stock one: every bag of the
			// same part shares it.
			s.enqueueLabel(r.Context(), u, codes.Item, it.ID, it.Name)
		}
	}
	return writeJSON(w, st)
}

func (s *Server) getStock(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	st, err := s.store.GetStock(ctx, id)
	if err != nil {
		return err
	}
	it, err := s.store.GetItem(ctx, st.ItemID)
	if err != nil {
		return err
	}
	loc, err := s.store.GetLocation(ctx, st.LocationID)
	if err != nil {
		return err
	}
	moves, err := s.store.ListMovements(ctx, db.ListMovementsParams{StockID: &id, Lim: 30})
	if err != nil {
		return err
	}
	res, err := s.reservations(ctx, it.ID, func(r db.Reservation) bool { return r.StockID != nil && *r.StockID == id })
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{
		"stock": st, "item": it, "location": loc, "movements": nonNil(moves), "reservations": res,
		"can_edit": s.canEdit(u, st.OwnerProjectID, st.OwnerDepartmentID),
	})
}

func (s *Server) updateStock(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	cur, err := s.store.GetStock(r.Context(), id)
	if err != nil {
		return err
	}
	if err := s.checkEdit(u, cur.OwnerProjectID, cur.OwnerDepartmentID); err != nil {
		return err
	}
	var b struct {
		Lot       string `json:"lot"`
		ExpiresOn date   `json:"expires_on"`
		owner
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := b.owner.inv().Validate(); err != nil {
		return err
	}
	st, err := s.store.UpdateStockDetails(r.Context(), db.UpdateStockDetailsParams{
		Lot: b.Lot, ExpiresOn: b.ExpiresOn.t, OwnerProjectID: b.OwnerProjectID, OwnerDepartmentID: b.OwnerDepartmentID, ID: id,
	})
	if err != nil {
		return err
	}
	return writeJSON(w, st)
}

func (s *Server) deleteStock(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	st, err := s.store.GetStock(r.Context(), id)
	if err != nil {
		return err
	}
	if st.Quantity != 0 && !u.IsAdmin() {
		return badRequest("write off the remaining quantity first")
	}
	if err := s.checkEdit(u, st.OwnerProjectID, st.OwnerDepartmentID); err != nil {
		return err
	}
	if err := s.store.DeleteStock(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// stockOp handles take, return, move, adjust and write-off.
func (s *Server) stockOp(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var b struct {
		Quantity     float64 `json:"quantity"`
		ToLocationID int64   `json:"to_location_id"`
		CountState   string  `json:"count_state"` // for adjust
		purposeBody
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	ctx := r.Context()
	var st db.Stock
	switch r.PathValue("op") {
	case "take":
		st, err = s.inv.Take(ctx, u.ID, id, b.Quantity, b.inv())
	case "return":
		st, err = s.inv.Return(ctx, u.ID, id, b.Quantity, b.inv())
	case "move":
		st, err = s.inv.Move(ctx, u.ID, id, b.ToLocationID, b.Quantity, b.Note)
	case "adjust", "write-off":
		cur, err := s.store.GetStock(ctx, id)
		if err != nil {
			return err
		}
		if err := s.checkEdit(u, cur.OwnerProjectID, cur.OwnerDepartmentID); err != nil {
			return err
		}
		if r.PathValue("op") == "adjust" {
			st, err = s.inv.Adjust(ctx, u.ID, id, b.Quantity, b.CountState, b.Note)
		} else {
			st, err = s.inv.WriteOff(ctx, u.ID, id, b.Quantity, b.Note)
		}
		if err != nil {
			return err
		}
	default:
		return errNotFound
	}
	if err != nil {
		return err
	}
	return writeJSON(w, st)
}

// ---- assets ----

type assetBody struct {
	ItemID     int64  `json:"item_id"`
	Serial     string `json:"serial"`
	LocationID *int64 `json:"location_id"`
	Condition  string `json:"condition"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
	PrintLabel bool   `json:"print_label"`
	// Count creates several identical assets at once (e.g. 5 multimeters).
	Count int `json:"count"`
	owner
}

func (b assetBody) params() inventory.AssetParams {
	return inventory.AssetParams{
		ItemID: b.ItemID, Serial: b.Serial, LocationID: b.LocationID, Condition: b.Condition,
		Status: b.Status, Notes: b.Notes, Owner: b.owner.inv(),
	}
}

func (s *Server) createAsset(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b assetBody
	if err := decode(r, &b); err != nil {
		return err
	}
	if b.Count == 0 {
		b.Count = 1
	}
	if b.Count < 1 || b.Count > 50 {
		return badRequest("count must be between 1 and 50")
	}
	it, err := s.store.GetItem(r.Context(), b.ItemID)
	if err != nil {
		return err
	}
	var out []db.Asset
	for range b.Count {
		a, err := s.inv.CreateAsset(r.Context(), u.ID, b.params())
		if err != nil {
			return err
		}
		out = append(out, a)
		if b.PrintLabel {
			s.enqueueLabel(r.Context(), u, codes.Asset, a.ID, it.Name)
		}
	}
	return writeJSON(w, out)
}

func (s *Server) getAsset(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	a, err := s.store.GetAsset(ctx, id)
	if err != nil {
		return err
	}
	it, err := s.store.GetItem(ctx, a.ItemID)
	if err != nil {
		return err
	}
	var loc *db.Location
	if a.LocationID != nil {
		if l, err := s.store.GetLocation(ctx, *a.LocationID); err == nil {
			loc = &l
		}
	}
	loans, err := s.store.ListLoansForAsset(ctx, id)
	if err != nil {
		return err
	}
	moves, err := s.store.ListMovements(ctx, db.ListMovementsParams{AssetID: &id, Lim: 30})
	if err != nil {
		return err
	}
	res, err := s.reservations(ctx, it.ID, func(r db.Reservation) bool { return r.AssetID != nil && *r.AssetID == id })
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{
		"asset": a, "item": it, "location": loc, "loans": nonNil(loans), "movements": nonNil(moves),
		"reservations": res,
		"can_edit":     s.canEdit(u, a.OwnerProjectID, a.OwnerDepartmentID),
	})
}

func (s *Server) updateAsset(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	cur, err := s.store.GetAsset(r.Context(), id)
	if err != nil {
		return err
	}
	if err := s.checkEdit(u, cur.OwnerProjectID, cur.OwnerDepartmentID); err != nil {
		return err
	}
	var b assetBody
	if err := decode(r, &b); err != nil {
		return err
	}
	a, err := s.inv.UpdateAsset(r.Context(), u.ID, id, b.params())
	if err != nil {
		return err
	}
	return writeJSON(w, a)
}

func (s *Server) deleteAsset(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if err := requireAdmin(u); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if err := s.store.DeleteAsset(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) borrowAsset(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var b struct {
		DueAt *time.Time `json:"due_at"`
		purposeBody
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	if b.DueAt != nil {
		if b.DueAt.Before(time.Now()) {
			return badRequest("the due time is in the past")
		}
		t := b.DueAt.UTC()
		b.DueAt = &t
	}
	loan, err := s.inv.Borrow(r.Context(), u.ID, inventory.BorrowParams{AssetID: id, DueAt: b.DueAt, Purpose: b.inv()})
	if err != nil {
		return err
	}
	return writeJSON(w, loan)
}

func (s *Server) returnAsset(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var b struct {
		LocationID *int64 `json:"location_id"`
		Note       string `json:"note"`
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	if err := s.inv.GiveBack(r.Context(), u.ID, id, b.LocationID, b.Note); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- loans and history ----

type loanView struct {
	db.ListOpenLoansRow
	Overdue bool `json:"overdue"`
}

func (s *Server) listLoans(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var userID *int64
	if r.URL.Query().Get("mine") == "1" {
		userID = &u.ID
	}
	rows, err := s.store.ListOpenLoans(r.Context(), userID)
	if err != nil {
		return err
	}
	now := time.Now()
	out := make([]loanView, len(rows))
	for i, l := range rows {
		out[i] = loanView{ListOpenLoansRow: l, Overdue: l.Loan.DueAt != nil && l.Loan.DueAt.Before(now)}
	}
	return writeJSON(w, out)
}

func (s *Server) listMovements(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	rows, err := s.store.ListMovements(r.Context(), db.ListMovementsParams{
		ItemID:  queryInt(r, "item_id"),
		AssetID: queryInt(r, "asset_id"),
		StockID: queryInt(r, "stock_id"),
		UserID:  queryInt(r, "user_id"),
		Lim:     limit(r, 100, 1000),
	})
	if err != nil {
		return err
	}
	return writeJSON(w, nonNil(rows))
}
