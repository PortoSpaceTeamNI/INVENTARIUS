// Package parts looks up component details (description, datasheet, image)
// by manufacturer part number in a distributor's catalogue.
package parts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Part is what the catalogue knows about a component.
type Part struct {
	MPN          string `json:"mpn"`
	Manufacturer string `json:"manufacturer"`
	Description  string `json:"description"`
	Category     string `json:"category"`
	Package      string `json:"package"`
	DatasheetURL string `json:"datasheet_url"`
	ProductURL   string `json:"product_url"`
	ImageURL     string `json:"image_url"`
	SupplierPart string `json:"supplier_part"`
}

// ErrNotFound means the catalogue has no part with that number.
var ErrNotFound = errors.New("part not found")

// Mouser uses the Mouser Search API (https://api.mouser.com), which needs a
// free API key from a Mouser account (My Account → APIs → Search API).
type Mouser struct {
	APIKey  string
	BaseURL string // https://api.mouser.com by default; tests point it elsewhere
	Client  *http.Client
}

type mouserResponse struct {
	Errors []struct {
		Message string `json:"Message"`
	} `json:"Errors"`
	SearchResults *struct {
		Parts []struct {
			ManufacturerPartNumber string `json:"ManufacturerPartNumber"`
			Manufacturer           string `json:"Manufacturer"`
			Description            string `json:"Description"`
			Category               string `json:"Category"`
			DataSheetURL           string `json:"DataSheetUrl"`
			ProductDetailURL       string `json:"ProductDetailUrl"`
			ImagePath              string `json:"ImagePath"`
			MouserPartNumber       string `json:"MouserPartNumber"`
			ProductAttributes      []struct {
				Name  string `json:"AttributeName"`
				Value string `json:"AttributeValue"`
			} `json:"ProductAttributes"`
		} `json:"Parts"`
	} `json:"SearchResults"`
}

// Lookup finds mpn in Mouser's catalogue. Of several results it prefers the
// one whose manufacturer part number is exactly mpn.
func (m *Mouser) Lookup(ctx context.Context, mpn string) (Part, error) {
	base := m.BaseURL
	if base == "" {
		base = "https://api.mouser.com"
	}
	client := m.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	body, _ := json.Marshal(map[string]any{
		"SearchByPartRequest": map[string]string{"mouserPartNumber": mpn, "partSearchOptions": "Exact"},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+"/api/v1/search/partnumber?apiKey="+url.QueryEscape(m.APIKey), bytes.NewReader(body))
	if err != nil {
		return Part{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return Part{}, fmt.Errorf("mouser: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return Part{}, fmt.Errorf("mouser: %w", err)
	}
	var r mouserResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return Part{}, fmt.Errorf("mouser: HTTP %d, unexpected answer", res.StatusCode)
	}
	if len(r.Errors) > 0 {
		return Part{}, fmt.Errorf("mouser: %s", r.Errors[0].Message)
	}
	if res.StatusCode != http.StatusOK {
		return Part{}, fmt.Errorf("mouser: HTTP %d", res.StatusCode)
	}
	if r.SearchResults == nil || len(r.SearchResults.Parts) == 0 {
		return Part{}, ErrNotFound
	}
	best := r.SearchResults.Parts[0]
	for _, p := range r.SearchResults.Parts {
		if strings.EqualFold(p.ManufacturerPartNumber, mpn) {
			best = p
			break
		}
	}
	part := Part{
		MPN:          best.ManufacturerPartNumber,
		Manufacturer: best.Manufacturer,
		Description:  strings.TrimSpace(best.Description),
		Category:     best.Category,
		DatasheetURL: httpURL(best.DataSheetURL),
		ProductURL:   httpURL(best.ProductDetailURL),
		ImageURL:     httpURL(best.ImagePath),
		SupplierPart: best.MouserPartNumber,
	}
	for _, a := range best.ProductAttributes {
		if a.Name == "Package / Case" || a.Name == "Case Code - in" {
			part.Package = a.Value
			break
		}
	}
	if part.Package == "" {
		// The API usually has no package attribute.
		part.Package = Footprint(part.MPN, part.Description)
	}
	return part, nil
}

// httpURL keeps only absolute http(s) links.
func httpURL(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://") {
		return s
	}
	return ""
}
