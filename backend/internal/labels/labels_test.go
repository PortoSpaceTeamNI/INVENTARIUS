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
		aimW     int // decode only the first aimW dots, like a camera aimed at the code
	}{
		{Tape12, Spec{Code: "A107", Symbology: DataMatrix}, "A107", 9, 0},
		{Tape12, Spec{Code: "L3", Symbology: DataMatrix}, "L3", 9, 0},
		{Tape12, Spec{Code: "S123456", Symbology: DataMatrix}, "S123456", 12, 0},
		{Tape12, Spec{Code: "A107", Symbology: QR, URL: qrURL}, "HTTPS://INV.PORTOSPACETEAM.PT/A107", 12, 0},
		{Tape12, Spec{Code: "A107", Symbology: Code128}, "A107", 27, 0},
		{Tape12, Spec{Code: "L42", Symbology: DataMatrix, Caption: caption}, "L42", 40, 40},
		{Tape24, Spec{Code: "A107", Symbology: DataMatrix}, "A107", 15, 0},
		{Tape24, Spec{Code: "S123456", Symbology: DataMatrix}, "S123456", 18, 0},
		{Tape24, Spec{Code: "A107", Symbology: QR, URL: qrURL}, "HTTPS://INV.PORTOSPACETEAM.PT/A107", 21, 0},
		{Tape24, Spec{Code: "A107", Symbology: Code128}, "A107", 27, 0},
		{Tape24, Spec{Code: "L42", Symbology: DataMatrix, Caption: caption}, "L42", 75, 80},
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
			aimed := image.Image(img)
			if tc.aimW > 0 {
				aimed = img.SubImage(image.Rect(0, 0, tc.aimW, tc.tape.BandDots))
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

func TestWrap(t *testing.T) {
	got := wrap("Shelf C bin 4 with assorted M3 screws and nuts", 18, 2)
	if len(got) != 2 || got[0] != "Shelf C bin 4 with" || got[1] != "assorted M3 scr..." {
		t.Fatalf("wrap = %q", got)
	}
	if got := wrap("short", 18, 2); len(got) != 1 || got[0] != "short" {
		t.Fatalf("wrap = %q", got)
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
