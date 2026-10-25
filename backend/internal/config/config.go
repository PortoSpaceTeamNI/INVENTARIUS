// Package config reads the server configuration from INVENTARIUS_* environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr    string // listen address
	DataDir string // SQLite database and uploaded photos
	BaseURL string // public URL, used for OAuth redirects
	// LabelURL prefixes the code in QR labels; a short host keeps the QR
	// small. Defaults to BaseURL.
	LabelURL string

	// Google sign-in. Only accounts in AllowedDomain may log in.
	GoogleClientID     string
	GoogleClientSecret string
	AllowedDomain      string
	// Emails that are made admin on first login.
	Admins []string

	// DevAuth enables a password-less "pick a user" login. Never in production.
	DevAuth bool

	// Printer device, e.g. /dev/usb/lp0. "" disables printing; "file:<dir>"
	// writes each label as a PNG to dir instead (development).
	Printer string
	// Default code printed on labels: datamatrix, qr or code128.
	Symbology string
	// Gather queued labels for this long and print them as one job, so the
	// tape lead-in is paid once per batch instead of per label.
	PrintBatchDelay time.Duration
	// Rotate printed labels 180° if they come out upside down.
	PrintFlip bool

	// Mouser Search API key, to fill in new items (description, datasheet,
	// image) from a part number. "" turns the lookup off.
	MouserAPIKey string

	SessionTTL time.Duration
}

func Load() (Config, error) {
	c := Config{
		Addr:               env("INVENTARIUS_ADDR", ":8080"),
		DataDir:            env("INVENTARIUS_DATA_DIR", "./data"),
		BaseURL:            strings.TrimRight(env("INVENTARIUS_BASE_URL", "http://localhost:8080"), "/"),
		GoogleClientID:     os.Getenv("INVENTARIUS_GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("INVENTARIUS_GOOGLE_CLIENT_SECRET"),
		AllowedDomain:      env("INVENTARIUS_ALLOWED_DOMAIN", "portospaceteam.pt"),
		Printer:            os.Getenv("INVENTARIUS_PRINTER"),
		Symbology:          env("INVENTARIUS_SYMBOLOGY", "datamatrix"),
		MouserAPIKey:       strings.TrimSpace(os.Getenv("INVENTARIUS_MOUSER_API_KEY")),
		SessionTTL:         30 * 24 * time.Hour,
	}
	c.LabelURL = strings.TrimRight(env("INVENTARIUS_LABEL_URL", c.BaseURL), "/")
	for _, a := range strings.Split(os.Getenv("INVENTARIUS_ADMINS"), ",") {
		if a = strings.TrimSpace(a); a != "" {
			c.Admins = append(c.Admins, strings.ToLower(a))
		}
	}
	var err error
	if c.DevAuth, err = envBool("INVENTARIUS_DEV_AUTH"); err != nil {
		return c, err
	}
	if c.PrintFlip, err = envBool("INVENTARIUS_PRINT_FLIP"); err != nil {
		return c, err
	}
	if c.PrintBatchDelay, err = time.ParseDuration(env("INVENTARIUS_PRINT_BATCH_DELAY", "3s")); err != nil {
		return c, fmt.Errorf("INVENTARIUS_PRINT_BATCH_DELAY: %w", err)
	}
	switch c.Symbology {
	case "datamatrix", "qr", "code128":
	default:
		return c, fmt.Errorf("INVENTARIUS_SYMBOLOGY: unknown %q", c.Symbology)
	}
	if !c.DevAuth && c.GoogleClientID == "" {
		return c, fmt.Errorf("no login method: set INVENTARIUS_GOOGLE_CLIENT_ID/SECRET, or INVENTARIUS_DEV_AUTH=1 for development")
	}
	return c, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string) (bool, error) {
	v := os.Getenv(key)
	if v == "" {
		return false, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: %w", key, err)
	}
	return b, nil
}
