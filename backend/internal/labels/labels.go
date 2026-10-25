// Package labels renders label images for 12 or 24 mm TZe tape at 180 dpi.
//
// An image is laid out with x along the tape (label length) and y across it.
// Its height is the printable band of the tape (70 dots on 12 mm, 128 on
// 24 mm); the printer adds a feed margin (2 mm minimum) before and after
// each label.
package labels

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"strings"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/code128"
	"github.com/boombuler/barcode/datamatrix"
	"github.com/boombuler/barcode/qr"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

type Symbology string

const (
	// DataMatrix encodes only the code; smallest label, scanned in the app.
	DataMatrix Symbology = "datamatrix"
	// QR encodes the full URL, so any phone camera opens the page.
	QR Symbology = "qr"
	// Code128 is a 1D barcode; long labels, for shelves and big bins.
	Code128 Symbology = "code128"
)

func ParseSymbology(s string) (Symbology, error) {
	switch Symbology(s) {
	case DataMatrix, QR, Code128:
		return Symbology(s), nil
	}
	return "", fmt.Errorf("unknown symbology %q", s)
}

// Tape is the label layout for one tape width. On wider tape, symbols and
// text are drawn Scale times bigger, so labels read from further away.
type Tape struct {
	MM       int
	BandDots int // printable height across the tape
	TapeDots int // full tape width, for previews
	Scale    int // size of symbols and text relative to 12 mm
}

var (
	Tape12 = Tape{MM: 12, BandDots: 70, TapeDots: 85, Scale: 1}
	Tape24 = Tape{MM: 24, BandDots: 128, TapeDots: 170, Scale: 2}
)

// TapeFor returns the layout for a tape width in mm.
func TapeFor(mm int) (Tape, error) {
	switch mm {
	case 12:
		return Tape12, nil
	case 24:
		return Tape24, nil
	}
	return Tape{}, fmt.Errorf("printer has %d mm tape loaded; labels need 12 or 24 mm", mm)
}

const (
	// MarginDots is the feed margin added by the printer on each side.
	MarginDots = 14

	gap = 3
)

var face = basicfont.Face7x13

// Spec is what goes on one label.
type Spec struct {
	Code      string    // e.g. "A107"
	Caption   string    // optional extra text, e.g. the item name
	Symbology Symbology //
	URL       string    // payload for QR codes; defaults to the code
}

// Render draws the label for tape t. The result is t.BandDots high.
func Render(s Spec, t Tape) (*image.Gray, error) {
	sym, err := symbol(s, t)
	if err != nil {
		return nil, err
	}
	k, band := t.Scale, t.BandDots
	codeW := textWidth(s.Code, k)
	lineH := face.Height * k
	gap := gap * k

	// Code text goes under the symbol if it fits, otherwise to its right.
	below := sym.Bounds().Dy()+gap+lineH <= band
	var captionLines []string
	if s.Caption != "" {
		captionLines = wrap(s.Caption, 18, band/lineH-boolInt(!below))
	}

	colW := sym.Bounds().Dx()
	if below {
		colW = max(colW, codeW)
	}
	w := colW
	var textX int
	var textLines []string
	if !below {
		textLines = append(textLines, s.Code)
	}
	textLines = append(textLines, captionLines...)
	if len(textLines) > 0 {
		// Wide enough to act as the symbol's quiet zone.
		textX = colW + 12*k
		tw := 0
		for _, l := range textLines {
			tw = max(tw, textWidth(l, k))
		}
		w = textX + tw
	}

	img := image.NewGray(image.Rect(0, 0, w, band))
	draw.Draw(img, img.Bounds(), image.White, image.Point{}, draw.Src)

	symH := sym.Bounds().Dy()
	blockH := symH
	if below {
		blockH += gap + lineH
	}
	top := (band - blockH) / 2
	symX := (colW - sym.Bounds().Dx()) / 2
	draw.Draw(img, sym.Bounds().Add(image.Pt(symX, top)), sym, image.Point{}, draw.Src)
	if below {
		drawText(img, (colW-codeW)/2, top+symH+gap, s.Code, k)
	}
	if len(textLines) > 0 {
		ty := (band - len(textLines)*lineH) / 2
		for i, l := range textLines {
			drawText(img, textX, ty+i*lineH, l, k)
		}
	}
	return img, nil
}

// symbol encodes and scales the code; quiet zones come from the tape edge
// and the feed margins.
func symbol(s Spec, t Tape) (image.Image, error) {
	var (
		bc    barcode.Barcode
		err   error
		scale int
		h     int // 1D bar height
	)
	band := t.BandDots
	switch s.Symbology {
	case DataMatrix:
		bc, err = datamatrix.Encode(s.Code)
		scale = 3 * t.Scale
	case QR:
		payload := s.URL
		if payload == "" {
			payload = s.Code
		}
		// Upper case keeps the QR in alphanumeric mode: a smaller symbol.
		bc, err = qr.Encode(strings.ToUpper(payload), qr.L, qr.Auto)
		scale = 2 * t.Scale
	case Code128:
		bc, err = code128.Encode(s.Code)
		// Taller bars on wider tape, but the same bar width: wider bars
		// would only make the label longer.
		scale, h = 2, band-(gap+face.Height)*t.Scale
	default:
		return nil, fmt.Errorf("unknown symbology %q", s.Symbology)
	}
	if err != nil {
		return nil, fmt.Errorf("encode %s: %w", s.Symbology, err)
	}
	b := bc.Bounds()
	if h == 0 {
		// Keep room for the code text under the symbol if possible; text
		// beside it makes the label much longer.
		if fit := (band - (gap+face.Height)*t.Scale) / b.Dy(); fit >= 1 {
			scale = min(scale, fit)
		}
		h = b.Dy() * scale
	}
	if h > band {
		// Fall back to the largest scale that still fits.
		scale = band / b.Dy()
		if scale < 1 {
			return nil, fmt.Errorf("%s symbol for %q is too big for the tape", s.Symbology, s.Code)
		}
		h = b.Dy() * scale
	}
	out := image.NewGray(image.Rect(0, 0, b.Dx()*scale, h))
	is1D := s.Symbology == Code128
	for y := 0; y < h; y++ {
		sy := b.Min.Y + y/scale
		if is1D {
			sy = b.Min.Y
		}
		for x := 0; x < out.Bounds().Dx(); x++ {
			c := color.GrayModel.Convert(bc.At(b.Min.X+x/scale, sy)).(color.Gray)
			out.Pix[y*out.Stride+x] = c.Y
		}
	}
	return out, nil
}

// Preview draws the label as it will come out: on a piece of tape t with
// the feed margins and the unprinted tape edges.
func Preview(label image.Image, t Tape) *image.Gray {
	w := label.Bounds().Dx() + 2*MarginDots
	img := image.NewGray(image.Rect(0, 0, w, t.TapeDots))
	draw.Draw(img, img.Bounds(), image.White, image.Point{}, draw.Src)
	draw.Draw(img, label.Bounds().Add(image.Pt(MarginDots, (t.TapeDots-t.BandDots)/2)), label, label.Bounds().Min, draw.Src)
	return img
}

// LengthMM is the length of tape a label uses, including feed margins.
func LengthMM(label image.Image) float64 {
	return float64(label.Bounds().Dx()+2*MarginDots) * 25.4 / 180
}

func textWidth(s string, k int) int {
	return font.MeasureString(face, s).Ceil() * k
}

// drawText draws s with its top left at (x, y), k times the font's size.
// The font is a bitmap, so it is scaled by repeating pixels.
func drawText(img *image.Gray, x, y int, s string, k int) {
	dst := img
	if k > 1 {
		dst = image.NewGray(image.Rect(0, 0, textWidth(s, 1), face.Height))
		draw.Draw(dst, dst.Bounds(), image.White, image.Point{}, draw.Src)
	}
	d := font.Drawer{
		Dst:  dst,
		Src:  image.Black,
		Face: face,
		Dot:  fixed.P(0, face.Ascent),
	}
	if k == 1 {
		d.Dot = fixed.P(x, y+face.Ascent)
	}
	d.DrawString(s)
	if k == 1 {
		return
	}
	b := dst.Bounds()
	for sy := 0; sy < b.Dy(); sy++ {
		for sx := 0; sx < b.Dx(); sx++ {
			c := dst.Pix[sy*dst.Stride+sx]
			for dy := 0; dy < k; dy++ {
				for dx := 0; dx < k; dx++ {
					px, py := x+sx*k+dx, y+sy*k+dy
					if image.Pt(px, py).In(img.Bounds()) {
						img.Pix[py*img.Stride+px] = c
					}
				}
			}
		}
	}
}

// wrap breaks s into at most maxLines lines of up to width characters,
// ellipsizing the last line if needed.
func wrap(s string, width, maxLines int) []string {
	if maxLines <= 0 {
		return nil
	}
	var lines []string
	var cur string
	for _, w := range strings.Fields(s) {
		for len(w) > width {
			if cur != "" {
				lines, cur = append(lines, cur), ""
			}
			lines, w = append(lines, w[:width]), w[width:]
		}
		switch {
		case cur == "":
			cur = w
		case len(cur)+1+len(w) <= width:
			cur += " " + w
		default:
			lines, cur = append(lines, cur), w
		}
	}
	if cur != "" {
		lines = append(lines, cur)
	}
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		last := lines[maxLines-1]
		if len(last) > width-3 {
			last = last[:width-3]
		}
		lines[maxLines-1] = last + "..." // the bitmap font is ASCII only
	}
	return lines
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
