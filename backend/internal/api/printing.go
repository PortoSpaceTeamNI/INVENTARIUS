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
)

// customCode starts the code of a free-text print job, one that isn't tied
// to anything in the inventory; the rest of the code is its QR content
// ("" for none) and the caption its text. Real codes never start with it.
const customCode = "~"

// Limits for free-text labels (the error messages spell them out): the
// content of a QR still has to fit the tape, which RenderText checks.
const (
	maxCustomText = 200
	maxCustomQR   = 300
)

// RenderJob turns a stored print job into a label image for the loaded
// tape; the print queue calls it right before printing.
func (s *Server) RenderJob(j db.PrintJob, t labels.Tape) (image.Image, error) {
	var img *image.Gray
	var err error
	if qr, ok := strings.CutPrefix(j.Code, customCode); ok {
		img, err = labels.RenderText(labels.Text{Lines: labels.TextLines(j.Caption), QR: qr}, t)
	} else {
		sym, perr := labels.ParseSymbology(j.Symbology)
		if perr != nil {
			return nil, perr
		}
		img, err = labels.Render(labels.Spec{Code: j.Code, Caption: j.Caption, Symbology: sym, URL: s.labelURL(j.Code)}, t)
	}
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

// customText checks the text and QR content of a free-text label and
// returns the label to render.
func customText(text, qr string) (labels.Text, error) {
	qr = strings.TrimSpace(qr)
	if len(text) > maxCustomText {
		return labels.Text{}, badRequest("label text is limited to 200 characters")
	}
	if len(qr) > maxCustomQR {
		return labels.Text{}, badRequest("QR content is limited to 300 characters")
	}
	l := labels.Text{Lines: labels.TextLines(text), QR: qr}
	if len(l.Lines) == 0 && l.QR == "" {
		return labels.Text{}, badRequest("write some text or QR content for the label")
	}
	if len(l.Lines) > labels.MaxTextLines {
		return labels.Text{}, badRequest("a label has at most 4 lines of text")
	}
	return l, nil
}

// customPreview renders GET /api/labels/custom?text=...&qr=... like
// labelPreview, for a free-text label.
func (s *Server) customPreview(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	l, err := customText(r.URL.Query().Get("text"), r.URL.Query().Get("qr"))
	if err != nil {
		return err
	}
	tape, err := labels.TapeFor(s.queue.State().TapeMM)
	if err != nil {
		tape = labels.Tape12
	}
	img, err := labels.RenderText(l, tape)
	if err != nil {
		return badRequest(err.Error())
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, no-cache")
	return png.Encode(w, labels.Preview(img, tape))
}

// print queues labels. Each is either a code, or a free-text label with
// text and/or QR content and no code.
func (s *Server) print(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var b struct {
		Labels []struct {
			Code      string `json:"code"`
			Symbology string `json:"symbology"`
			Caption   string `json:"caption"`
			Text      string `json:"text"`
			QR        string `json:"qr"`
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
		if l.Code == "" {
			t, err := customText(l.Text, l.QR)
			if err != nil {
				return err
			}
			// Rendered now so a QR too big for the tape is refused here, not
			// when the job fails at the printer.
			tape, terr := labels.TapeFor(s.queue.State().TapeMM)
			if terr != nil {
				tape = labels.Tape12
			}
			if _, err := labels.RenderText(t, tape); err != nil {
				return badRequest(err.Error())
			}
			jobs = append(jobs, db.CreatePrintJobParams{
				// The symbology column only takes real symbologies.
				Code: customCode + t.QR, Symbology: string(labels.QR), Caption: strings.Join(t.Lines, "\n"),
			})
			continue
		}
		k, id, err := codes.Parse(l.Code)
		if err != nil {
			return badRequest(err.Error())
		}
		if k == codes.Stock {
			return badRequest("stock has no label of its own; print the item's label instead")
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
		jobs = append(jobs, db.CreatePrintJobParams{
			Code: codes.Format(k, id), Symbology: l.Symbology, Caption: strings.TrimSpace(l.Caption),
		})
	}
	out, err := s.queue.Enqueue(r.Context(), u.ID, jobs)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

func (s *Server) listPrintJobs(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	jobs, err := s.store.ListPrintJobs(r.Context(), limit(r, 100, 500))
	if err != nil {
		return err
	}
	return writeJSON(w, nonNil(jobs))
}

func (s *Server) printJobOp(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	if _, err := s.store.GetPrintJob(r.Context(), id); err != nil {
		return err
	}
	// The status only changes if the job is still in an allowed state, so a
	// cancel that loses the race with the printer is refused, not ignored.
	var p db.ChangePrintJobStatusParams
	var refused string
	switch r.PathValue("op") {
	case "retry":
		p = db.ChangePrintJobStatusParams{Status: "queued", FromStatus: []string{"failed", "cancelled", "done"}}
		refused = "only finished jobs can be retried"
	case "cancel":
		p = db.ChangePrintJobStatusParams{Status: "cancelled", FromStatus: []string{"queued", "failed"}}
		refused = "only waiting jobs can be cancelled; it may be printing already"
	default:
		return errNotFound
	}
	p.ID = id
	n, err := s.store.ChangePrintJobStatus(r.Context(), p)
	if err != nil {
		return err
	}
	if n == 0 {
		return badRequest(refused)
	}
	status := p.Status
	if status == "queued" {
		s.queue.Wake()
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) printerStatus(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	return writeJSON(w, s.queue.CheckStatus(r.Context()))
}
