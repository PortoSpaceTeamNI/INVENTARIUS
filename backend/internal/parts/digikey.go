package parts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// DigiKey uses DigiKey's Product Information API v4
// (https://developer.digikey.com), which needs the client ID and secret of a
// production app registered on that site. The app signs in with OAuth2
// client credentials: no DigiKey user has to log in.
type DigiKey struct {
	ClientID     string
	ClientSecret string
	BaseURL      string // https://api.digikey.com by default; tests point it elsewhere
	Client       *http.Client
	// Site and language for product links and descriptions; PT and en by
	// default.
	Site, Language string

	mu      sync.Mutex
	token   string
	expires time.Time
}

func (d *DigiKey) Name() string { return "DigiKey" }

type digikeyProduct struct {
	Description struct {
		ProductDescription  string `json:"ProductDescription"`
		DetailedDescription string `json:"DetailedDescription"`
	} `json:"Description"`
	Manufacturer struct {
		Name string `json:"Name"`
	} `json:"Manufacturer"`
	ManufacturerProductNumber string `json:"ManufacturerProductNumber"`
	ProductURL                string `json:"ProductUrl"`
	DatasheetURL              string `json:"DatasheetUrl"`
	PhotoURL                  string `json:"PhotoUrl"`
	ProductVariations         []struct {
		DigiKeyProductNumber string `json:"DigiKeyProductNumber"`
	} `json:"ProductVariations"`
	Parameters []struct {
		Name  string `json:"ParameterText"`
		Value string `json:"ValueText"`
	} `json:"Parameters"`
	Category *digikeyCategory `json:"Category"`
}

type digikeyCategory struct {
	Name            string            `json:"Name"`
	ChildCategories []digikeyCategory `json:"ChildCategories"`
}

// digikeyProblem is the API's error body (RFC 7807 problem details).
type digikeyProblem struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
	// The token endpoint answers OAuth2 errors instead.
	ErrorDescription string `json:"error_description"`
}

func (p digikeyProblem) message() string {
	for _, s := range []string{p.Detail, p.ErrorDescription, p.Title} {
		if s = strings.TrimSpace(s); s != "" {
			return s
		}
	}
	return ""
}

func (d *DigiKey) base() string {
	if d.BaseURL == "" {
		return "https://api.digikey.com"
	}
	return strings.TrimRight(d.BaseURL, "/")
}

func (d *DigiKey) client() *http.Client {
	if d.Client == nil {
		return Client
	}
	return d.Client
}

// accessToken returns a cached token, or gets a new one (they last ten
// minutes).
func (d *DigiKey) accessToken(ctx context.Context) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.token != "" && time.Now().Before(d.expires) {
		return d.token, nil
	}
	form := url.Values{
		"client_id":     {d.ClientID},
		"client_secret": {d.ClientSecret},
		"grant_type":    {"client_credentials"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.base()+"/v1/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := d.client().Do(req)
	if err != nil {
		return "", fmt.Errorf("digikey: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var t struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if res.StatusCode != http.StatusOK || json.Unmarshal(raw, &t) != nil || t.AccessToken == "" {
		var p digikeyProblem
		json.Unmarshal(raw, &p)
		if msg := p.message(); msg != "" {
			return "", fmt.Errorf("digikey: sign-in failed (HTTP %d): %s", res.StatusCode, msg)
		}
		return "", fmt.Errorf("digikey: sign-in failed (HTTP %d)", res.StatusCode)
	}
	if t.ExpiresIn <= 0 {
		t.ExpiresIn = 600
	}
	d.token = t.AccessToken
	// A little early, so a token doesn't run out on the way.
	d.expires = time.Now().Add(time.Duration(t.ExpiresIn)*time.Second - 30*time.Second)
	return d.token, nil
}

func (d *DigiKey) dropToken() {
	d.mu.Lock()
	d.token = ""
	d.mu.Unlock()
}

// Lookup finds mpn (a manufacturer or DigiKey part number) in DigiKey's
// catalogue.
func (d *DigiKey) Lookup(ctx context.Context, mpn string) (Part, error) {
	res, raw, err := d.productDetails(ctx, mpn)
	if err == nil && res.StatusCode == http.StatusUnauthorized {
		// The token may have been revoked early; try once with a new one.
		d.dropToken()
		res, raw, err = d.productDetails(ctx, mpn)
	}
	if err != nil {
		return Part{}, err
	}
	switch {
	case res.StatusCode == http.StatusNotFound:
		return Part{}, ErrNotFound
	case res.StatusCode != http.StatusOK:
		var p digikeyProblem
		json.Unmarshal(raw, &p)
		if msg := p.message(); msg != "" {
			return Part{}, fmt.Errorf("digikey: HTTP %d: %s", res.StatusCode, msg)
		}
		return Part{}, fmt.Errorf("digikey: HTTP %d", res.StatusCode)
	}
	var r struct {
		Product *digikeyProduct `json:"Product"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return Part{}, fmt.Errorf("digikey: unexpected answer")
	}
	if r.Product == nil || r.Product.ManufacturerProductNumber == "" {
		return Part{}, ErrNotFound
	}
	return r.Product.part(), nil
}

func (d *DigiKey) productDetails(ctx context.Context, mpn string) (*http.Response, []byte, error) {
	token, err := d.accessToken(ctx)
	if err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		d.base()+"/products/v4/search/"+url.PathEscape(mpn)+"/productdetails", nil)
	if err != nil {
		return nil, nil, err
	}
	site, lang := d.Site, d.Language
	if site == "" {
		site = "PT"
	}
	if lang == "" {
		lang = "en"
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-DIGIKEY-Client-Id", d.ClientID)
	req.Header.Set("X-DIGIKEY-Locale-Site", site)
	req.Header.Set("X-DIGIKEY-Locale-Language", lang)
	req.Header.Set("X-DIGIKEY-Locale-Currency", "EUR")
	req.Header.Set("Accept", "application/json")
	res, err := d.client().Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("digikey: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, nil, fmt.Errorf("digikey: %w", err)
	}
	return res, raw, nil
}

func (p *digikeyProduct) part() Part {
	desc := strings.TrimSpace(p.Description.DetailedDescription)
	if desc == "" {
		desc = strings.TrimSpace(p.Description.ProductDescription)
	}
	part := Part{
		Supplier:     "DigiKey",
		MPN:          p.ManufacturerProductNumber,
		Manufacturer: p.Manufacturer.Name,
		Description:  desc,
		DatasheetURL: httpURL(p.DatasheetURL),
		ProductURL:   httpURL(p.ProductURL),
		ImageURL:     httpURL(p.PhotoURL),
	}
	if len(p.ProductVariations) > 0 {
		part.SupplierPart = p.ProductVariations[0].DigiKeyProductNumber
	}
	// The most specific category: "Capacitors" → "Ceramic Capacitors".
	for c := p.Category; c != nil; {
		part.Category = c.Name
		if len(c.ChildCategories) == 0 {
			break
		}
		c = &c.ChildCategories[0]
	}
	params := map[string]string{}
	for _, a := range p.Parameters {
		params[a.Name] = strings.TrimSpace(a.Value)
	}
	for _, name := range []string{"Package / Case", "Supplier Device Package"} {
		// "0603 (1608 Metric)" → "0603"
		if v, _, _ := strings.Cut(params[name], " ("); v != "" && v != "-" {
			part.Package = strings.TrimSpace(v)
			break
		}
	}
	if part.Package == "" {
		part.Package = Footprint(part.MPN, part.Description)
	}
	return part
}
