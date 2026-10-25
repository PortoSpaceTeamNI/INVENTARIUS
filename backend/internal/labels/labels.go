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
	"unicode"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/code128"
	"github.com/boombuler/barcode/datamatrix"
	"github.com/boombuler/barcode/qr"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

type Symbology string

const (
	// DataMatrix encodes only the code; scanned in the app.
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

	// Per Scale: blank dots kept at both edges of the band (the symbol's
	// quiet zone, with the unprinted tape edge), and between text blocks.
	pad = 4
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

// A line of text, drawn k times the font's size.
type line struct {
	s string
	k int
}

func lineH(k int) int { return face.Height * k }

// Render draws the label for tape t. The result is t.BandDots high.
//
// The symbol fills the height of the tape. Next to it goes the code in big
// text (3x the font on 12 mm), or the code and the caption (2x each). The
// caption goes on one line, however long: the label just gets longer.
// Barcodes are wide, so their code goes under the bars instead.
func Render(s Spec, t Tape) (*image.Gray, error) {
	k, band := t.Scale, t.BandDots
	inner := band - 2*pad*k
	gap := gap * k
	oneD := s.Symbology == Code128
	codeK := 2 * k // code text under barcodes, and next to a caption

	var lines []line
	if !oneD {
		if s.Caption == "" {
			lines = append(lines, line{s.Code, 3 * k})
		} else {
			lines = append(lines, line{s.Code, codeK})
		}
	}
	if s.Caption != "" {
		room := inner
		if len(lines) > 0 {
			room -= lineH(lines[0].k) + gap
		}
		if room >= lineH(2*k) {
			lines = append(lines, line{plain(strings.Join(strings.Fields(s.Caption), " ")), 2 * k})
		}
	}

	symH := inner
	if oneD {
		symH -= gap + lineH(codeK)
	}
	sym, err := symbol(s, t, symH)
	if err != nil {
		return nil, err
	}

	// Left column: the symbol (and a barcode's code text).
	colW, colH := sym.Bounds().Dx(), sym.Bounds().Dy()
	if oneD {
		colW = max(colW, textWidth(s.Code, codeK))
		colH += gap + lineH(codeK)
	}
	// Right column: the text lines.
	w, textX, textH := colW, 0, 0
	if len(lines) > 0 {
		// Wide enough to act as the symbol's quiet zone.
		textX = colW + 12*k
		tw := 0
		for i, l := range lines {
			tw = max(tw, textWidth(l.s, l.k))
			textH += lineH(l.k) + sep(i, oneD, gap)
		}
		w = textX + tw
	}

	img := image.NewGray(image.Rect(0, 0, w, band))
	draw.Draw(img, img.Bounds(), image.White, image.Point{}, draw.Src)

	top := (band - colH) / 2
	symX := (colW - sym.Bounds().Dx()) / 2
	draw.Draw(img, sym.Bounds().Add(image.Pt(symX, top)), sym, image.Point{}, draw.Src)
	if oneD {
		drawText(img, (colW-textWidth(s.Code, codeK))/2, top+sym.Bounds().Dy()+gap, s.Code, codeK)
	}
	y := (band - textH) / 2
	for i, l := range lines {
		y += sep(i, oneD, gap)
		drawText(img, textX, y, l.s, l.k)
		y += lineH(l.k)
	}
	return img, nil
}

// sep is the space above text line i: a gap between the code and the caption.
func sep(i int, oneD bool, gap int) int {
	if i == 1 && !oneD {
		return gap
	}
	return 0
}

// symbol encodes the code and scales it to at most h dots high; quiet zones
// come from the band padding, the tape edge and the feed margins.
func symbol(s Spec, t Tape, h int) (image.Image, error) {
	var (
		bc       barcode.Barcode
		err      error
		maxScale int
	)
	switch s.Symbology {
	case DataMatrix:
		bc, err = datamatrix.Encode(s.Code)
		maxScale = 6 * t.Scale
	case QR:
		payload := s.URL
		if payload == "" {
			payload = s.Code
		}
		// Upper case keeps the QR in alphanumeric mode: a smaller symbol.
		bc, err = qr.Encode(strings.ToUpper(payload), qr.L, qr.Auto)
		maxScale = 4 * t.Scale
	case Code128:
		bc, err = code128.Encode(s.Code)
	default:
		return nil, fmt.Errorf("unknown symbology %q", s.Symbology)
	}
	if err != nil {
		return nil, fmt.Errorf("encode %s: %w", s.Symbology, err)
	}
	b := bc.Bounds()
	is1D := s.Symbology == Code128
	// Bars keep the same width on any tape: wider bars would only make the
	// label longer.
	scale := 2
	if !is1D {
		scale = min(maxScale, h/b.Dy())
		if scale < 1 {
			return nil, fmt.Errorf("%s symbol for %q is too big for the tape", s.Symbology, s.Code)
		}
		h = b.Dy() * scale
	}
	out := image.NewGray(image.Rect(0, 0, b.Dx()*scale, h))
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

// The label font is ASCII only: accents are dropped ("Eletrónica" →
// "Eletronica") and a few symbols spelled out; anything else becomes "?".
var (
	stripMarks = transform.Chain(norm.NFKD, runes.Remove(runes.In(unicode.Mn)))
	symbols    = map[rune]string{
		'Ω': "Ohm", 'µ': "u", 'μ': "u", 'ß': "ss", 'Ø': "O", 'ø': "o",
		'Æ': "AE", 'æ': "ae", 'Œ': "OE", 'œ': "oe", 'Ł': "L", 'ł': "l",
		'°': "o", '±': "+/-", '×': "x", '÷': "/", '⁄': "/", '€': "EUR",
		'–': "-", '—': "-", '‘': "'", '’': "'", '“': "\"", '”': "\"", '«': "\"", '»': "\"",
		'…': "...", '•': "-", '·': "-",
	}
)

func plain(s string) string {
	if folded, _, err := transform.String(stripMarks, s); err == nil {
		s = folded
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r < 0x80:
			b.WriteRune(r)
		case symbols[r] != "":
			b.WriteString(symbols[r])
		default:
			b.WriteByte('?')
		}
	}
	return b.String()
}
