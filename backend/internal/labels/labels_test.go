package labels

import (
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/datamatrix"
	"github.com/makiuchi-d/gozxing/oned"
	"github.com/makiuchi-d/gozxing/qrcode"
)

// decode scans the rendered label like a camera would: upscaled, with the
// white tape and margins around it.
func decode(t *testing.T, label image.Image, tp Tape, sym Symbology) string {
	t.Helper()
	tape := Preview(label, tp)
	const k = 4
	big := image.NewGray(image.Rect(0, 0, tape.Bounds().Dx()*k, tape.Bounds().Dy()*k))
	for y := 0; y < big.Bounds().Dy(); y++ {
		for x := 0; x < big.Bounds().Dx(); x++ {
			big.Pix[y*big.Stride+x] = tape.Pix[(y/k)*tape.Stride+x/k]
		}
	}
	bmp, err := gozxing.NewBinaryBitmapFromImage(big)
	if err != nil {
		t.Fatal(err)
	}
	hints := map[gozxing.DecodeHintType]interface{}{gozxing.DecodeHintType_TRY_HARDER: true}
	var r gozxing.Reader
	switch sym {
	case DataMatrix:
		r = datamatrix.NewDataMatrixReader()
	case QR:
		r = qrcode.NewQRCodeReader()
	case Code128:
		r = oned.NewCode128Reader()
	}
	res, err := r.Decode(bmp, hints)
	if err != nil {
		t.Fatalf("%s label did not decode: %v", sym, err)
	}
	return res.GetText()
}

func TestRenderDecodes(t *testing.T) {
	qrURL := "https://inv.portospaceteam.pt/A107"
	caption := "Shelf C bin 4 - M3 screws"
	tests := []struct {
		tape     Tape
		spec     Spec
		want     string
		maxLenMM float64
	}{
		{Tape12, Spec{Code: "A107", Symbology: DataMatrix}, "A107", 27},
		{Tape12, Spec{Code: "L3", Symbology: DataMatrix}, "L3", 21},
		{Tape12, Spec{Code: "S123456", Symbology: DataMatrix}, "S123456", 36},
		{Tape12, Spec{Code: "A107", Symbology: QR, URL: qrURL}, "HTTPS://INV.PORTOSPACETEAM.PT/A107", 26},
		{Tape12, Spec{Code: "A107", Symbology: Code128}, "A107", 27},
		{Tape12, Spec{Code: "L42", Symbology: DataMatrix, Caption: caption}, "L42", 65},
		{Tape24, Spec{Code: "A107", Symbology: DataMatrix}, "A107", 48},
		{Tape24, Spec{Code: "S123456", Symbology: DataMatrix}, "S123456", 65},
		{Tape24, Spec{Code: "A107", Symbology: QR, URL: qrURL}, "HTTPS://INV.PORTOSPACETEAM.PT/A107", 46},
		{Tape24, Spec{Code: "A107", Symbology: Code128}, "A107", 27},
		{Tape24, Spec{Code: "L42", Symbology: DataMatrix, Caption: caption}, "L42", 123},
	}
	dir := os.Getenv("LABELS_OUT") // set to a directory to look at the PNGs
	for _, tc := range tests {
		name := fmt.Sprintf("%dmm_%s_%s", tc.tape.MM, tc.spec.Symbology, tc.spec.Code)
		t.Run(name, func(t *testing.T) {
			img, err := Render(tc.spec, tc.tape)
			if err != nil {
				t.Fatal(err)
			}
			if img.Bounds().Dy() != tc.tape.BandDots {
				t.Fatalf("height %d", img.Bounds().Dy())
			}
			if dir != "" {
				writePNG(t, filepath.Join(dir, name+".png"), Preview(img, tc.tape))
			}
			// The code text sits next to 2D symbols. Decode only the symbol, like a
			// camera aimed at it: gozxing's Data Matrix detector starts from the
			// middle of the image (the app's zxing-cpp reads the whole label).
			aimed := image.Image(img)
			if tc.spec.Symbology != Code128 {
				aimed = img.SubImage(image.Rect(0, 0, tc.tape.BandDots, tc.tape.BandDots))
			}
			if got := decode(t, aimed, tc.tape, tc.spec.Symbology); got != tc.want {
				t.Fatalf("decoded %q, want %q", got, tc.want)
			}
			if l := LengthMM(img); l > tc.maxLenMM {
				t.Errorf("label is %.1f mm long, want <= %.1f", l, tc.maxLenMM)
			}
			t.Logf("%s %s: %.1f mm long", tc.spec.Symbology, tc.spec.Code, LengthMM(img))
		})
	}
}

func TestPlain(t *testing.T) {
	for in, want := range map[string]string{
		"Armário das ferramentas elétricas": "Armario das ferramentas eletricas",
		"Gaveta 4 – Fixação, Ação, Coração": "Gaveta 4 - Fixacao, Acao, Coracao",
		"Resistência 10k Ω, 100 µF":         "Resistencia 10k Ohm, 100 uF",
		"Tubo Ø20 × 1 m, 1ª prateleira":     "Tubo O20 x 1 m, 1a prateleira",
		"220 \u2126 (ohm sign)":             "220 Ohm (ohm sign)",
		"Núcleo PST 🚀":                      "Nucleo PST ?",
	} {
		if got := plain(in); got != want {
			t.Errorf("plain(%q) = %q, want %q", in, got, want)
		}
	}
}

func writePNG(t *testing.T, path string, img image.Image) {
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	// 4x so it is visible on screen.
	b := img.Bounds()
	big := image.NewGray(image.Rect(0, 0, b.Dx()*4, b.Dy()*4))
	draw.Draw(big, big.Bounds(), image.White, image.Point{}, draw.Src)
	for y := 0; y < big.Bounds().Dy(); y++ {
		for x := 0; x < big.Bounds().Dx(); x++ {
			big.Set(x, y, img.At(b.Min.X+x/4, b.Min.Y+y/4))
		}
	}
	if err := png.Encode(f, big); err != nil {
		t.Fatal(err)
	}
}
