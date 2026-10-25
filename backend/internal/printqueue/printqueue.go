// Package printqueue prints label jobs in the background. Jobs are stored in
// the database, collected for a short delay and sent to the printer as one
// batch, because every print job wastes ~24.5 mm of tape feeding to the
// cutter but labels within a job do not.
package printqueue

import (
	"context"
	"fmt"
	"image"
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"inventarius/internal/db"
	"inventarius/internal/labels"
	"inventarius/internal/ptouch"
)

// fileTapeMM is the tape FilePrinter pretends to have loaded.
const fileTapeMM = 12

// Printer is implemented by *ptouch.Printer and FilePrinter.
type Printer interface {
	Status(ctx context.Context) (ptouch.Status, error)
	Print(ctx context.Context, labels []image.Image, wantTapeMM int) (ptouch.Result, error)
}

// FilePrinter writes labels as PNG previews to a directory (development).
type FilePrinter struct{ Dir string }

func (f FilePrinter) Status(context.Context) (ptouch.Status, error) {
	return ptouch.Status{Model: ptouch.ModelPTE550W, MediaWidth: fileTapeMM, MediaType: 0x01}, nil
}

func (f FilePrinter) Print(_ context.Context, imgs []image.Image, tapeMM int) (ptouch.Result, error) {
	tape, err := labels.TapeFor(tapeMM)
	if err != nil {
		return ptouch.Result{}, err
	}
	if err := os.MkdirAll(f.Dir, 0o755); err != nil {
		return ptouch.Result{}, err
	}
	stamp := time.Now().Format("20060102-150405.000")
	for i, img := range imgs {
		out, err := os.Create(filepath.Join(f.Dir, fmt.Sprintf("%s-%02d.png", stamp, i)))
		if err != nil {
			return ptouch.Result{}, err
		}
		err = png.Encode(out, labels.Preview(img, tape))
		out.Close()
		if err != nil {
			return ptouch.Result{}, err
		}
	}
	st, _ := f.Status(context.Background())
	return ptouch.Result{Status: st, Confirmed: true}, nil
}

// PrinterState is the last known printer state, for the UI.
type PrinterState struct {
	Enabled   bool      `json:"enabled"`
	Model     string    `json:"model,omitempty"`
	TapeMM    int       `json:"tape_mm"`
	Problems  []string  `json:"problems"`
	Error     string    `json:"error,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
	Busy      bool      `json:"busy"`
}

type Queue struct {
	store      *db.Store
	printer    Printer // nil: printing disabled, jobs stay queued
	batchDelay time.Duration
	render     func(db.PrintJob, labels.Tape) (image.Image, error)

	wake chan struct{}

	mu    sync.Mutex // serializes access to the printer
	state PrinterState
	smu   sync.Mutex // guards state
}

// New creates a queue. render turns a job into a label image for a tape.
func New(store *db.Store, p Printer, batchDelay time.Duration, render func(db.PrintJob, labels.Tape) (image.Image, error)) *Queue {
	return &Queue{
		store: store, printer: p, batchDelay: batchDelay, render: render,
		wake:  make(chan struct{}, 1),
		state: PrinterState{Enabled: p != nil, Problems: []string{}},
	}
}

// Enqueue adds jobs and wakes the worker.
func (q *Queue) Enqueue(ctx context.Context, userID int64, jobs []db.CreatePrintJobParams) ([]db.PrintJob, error) {
	var out []db.PrintJob
	err := q.store.Tx(ctx, func(tx *db.Queries) error {
		for _, j := range jobs {
			j.UserID = userID
			pj, err := tx.CreatePrintJob(ctx, j)
			if err != nil {
				return err
			}
			out = append(out, pj)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	q.Wake()
	return out, nil
}

// Wake makes the worker look for queued jobs.
func (q *Queue) Wake() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// Run processes jobs until ctx is cancelled.
func (q *Queue) Run(ctx context.Context) {
	// Jobs interrupted by a restart are retried.
	if err := q.store.RequeueInterruptedPrintJobs(ctx); err != nil {
		slog.Error("requeue print jobs", "err", err)
	}
	if q.printer == nil {
		slog.Warn("no printer configured (INVENTARIUS_PRINTER); label jobs will stay queued")
		return
	}
	q.Wake()
	for {
		select {
		case <-ctx.Done():
			return
		case <-q.wake:
		}
		// Let a burst of new labels arrive so they print as one strip.
		select {
		case <-ctx.Done():
			return
		case <-time.After(q.batchDelay):
		}
		for q.printBatch(ctx) {
		}
	}
}

// printBatch prints up to 50 queued jobs; it reports whether it printed
// anything (so the caller loops until the queue is empty or failing).
func (q *Queue) printBatch(ctx context.Context) bool {
	jobs, err := q.store.ListQueuedPrintJobs(ctx, 50)
	if err != nil || len(jobs) == 0 {
		return false
	}

	q.mu.Lock()
	defer q.mu.Unlock()
	q.setBusy(true)
	defer q.setBusy(false)
	pctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	// Lay the labels out for the tape that is loaded now.
	st, err := q.printer.Status(pctx)
	if err == nil {
		err = st.Err()
	}
	var tape labels.Tape
	if err == nil {
		tape, err = labels.TapeFor(st.MediaWidth)
	}
	if err != nil {
		q.recordStatus(st, err)
		slog.Warn("print failed", "labels", len(jobs), "err", err)
		for _, j := range jobs {
			q.setJob(ctx, j.ID, "failed", err.Error())
		}
		return false
	}

	var imgs []image.Image
	var ok []db.PrintJob
	for _, j := range jobs {
		// Claim the job first: if someone cancelled it since it was listed,
		// it is no longer queued and is skipped.
		n, err := q.store.ClaimPrintJob(ctx, j.ID)
		if err != nil {
			slog.Error("claim print job", "id", j.ID, "err", err)
			continue
		}
		if n == 0 {
			continue
		}
		img, err := q.render(j, tape)
		if err != nil {
			q.setJob(ctx, j.ID, "failed", err.Error())
			continue
		}
		imgs = append(imgs, img)
		ok = append(ok, j)
	}
	if len(ok) == 0 {
		return true
	}

	// Print checks the tape again, in case it was changed in between.
	res, err := q.printer.Print(pctx, imgs, tape.MM)

	q.recordStatus(res.Status, err)
	status, msg := "done", ""
	if err != nil {
		status, msg = "failed", err.Error()
		slog.Warn("print failed", "labels", len(ok), "err", err)
	} else {
		slog.Info("printed labels", "count", len(ok), "confirmed", res.Confirmed)
	}
	for _, j := range ok {
		q.setJob(ctx, j.ID, status, msg)
	}
	return err == nil
}

func (q *Queue) setJob(ctx context.Context, id int64, status, msg string) {
	inc := int64(0)
	if status == "done" || status == "failed" {
		inc = 1
	}
	if err := q.store.SetPrintJobStatus(ctx, db.SetPrintJobStatusParams{Status: status, Error: msg, AttemptInc: inc, ID: id}); err != nil {
		slog.Error("update print job", "id", id, "err", err)
	}
}

// CheckStatus asks the printer for its state, unless it is printing.
func (q *Queue) CheckStatus(ctx context.Context) PrinterState {
	if q.printer == nil {
		return q.State()
	}
	if !q.mu.TryLock() {
		return q.State()
	}
	st, err := q.printer.Status(ctx)
	q.mu.Unlock()
	q.recordStatus(st, err)
	return q.State()
}

func (q *Queue) recordStatus(st ptouch.Status, err error) {
	q.smu.Lock()
	defer q.smu.Unlock()
	q.state.CheckedAt = time.Now()
	q.state.Error = ""
	q.state.Problems = st.Problems()
	if q.state.Problems == nil {
		q.state.Problems = []string{}
	}
	if st.Model != 0 {
		q.state.Model = st.ModelName()
		q.state.TapeMM = st.MediaWidth
	}
	if err != nil {
		q.state.Error = err.Error()
	}
}

func (q *Queue) setBusy(b bool) {
	q.smu.Lock()
	q.state.Busy = b
	q.smu.Unlock()
}

func (q *Queue) State() PrinterState {
	q.smu.Lock()
	defer q.smu.Unlock()
	return q.state
}
