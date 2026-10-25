package parts

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeMouser answers like the Search API's partnumber endpoint.
func fakeMouser(t *testing.T, answer string) *Mouser {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/search/partnumber" || r.URL.Query().Get("apiKey") != "KEY" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
		}
		var body struct {
			SearchByPartRequest struct {
				MouserPartNumber  string `json:"mouserPartNumber"`
				PartSearchOptions string `json:"partSearchOptions"`
			}
		}
		b, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(b, &body); err != nil || body.SearchByPartRequest.MouserPartNumber == "" {
			t.Errorf("bad request body %s", b)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, answer)
	}))
	t.Cleanup(ts.Close)
	return &Mouser{APIKey: "KEY", BaseURL: ts.URL}
}

func TestMouserLookup(t *testing.T) {
	m := fakeMouser(t, `{"Errors":[],"SearchResults":{"NumberOfResult":2,"Parts":[
		{"ManufacturerPartNumber":"GRM188R71H104KA93J","Manufacturer":"Murata Electronics","Description":"Other"},
		{"ManufacturerPartNumber":"GRM188R71H104KA93D","Manufacturer":"Murata Electronics",
		 "Description":"Multilayer Ceramic Capacitors MLCC - SMD/SMT 0603 50V 0.1uF X7R 10% ",
		 "Category":"Multilayer Ceramic Capacitors MLCC - SMD/SMT",
		 "DataSheetUrl":"https://www.mouser.com/datasheet/2/281/GRM188R71H104KA93D.pdf",
		 "ProductDetailUrl":"https://www.mouser.pt/ProductDetail/Murata-Electronics/GRM188R71H104KA93D",
		 "ImagePath":"https://www.mouser.com/images/murata/images/GRM18_t.jpg",
		 "MouserPartNumber":"81-GRM188R71H104KA93D",
		 "ProductAttributes":[{"AttributeName":"Packaging","AttributeValue":"Reel"},
		                      {"AttributeName":"Case Code - in","AttributeValue":"0603"}]}]}}`)
	p, err := m.Lookup(context.Background(), "grm188r71h104ka93d")
	if err != nil {
		t.Fatal(err)
	}
	want := Part{
		MPN:          "GRM188R71H104KA93D",
		Manufacturer: "Murata Electronics",
		Description:  "Multilayer Ceramic Capacitors MLCC - SMD/SMT 0603 50V 0.1uF X7R 10%",
		Category:     "Multilayer Ceramic Capacitors MLCC - SMD/SMT",
		Package:      "0603",
		DatasheetURL: "https://www.mouser.com/datasheet/2/281/GRM188R71H104KA93D.pdf",
		ProductURL:   "https://www.mouser.pt/ProductDetail/Murata-Electronics/GRM188R71H104KA93D",
		ImageURL:     "https://www.mouser.com/images/murata/images/GRM18_t.jpg",
		SupplierPart: "81-GRM188R71H104KA93D",
	}
	if p != want {
		t.Fatalf("got %+v\nwant %+v", p, want)
	}
}

func TestMouserNotFoundAndErrors(t *testing.T) {
	_, err := fakeMouser(t, `{"Errors":[],"SearchResults":{"NumberOfResult":0,"Parts":[]}}`).Lookup(context.Background(), "NOPE")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	_, err = fakeMouser(t, `{"Errors":[{"Id":0,"Code":"Invalid","Message":"Invalid unique identifier."}],"SearchResults":null}`).
		Lookup(context.Background(), "X")
	if err == nil || !strings.Contains(err.Error(), "Invalid unique identifier") {
		t.Fatalf("err = %v", err)
	}
}
