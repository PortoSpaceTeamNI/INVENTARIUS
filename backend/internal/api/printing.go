package api

import (
	"context"
	"image"
	"image/png"
	"log/slog"
	"net/http"
	"strings"

	"inventarius/internal/auth"
	"inventarius/internal/codes"
	"inventarius/internal/db"
	"inventarius/internal/labels"
	"inventarius/internal/printqueue"
)

// RenderJob turns a stored print job into a label image for the loaded
// tape; the print queue calls it right before printing.
func (s *Server) RenderJob(j db.PrintJob, t labels.Tape) (image.Image, error) {
	sym, err := labels.ParseSymbology(j.Symbology)
	if err != nil {
		return nil, err
	}
	img, err := labels.Render(labels.Spec{Code: j.Code, Caption: j.Caption, Symbology: sym, URL: s.labelURL(j.Code)}, t)
	if err != nil {
		return nil, err
	}
	if s.cfg.PrintFlip {
		return rotate180(img), nil
	}
	return img, nil
}

func rotate180(img *image.Gray) *image.Gray {
	b := img.Bounds()
	out := image.NewGray(b)
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			out.Pix[(b.Dy()-1-y)*out.Stride+(b.Dx()-1-x)] = img.Pix[y*img.Stride+x]
		}
	}
	return out
}

// enqueueLabel queues the default label for something just created. A
// failure is logged, not returned: the thing exists, and the label can be
// printed again from its page.
func (s *Server) enqueueLabel(ctx context.Context, u *auth.User, k codes.Kind, id int64, caption string) {
	_, err := s.queue.Enqueue(ctx, u.ID, []db.CreatePrintJobParams{{
		Code: codes.Format(k, id), Symbology: s.cfg.Symbology, Caption: s.defaultCaption(k, caption),
	}})
	if err != nil {
		slog.Error("enqueue label", "code", codes.Format(k, id), "err", err)
	}
}

// defaultCaption: locations get their name on the label, items their short
// label text (if any); on assets the code alone keeps the label short.
func (s *Server) defaultCaption(k codes.Kind, name string) string {
	if k == codes.Location || k == codes.Item {
		return name
	}
	return ""
}

// labelPreview renders GET /api/labels/A107?symbology=qr&caption=... as a PNG
// of the label on the tape last seen in the printer (12 mm if unknown), at
// printer resolution (180 dpi).
func (s *Server) labelPreview(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	k, id, err := codes.Parse(r.PathValue("code"))
	if err != nil {
		return badRequest(err.Error())
	}
	symName := r.URL.Query().Get("symbology")
	if symName == "" {
		symName = s.cfg.Symbology
	}
	sym, err := labels.ParseSymbology(symName)
	if err != nil {
		return badRequest(err.Error())
	}
	tape, err := labels.TapeFor(s.queue.State().TapeMM)
	if err != nil {
		tape = labels.Tape12
	}
	code := codes.Format(k, id)
	img, err := labels.Render(labels.Spec{Code: code, Caption: r.URL.Query().Get("caption"), Symbology: sym, URL: s.labelURL(code)}, tape)
	if err != nil {
		return badRequest(err.Error())
	}
	w.Header().Set("Content-Type", "image/png")
	// Not cached: the preview changes when other tape is loaded.
	w.Header().Set("Cache-Control", "private, no-cache")
	return png.Encode(w, labels.Preview(img, tape))
}

func (s *Server) print(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b struct {
		Labels []struct {
			Code      string `json:"code"`
			Symbology string `json:"symbology"`
			// Caption left out: the usual one (a place's name, an item's
			// label text); "" prints the code alone.
			Caption *string `json:"caption"`
		} `json:"labels"`
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	if len(b.Labels) == 0 || len(b.Labels) > 200 {
		return badRequest("send between 1 and 200 labels")
	}
	var jobs []db.CreatePrintJobParams
	for _, l := range b.Labels {
		k, id, err := codes.Parse(l.Code)
		if err != nil {
			return badRequest(err.Error())
		}
		if _, err := s.codePath(r.Context(), k, id); err != nil {
			return badRequest("no " + k.Name() + " with code " + codes.Format(k, id))
		}
		if l.Symbology == "" {
			l.Symbology = s.cfg.Symbology
		}
		if _, err := labels.ParseSymbology(l.Symbology); err != nil {
			return badRequest(err.Error())
		}
		var caption string
		if l.Caption != nil {
			caption = strings.TrimSpace(*l.Caption)
		} else {
			caption = s.usualCaption(r.Context(), k, id)
		}
		jobs = append(jobs, db.CreatePrintJobParams{
			Code: codes.Format(k, id), Symbology: l.Symbology, Caption: caption,
		})
	}
	out, err := s.queue.Enqueue(r.Context(), u.ID, jobs)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

// usualCaption is the caption a label gets when printed without choosing
// one, as when it is printed on creation.
func (s *Server) usualCaption(ctx context.Context, k codes.Kind, id int64) string {
	switch k {
	case codes.Location:
		if l, err := s.store.GetLocation(ctx, id); err == nil {
			return s.defaultCaption(k, l.Name)
		}
	case codes.Item:
		if it, err := s.store.GetItem(ctx, id); err == nil {
			return s.defaultCaption(k, it.LabelText)
		}
	}
	return ""
}

func (s *Server) printHold(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if r.Method == http.MethodPut {
		var b struct {
			Hold bool `json:"hold"`
		}
		if err := decode(r, &b); err != nil {
			return err
		}
		if err := s.queue.SetHold(r.Context(), b.Hold); err != nil {
			return err
		}
	}
	held, err := s.queue.Held(r.Context())
	if err != nil {
		return err
	}
	waiting, err := s.store.CountQueuedPrintJobs(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{"hold": held, "waiting": waiting})
}

// flushPrints prints every waiting label now, as one strip.
func (s *Server) flushPrints(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	s.queue.Flush()
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) listPrintJobs(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	jobs, err := s.store.ListPrintJobs(r.Context(), limit(r, 100, 500))
	if err != nil {
		return err
	}
	return writeJSON(w, nonNil(jobs))
}

// printQueue answers GET /api/print/queue: every label still waiting,
// oldest first.
func (s *Server) printQueue(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	jobs, err := s.store.ListWaitingPrintJobs(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, nonNil(jobs))
}

// cancelPrints answers POST /api/print/cancel: cancels the waiting or failed
// jobs in ids, or all of them when ids is left out.
func (s *Server) cancelPrints(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b struct {
		IDs []int64 `json:"ids"`
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	var n int64
	var err error
	if b.IDs == nil {
		n, err = s.store.CancelAllPrintJobs(r.Context())
	} else if len(b.IDs) > 0 {
		n, err = s.store.CancelPrintJobs(r.Context(), b.IDs)
	}
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]int64{"cancelled": n})
}

func (s *Server) printJobOp(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	j, err := s.store.GetPrintJob(r.Context(), id)
	if err != nil {
		return err
	}
	var status string
	switch r.PathValue("op") {
	case "retry":
		if j.Status != "failed" && j.Status != "cancelled" && j.Status != "done" {
			return badRequest("only finished jobs can be retried")
		}
		status = "queued"
	case "cancel":
		if j.Status != "queued" && j.Status != "failed" {
			return badRequest("only waiting jobs can be cancelled")
		}
		status = "cancelled"
	default:
		return errNotFound
	}
	if err := s.store.SetPrintJobStatus(r.Context(), db.SetPrintJobStatusParams{Status: status, Error: "", ID: id}); err != nil {
		return err
	}
	if status == "queued" {
		s.queue.Wake()
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) printerStatus(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	st := s.queue.CheckStatus(r.Context())
	roll, err := s.queue.Roll(r.Context(), st.TapeMM)
	if err != nil {
		return err
	}
	st.TapeRoll = roll
	return writeJSON(w, st)
}

// newTapeRoll records that a new cassette was put in the printer, so the
// tape left is counted from its full length again.
func (s *Server) newTapeRoll(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b struct {
		LengthMM int `json:"length_mm"`
	}
	if err := decode(r, &b); err != nil {
		return err
	}
	if b.LengthMM == 0 {
		b.LengthMM = printqueue.DefaultRollMM
	}
	if b.LengthMM < 500 || b.LengthMM > 50000 {
		return badRequest("tape length must be between 0.5 and 50 m")
	}
	width := s.queue.CheckStatus(r.Context()).TapeMM
	if _, err := labels.TapeFor(width); err != nil {
		return badRequest("load 12 or 24 mm tape in the printer first")
	}
	roll, err := s.queue.NewRoll(r.Context(), width, b.LengthMM)
	if err != nil {
		return err
	}
	return writeJSON(w, roll)
}
