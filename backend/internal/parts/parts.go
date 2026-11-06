// Package parts looks up component details (description, datasheet, image)
// by manufacturer part number in distributors' catalogues.
package parts

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrNotFound means the catalogue has no part with that number.
var ErrNotFound = errors.New("part not found")

// Client talks to the distributors. The room PC's network is not always up,
// so it gives up on connecting quickly; once connected, an answer may be slow.
var Client = func() *http.Client {
	const connect = 5 * time.Second
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.DialContext = (&net.Dialer{Timeout: connect}).DialContext
	t.TLSHandshakeTimeout = connect
	return &http.Client{Timeout: 15 * time.Second, Transport: t}
}()

// Unreachable reports whether err means a distributor could not be talked to
// at all (no internet, usually), rather than that it gave a bad answer.
func Unreachable(err error) bool {
	var u *url.Error
	return errors.As(err, &u)
}

// Source is one distributor's catalogue.
type Source interface {
	Name() string
	Lookup(ctx context.Context, mpn string) (Part, error)
}

// Chain asks each source in turn and answers with the first that knows the
// part.
type Chain []Source

// Lookup returns the first source's answer for mpn. It is ErrNotFound only
// if every source said so; otherwise a source's failure is returned, since
// the part may be in a catalogue that could not be asked.
func (c Chain) Lookup(ctx context.Context, mpn string) (Part, error) {
	var failed error
	for _, s := range c {
		p, err := s.Lookup(ctx, mpn)
		if err == nil {
			return p, nil
		}
		if !errors.Is(err, ErrNotFound) && failed == nil {
			failed = err
		}
	}
	if failed != nil {
		return Part{}, failed
	}
	return Part{}, ErrNotFound
}

// Names lists the sources, e.g. ["Mouser", "DigiKey"].
func (c Chain) Names() []string {
	names := make([]string, len(c))
	for i, s := range c {
		names[i] = s.Name()
	}
	return names
}

// Prefer moves the source called name (any case) to the front, e.g. to ask
// DigiKey first about a part from a DigiKey bag.
func (c Chain) Prefer(name string) Chain {
	for i, s := range c {
		if i > 0 && strings.EqualFold(s.Name(), name) {
			out := Chain{s}
			out = append(out, c[:i]...)
			return append(out, c[i+1:]...)
		}
	}
	return c
}

// httpURL keeps only absolute http(s) links; DigiKey's protocol-relative
// "//..." links become https.
func httpURL(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "//") {
		s = "https:" + s
	}
	if strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://") {
		return s
	}
	return ""
}
