// Package inventory implements the operations that change stock and assets.
// Each one runs in a single transaction and writes its own movement record,
// so the audit log can never disagree with the stock it describes.
package inventory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"time"

	"inventarius/internal/db"
)

// UserError is a problem with the request (shown to the user), as opposed
// to an internal failure.
type UserError struct{ Msg string }

func (e *UserError) Error() string { return e.Msg }

func userErr(format string, a ...any) error { return &UserError{fmt.Sprintf(format, a...)} }

var ErrNotFound = errors.New("not found")

// ErrChanged means someone else saved the thing after the user opened it.
var ErrChanged = errors.New("someone else changed this while you were editing it; reload to see their changes, then try again")

// CheckVersion refuses an edit made from an older version of a row. A nil
// want (a client that does not send the version) skips the check.
func CheckVersion(have int64, want *int64) error {
	if want != nil && *want != have {
		return ErrChanged
	}
	return nil
}

type Service struct {
	Store *db.Store
}

// Purpose records who something was used for.
type Purpose struct {
	ProjectID    *int64
	DepartmentID *int64
	Note         string
	// ReservationID takes from that reservation first (take only).
	ReservationID *int64
	// OverrideReserved allows using things reserved for someone else,
	// after the user confirmed.
	OverrideReserved bool
}

// Owner of an item, stock lot or asset; both nil means the whole team.
type Owner struct {
	ProjectID    *int64
	DepartmentID *int64
}

func (o Owner) Validate() error {
	if o.ProjectID != nil && o.DepartmentID != nil {
		return userErr("owner is either a project or a department, not both")
	}
	return nil
}

// round keeps float quantities from accumulating noise (0.1+0.2).
func round(q float64) float64 { return math.Round(q*1000) / 1000 }

func positive(q float64) (float64, error) {
	q = round(q)
	if q <= 0 || math.IsNaN(q) || math.IsInf(q, 0) {
		return 0, userErr("quantity must be greater than zero")
	}
	return q, nil
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// purposeProject fills in the project when only a department is given.
func purposeProject(ctx context.Context, q *db.Queries, p Purpose) (Purpose, error) {
	if p.DepartmentID == nil {
		return p, nil
	}
	d, err := q.GetDepartment(ctx, *p.DepartmentID)
	if err != nil {
		return p, userErr("unknown department")
	}
	if p.ProjectID != nil && *p.ProjectID != d.ProjectID {
		return p, userErr("department %q is not in that project", d.Name)
	}
	p.ProjectID = &d.ProjectID
	return p, nil
}

type ReceiveParams struct {
	ItemID     int64
	LocationID int64
	Quantity   float64
	Lot        string
	ExpiresOn  *time.Time
	Owner      Owner
	Note       string
	// CountState: "exact" (default), "approx" or "uncounted" (plenty,
	// not counted; Quantity is then ignored).
	CountState string
}

const (
	Exact     = "exact"
	Approx    = "approx"
	Uncounted = "uncounted"
)

func validCountState(s string) (string, error) {
	switch s {
	case "":
		return Exact, nil
	case Exact, Approx, Uncounted:
		return s, nil
	}
	return "", userErr("count must be exact, approx or uncounted")
}

// combineCounts: merging lots keeps the less certain state.
func combineCounts(a, b string) string {
	if a == Uncounted || b == Uncounted {
		return Uncounted
	}
	if a == Approx || b == Approx {
		return Approx
	}
	return Exact
}

// Receive adds new stock to a location. It merges into an existing lot with
// identical details instead of creating a duplicate row.
func (s *Service) Receive(ctx context.Context, userID int64, p ReceiveParams) (db.Stock, error) {
	state, err := validCountState(p.CountState)
	if err != nil {
		return db.Stock{}, err
	}
	qty := 0.0
	if state != Uncounted {
		if qty, err = positive(p.Quantity); err != nil {
			return db.Stock{}, err
		}
	}
	if err := p.Owner.Validate(); err != nil {
		return db.Stock{}, err
	}
	if p.ExpiresOn != nil {
		d := p.ExpiresOn.UTC().Truncate(24 * time.Hour)
		p.ExpiresOn = &d
	}
	var out db.Stock
	err = s.Store.Tx(ctx, func(q *db.Queries) error {
		if _, err := q.GetItem(ctx, p.ItemID); err != nil {
			return notFound(err)
		}
		if _, err := q.GetLocation(ctx, p.LocationID); err != nil {
			return userErr("unknown location")
		}
		existing, err := q.FindMergeableStock(ctx, db.FindMergeableStockParams{
			ItemID: p.ItemID, LocationID: p.LocationID, Lot: p.Lot, ExpiresOn: p.ExpiresOn,
			OwnerProjectID: p.Owner.ProjectID, OwnerDepartmentID: p.Owner.DepartmentID,
		})
		switch {
		case err == nil:
			existing.CountState = combineCounts(existing.CountState, state)
			existing.Quantity = round(existing.Quantity + qty)
			if existing.CountState == Uncounted {
				existing.Quantity = 0
			}
			if err := q.SetStockCount(ctx, db.SetStockCountParams{
				Quantity: existing.Quantity, CountState: existing.CountState, ID: existing.ID,
			}); err != nil {
				return err
			}
			out = existing
		case errors.Is(err, sql.ErrNoRows):
			out, err = q.CreateStock(ctx, db.CreateStockParams{
				ItemID: p.ItemID, LocationID: p.LocationID, Quantity: qty, Lot: p.Lot, ExpiresOn: p.ExpiresOn,
				OwnerProjectID: p.Owner.ProjectID, OwnerDepartmentID: p.Owner.DepartmentID, CountState: state,
			})
			if err != nil {
				return err
			}
		default:
			return err
		}
		return q.CreateMovement(ctx, db.CreateMovementParams{
			UserID: userID, Kind: "receive", ItemID: p.ItemID, StockID: &out.ID,
			ToLocationID: &p.LocationID, Quantity: qty, Note: p.Note,
		})
	})
	return out, err
}

// Take removes qty from a stock lot, for the given purpose.
func (s *Service) Take(ctx context.Context, userID, stockID int64, qty float64, why Purpose) (db.Stock, error) {
	return s.change(ctx, userID, stockID, qty, "take", why)
}

// Return puts qty back into a stock lot (leftovers, unused parts).
func (s *Service) Return(ctx context.Context, userID, stockID int64, qty float64, why Purpose) (db.Stock, error) {
	return s.change(ctx, userID, stockID, qty, "return", why)
}

// WriteOff removes broken, expired or lost stock.
func (s *Service) WriteOff(ctx context.Context, userID, stockID int64, qty float64, note string) (db.Stock, error) {
	return s.change(ctx, userID, stockID, qty, "write_off", Purpose{Note: note})
}

func (s *Service) change(ctx context.Context, userID, stockID int64, qty float64, kind string, why Purpose) (db.Stock, error) {
	qty, err := positive(qty)
	if err != nil {
		return db.Stock{}, err
	}
	delta := qty
	if kind != "return" {
		delta = -qty
	}
	var st db.Stock
	err = s.Store.Tx(ctx, func(q *db.Queries) error {
		var err error
		if why, err = purposeProject(ctx, q, why); err != nil {
			return err
		}
		if st, err = q.GetStock(ctx, stockID); err != nil {
			return notFound(err)
		}
		next := round(st.Quantity + delta)
		switch st.CountState {
		case Uncounted:
			// Nobody knows how many there are: log the change, keep "lots".
			next = 0
		case Approx:
			next = max(next, 0)
		default:
			if next < 0 {
				return userErr("only %g left here", st.Quantity)
			}
		}
		var resID *int64
		if kind == "take" || kind == "write_off" {
			var extra string
			if resID, extra, err = takeFromStock(ctx, q, st, qty, &why); err != nil {
				return err
			}
			why.Note = joinNotes(why.Note, extra)
		}
		st.Quantity = next
		if err := q.SetStockQuantity(ctx, db.SetStockQuantityParams{Quantity: next, ID: st.ID}); err != nil {
			return err
		}
		m := db.CreateMovementParams{
			UserID: userID, Kind: kind, ItemID: st.ItemID, StockID: &st.ID, Quantity: delta,
			ProjectID: why.ProjectID, DepartmentID: why.DepartmentID, Note: why.Note, ReservationID: resID,
		}
		if delta < 0 {
			m.FromLocationID = &st.LocationID
		} else {
			m.ToLocationID = &st.LocationID
		}
		return q.CreateMovement(ctx, m)
	})
	return st, err
}

// Adjust sets the counted quantity (stocktake), recording the difference.
// state says how well it was counted ("" means exact).
func (s *Service) Adjust(ctx context.Context, userID, stockID int64, counted float64, state, note string) (db.Stock, error) {
	state, err := validCountState(state)
	if err != nil {
		return db.Stock{}, err
	}
	counted = round(counted)
	if state == Uncounted {
		counted = 0
	}
	if counted < 0 || math.IsNaN(counted) {
		return db.Stock{}, userErr("quantity cannot be negative")
	}
	var st db.Stock
	err = s.Store.Tx(ctx, func(q *db.Queries) error {
		var err error
		if st, err = q.GetStock(ctx, stockID); err != nil {
			return notFound(err)
		}
		delta := round(counted - st.Quantity)
		if delta == 0 && state == st.CountState {
			return nil
		}
		switch {
		case st.CountState == Uncounted && state != Uncounted:
			// First real count: there was no number to compare with.
			note = joinNotes(note, "first count")
			delta = counted
		case state == Uncounted:
			note = joinNotes(note, "marked as not counted")
			delta = 0
		case state == Approx:
			note = joinNotes(note, "estimate")
		}
		st.Quantity, st.CountState = counted, state
		if err := q.SetStockCount(ctx, db.SetStockCountParams{Quantity: counted, CountState: state, ID: st.ID}); err != nil {
			return err
		}
		return q.CreateMovement(ctx, db.CreateMovementParams{
			UserID: userID, Kind: "adjust", ItemID: st.ItemID, StockID: &st.ID,
			ToLocationID: &st.LocationID, Quantity: delta, Note: note,
		})
	})
	return st, err
}

// Move transfers qty of a stock lot to another location, merging into a
// matching lot there. Moving everything keeps the same stock row (and label).
func (s *Service) Move(ctx context.Context, userID, stockID, toLocationID int64, qty float64, note string) (db.Stock, error) {
	qty, err := positive(qty)
	if err != nil {
		return db.Stock{}, err
	}
	var dest db.Stock
	err = s.Store.Tx(ctx, func(q *db.Queries) error {
		src, err := q.GetStock(ctx, stockID)
		if err != nil {
			return notFound(err)
		}
		if src.LocationID == toLocationID {
			return userErr("it is already there")
		}
		if _, err := q.GetLocation(ctx, toLocationID); err != nil {
			return userErr("unknown location")
		}
		if src.CountState == Uncounted {
			// "Some" of an uncounted lot can't be split off: the lot moves.
			if err := q.SetStockLocation(ctx, db.SetStockLocationParams{LocationID: toLocationID, ID: src.ID}); err != nil {
				return err
			}
			dest = src
			dest.LocationID = toLocationID
			return q.CreateMovement(ctx, db.CreateMovementParams{
				UserID: userID, Kind: "move", ItemID: src.ItemID, StockID: &dest.ID,
				FromLocationID: &src.LocationID, ToLocationID: &toLocationID, Note: note,
			})
		}
		if qty > src.Quantity {
			return userErr("only %g here to move", src.Quantity)
		}
		match, err := q.FindMergeableStock(ctx, db.FindMergeableStockParams{
			ItemID: src.ItemID, LocationID: toLocationID, Lot: src.Lot, ExpiresOn: src.ExpiresOn,
			OwnerProjectID: src.OwnerProjectID, OwnerDepartmentID: src.OwnerDepartmentID, ExcludeID: src.ID,
		})
		switch {
		case err == nil:
			match.CountState = combineCounts(match.CountState, src.CountState)
			match.Quantity = round(match.Quantity + qty)
			if match.CountState == Uncounted {
				match.Quantity = 0
			}
			if err := q.SetStockCount(ctx, db.SetStockCountParams{
				Quantity: match.Quantity, CountState: match.CountState, ID: match.ID,
			}); err != nil {
				return err
			}
			if err := q.SetStockQuantity(ctx, db.SetStockQuantityParams{Quantity: round(src.Quantity - qty), ID: src.ID}); err != nil {
				return err
			}
			dest = match
		case !errors.Is(err, sql.ErrNoRows):
			return err
		case qty == src.Quantity:
			// Whole lot moves: relocate the row itself.
			if err := q.SetStockLocation(ctx, db.SetStockLocationParams{LocationID: toLocationID, ID: src.ID}); err != nil {
				return err
			}
			dest = src
			dest.LocationID = toLocationID
		default:
			if err := q.SetStockQuantity(ctx, db.SetStockQuantityParams{Quantity: round(src.Quantity - qty), ID: src.ID}); err != nil {
				return err
			}
			dest, err = q.CreateStock(ctx, db.CreateStockParams{
				ItemID: src.ItemID, LocationID: toLocationID, Quantity: qty, Lot: src.Lot, ExpiresOn: src.ExpiresOn,
				OwnerProjectID: src.OwnerProjectID, OwnerDepartmentID: src.OwnerDepartmentID,
				CountState: src.CountState,
			})
			if err != nil {
				return err
			}
		}
		return q.CreateMovement(ctx, db.CreateMovementParams{
			UserID: userID, Kind: "move", ItemID: src.ItemID, StockID: &dest.ID,
			FromLocationID: &src.LocationID, ToLocationID: &toLocationID, Quantity: qty, Note: note,
		})
	})
	return dest, err
}

type BorrowParams struct {
	AssetID int64
	DueAt   *time.Time
	Purpose Purpose
}

// Borrow checks out an available asset to a user.
func (s *Service) Borrow(ctx context.Context, userID int64, p BorrowParams) (db.Loan, error) {
	var loan db.Loan
	err := s.Store.Tx(ctx, func(q *db.Queries) error {
		why, err := purposeProject(ctx, q, p.Purpose)
		if err != nil {
			return err
		}
		a, err := q.GetAsset(ctx, p.AssetID)
		if err != nil {
			return notFound(err)
		}
		if a.Status != "available" {
			if a.Status == "on_loan" {
				if l, err := q.GetOpenLoanForAsset(ctx, a.ID); err == nil {
					if u, err := q.GetUser(ctx, l.UserID); err == nil {
						return userErr("%s already has it", u.Name)
					}
				}
			}
			return userErr("it is %s, not available", a.Status)
		}
		extra, err := borrowCheck(ctx, q, userID, a, why)
		if err != nil {
			return err
		}
		loan, err = q.CreateLoan(ctx, db.CreateLoanParams{
			AssetID: a.ID, UserID: userID, ProjectID: why.ProjectID, DepartmentID: why.DepartmentID,
			DueAt: p.DueAt, Note: why.Note,
		})
		if err != nil {
			return err
		}
		if err := q.SetAssetState(ctx, db.SetAssetStateParams{Status: "on_loan", LocationID: a.LocationID, ID: a.ID}); err != nil {
			return err
		}
		return q.CreateMovement(ctx, db.CreateMovementParams{
			UserID: userID, Kind: "borrow", ItemID: a.ItemID, AssetID: &a.ID, FromLocationID: a.LocationID,
			Quantity: -1, ProjectID: why.ProjectID, DepartmentID: why.DepartmentID, Note: joinNotes(why.Note, extra),
		})
	})
	return loan, err
}

// GiveBack returns a borrowed asset, optionally to a different location.
// Anyone may return it (people often return tools for each other); the log
// records who did.
func (s *Service) GiveBack(ctx context.Context, userID, assetID int64, toLocationID *int64, note string) error {
	return s.Store.Tx(ctx, func(q *db.Queries) error {
		a, err := q.GetAsset(ctx, assetID)
		if err != nil {
			return notFound(err)
		}
		loan, err := q.GetOpenLoanForAsset(ctx, assetID)
		if errors.Is(err, sql.ErrNoRows) {
			return userErr("it is not on loan")
		} else if err != nil {
			return err
		}
		loc := a.LocationID
		if toLocationID != nil {
			if _, err := q.GetLocation(ctx, *toLocationID); err != nil {
				return userErr("unknown location")
			}
			loc = toLocationID
		}
		if err := q.CloseLoan(ctx, loan.ID); err != nil {
			return err
		}
		if err := q.SetAssetState(ctx, db.SetAssetStateParams{Status: "available", LocationID: loc, ID: a.ID}); err != nil {
			return err
		}
		return q.CreateMovement(ctx, db.CreateMovementParams{
			UserID: userID, Kind: "give_back", ItemID: a.ItemID, AssetID: &a.ID, ToLocationID: loc,
			Quantity: 1, ProjectID: loan.ProjectID, DepartmentID: loan.DepartmentID, Note: note,
		})
	})
}

type AssetParams struct {
	ItemID     int64
	Serial     string
	LocationID *int64
	Condition  string
	Status     string
	Notes      string
	Owner      Owner
	// Version the edit was made from (UpdateAsset only).
	Version *int64
}

func validAssetStatus(s string) error {
	switch s {
	case "available", "broken", "in_repair", "retired":
		return nil
	case "on_loan":
		return userErr("use borrow to put an asset on loan")
	}
	return userErr("unknown status %q", s)
}

func (s *Service) CreateAsset(ctx context.Context, userID int64, p AssetParams) (db.Asset, error) {
	if p.Status == "" {
		p.Status = "available"
	}
	if err := validAssetStatus(p.Status); err != nil {
		return db.Asset{}, err
	}
	if err := p.Owner.Validate(); err != nil {
		return db.Asset{}, err
	}
	var a db.Asset
	err := s.Store.Tx(ctx, func(q *db.Queries) error {
		if _, err := q.GetItem(ctx, p.ItemID); err != nil {
			return notFound(err)
		}
		if p.LocationID != nil {
			if _, err := q.GetLocation(ctx, *p.LocationID); err != nil {
				return userErr("unknown location")
			}
		}
		var err error
		a, err = q.CreateAsset(ctx, db.CreateAssetParams{
			ItemID: p.ItemID, Serial: p.Serial, LocationID: p.LocationID, Condition: p.Condition,
			Status: p.Status, Notes: p.Notes, OwnerProjectID: p.Owner.ProjectID, OwnerDepartmentID: p.Owner.DepartmentID,
		})
		if err != nil {
			return err
		}
		return q.CreateMovement(ctx, db.CreateMovementParams{
			UserID: userID, Kind: "asset_create", ItemID: a.ItemID, AssetID: &a.ID, ToLocationID: a.LocationID, Quantity: 1,
		})
	})
	return a, err
}

// UpdateAsset edits an asset. Its status can't be set to or from on_loan
// here: loans go through Borrow and GiveBack.
func (s *Service) UpdateAsset(ctx context.Context, userID, assetID int64, p AssetParams) (db.Asset, error) {
	if err := p.Owner.Validate(); err != nil {
		return db.Asset{}, err
	}
	var a db.Asset
	err := s.Store.Tx(ctx, func(q *db.Queries) error {
		cur, err := q.GetAsset(ctx, assetID)
		if err != nil {
			return notFound(err)
		}
		if err := CheckVersion(cur.Version, p.Version); err != nil {
			return err
		}
		if cur.Status == "on_loan" && p.Status != "on_loan" {
			return userErr("it is on loan; return it first")
		}
		if cur.Status != "on_loan" {
			if err := validAssetStatus(p.Status); err != nil {
				return err
			}
		}
		if p.LocationID != nil {
			if _, err := q.GetLocation(ctx, *p.LocationID); err != nil {
				return userErr("unknown location")
			}
		}
		a, err = q.UpdateAsset(ctx, db.UpdateAssetParams{
			Serial: p.Serial, LocationID: p.LocationID, Condition: p.Condition, Status: p.Status, Notes: p.Notes,
			OwnerProjectID: p.Owner.ProjectID, OwnerDepartmentID: p.Owner.DepartmentID, ID: assetID,
		})
		if err != nil {
			return err
		}
		note := ""
		if cur.Status != a.Status {
			note = cur.Status + " → " + a.Status
		}
		return q.CreateMovement(ctx, db.CreateMovementParams{
			UserID: userID, Kind: "asset_update", ItemID: a.ItemID, AssetID: &a.ID,
			FromLocationID: cur.LocationID, ToLocationID: a.LocationID, Note: note,
		})
	})
	return a, err
}
