package inventory

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"inventarius/internal/db"
)

// Many people taking from the same lot at once never take more than there is.
func TestConcurrentTakes(t *testing.T) {
	ctx := context.Background()
	// A file database, so connections really run in parallel (":memory:" has one).
	store, err := db.Open(ctx, filepath.Join(t.TempDir(), "inv.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	svc := &Service{Store: store}
	user, _ := store.CreateUser(ctx, db.CreateUserParams{Email: "a@portospaceteam.pt", Name: "Ana", Role: "member"})
	item, _ := store.CreateItem(ctx, db.CreateItemParams{Name: "M3 screw", Kind: "consumable", Unit: "pcs"})
	loc, _ := store.CreateLocation(ctx, db.CreateLocationParams{Name: "Shelf A"})
	st, err := svc.Receive(ctx, user.ID, ReceiveParams{ItemID: item.ID, LocationID: loc.ID, Quantity: 10})
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	took, refused := 0, 0
	for range 25 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Take(ctx, user.ID, st.ID, 1, Purpose{})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				took++
			case isUserErr(err):
				refused++
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	got, _ := store.GetStock(ctx, st.ID)
	if took != 10 || refused != 15 || got.Quantity != 0 {
		t.Fatalf("took %d, refused %d, left %g", took, refused, got.Quantity)
	}
}

func TestTxContextIsAllOrNothing(t *testing.T) {
	f := setup(t)
	boom := errors.New("boom")
	err := f.q.TxContext(f.ctx, func(ctx context.Context, q *db.Queries) error {
		if _, err := f.svc.Receive(ctx, f.user.ID, ReceiveParams{ItemID: f.item.ID, LocationID: f.shelfA.ID, Quantity: 5}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatal(err)
	}
	if st, _ := f.q.ListStockByItem(f.ctx, f.item.ID); len(st) != 0 {
		t.Fatalf("stock was saved: %+v", st)
	}
}

func TestUpdateAssetFromOldVersion(t *testing.T) {
	f := setup(t)
	a, err := f.svc.CreateAsset(f.ctx, f.user.ID, AssetParams{ItemID: f.item.ID, LocationID: &f.shelfA.ID})
	if err != nil {
		t.Fatal(err)
	}
	v := a.Version
	// Someone borrows it after the edit form was opened.
	if _, err := f.svc.Borrow(f.ctx, f.user.ID, BorrowParams{AssetID: a.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateAsset(f.ctx, f.user.ID, a.ID, AssetParams{Status: "on_loan", Notes: "x", Version: &v}); !errors.Is(err, ErrChanged) {
		t.Fatalf("edit from old version: %v", err)
	}
}
