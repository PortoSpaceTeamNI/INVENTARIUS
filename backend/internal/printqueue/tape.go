package printqueue

import (
	"context"
	"database/sql"
	"errors"
	"image"
	"time"

	"inventarius/internal/db"
	"inventarius/internal/labels"
)

const (
	// DefaultRollMM is the length of a standard TZe cassette (8 m).
	DefaultRollMM = 8000

	// leadInDots is the tape fed before the first label of every job,
	// because the cutter sits away from the print head (≈24.5 mm).
	leadInDots = 174

	dotsPerMM = 180 / 25.4

	// Labels printed in one batch are marked done within a moment of each
	// other; jobs further apart than this were separate print jobs.
	batchGap = 3 * time.Second
)

// TapeRoll is the estimate for the cassette in the printer.
type TapeRoll struct {
	WidthMM  int       `json:"width_mm"`
	LengthMM int       `json:"length_mm"`
	UsedMM   int       `json:"used_mm"`
	LoadedAt time.Time `json:"loaded_at"`
}

func toRoll(r db.TapeRoll) *TapeRoll {
	return &TapeRoll{
		WidthMM: int(r.WidthMm), LengthMM: int(r.LengthMm),
		UsedMM: int(float64(r.UsedDots)/dotsPerMM + 0.5), LoadedAt: r.LoadedAt,
	}
}

// jobDots is the tape one print job uses: the lead-in, then every label
// with the feed margin on both sides.
func jobDots(imgs []image.Image) int64 {
	n := int64(leadInDots)
	for _, img := range imgs {
		n += int64(img.Bounds().Dx() + 2*labels.MarginDots)
	}
	return n
}

// rollFor returns the cassette of this width, creating it the first time
// the width is seen. The first cassette ever was new when printing started,
// so it also counts every label printed before tape was tracked.
func (q *Queue) rollFor(ctx context.Context, tape labels.Tape) (db.TapeRoll, error) {
	r, err := q.store.GetCurrentTapeRoll(ctx, int64(tape.MM))
	if !errors.Is(err, sql.ErrNoRows) {
		return r, err
	}
	n, err := q.store.CountTapeRolls(ctx)
	if err != nil {
		return r, err
	}
	var used int64
	if n == 0 {
		if used, err = q.printedDots(ctx, tape); err != nil {
			return r, err
		}
	}
	return q.store.CreateTapeRoll(ctx, db.CreateTapeRollParams{WidthMm: int64(tape.MM), LengthMm: DefaultRollMM, UsedDots: used})
}

// printedDots estimates the tape used by every label printed so far, laid
// out again on this tape. A label reprinted later only counts once, since
// a job keeps only its last print time.
func (q *Queue) printedDots(ctx context.Context, tape labels.Tape) (int64, error) {
	jobs, err := q.store.ListDonePrintJobs(ctx)
	if err != nil {
		return 0, err
	}
	var total int64
	var batch []image.Image
	var last time.Time
	for _, j := range jobs {
		if j.PrintedAt == nil {
			continue
		}
		if len(batch) > 0 && j.PrintedAt.Sub(last) > batchGap {
			total += jobDots(batch)
			batch = nil
		}
		last = *j.PrintedAt
		img, err := q.render(j, tape)
		if err != nil {
			continue
		}
		batch = append(batch, img)
	}
	if len(batch) > 0 {
		total += jobDots(batch)
	}
	return total, nil
}

// Roll returns the estimate for the cassette of this width, or nil if
// none is known (no printer, or other tape loaded).
func (q *Queue) Roll(ctx context.Context, widthMM int) (*TapeRoll, error) {
	if q.printer == nil {
		return nil, nil
	}
	tape, err := labels.TapeFor(widthMM)
	if err != nil {
		return nil, nil
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	r, err := q.rollFor(ctx, tape)
	if err != nil {
		return nil, err
	}
	return toRoll(r), nil
}

// NewRoll records that a new cassette of lengthMM was loaded, replacing the
// one of the same width.
func (q *Queue) NewRoll(ctx context.Context, widthMM, lengthMM int) (*TapeRoll, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	var r db.TapeRoll
	err := q.store.Tx(ctx, func(tx *db.Queries) error {
		if err := tx.ReplaceTapeRolls(ctx, int64(widthMM)); err != nil {
			return err
		}
		var err error
		r, err = tx.CreateTapeRoll(ctx, db.CreateTapeRollParams{WidthMm: int64(widthMM), LengthMm: int64(lengthMM)})
		return err
	})
	if err != nil {
		return nil, err
	}
	return toRoll(r), nil
}
