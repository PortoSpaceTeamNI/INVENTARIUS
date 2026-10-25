// Command server runs INVENTARIUS: the API, the embedded frontend and the
// label print queue.
package main

import (
	"context"
	"errors"
	"image"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"inventarius/internal/api"
	"inventarius/internal/auth"
	"inventarius/internal/config"
	"inventarius/internal/db"
	"inventarius/internal/labels"
	"inventarius/internal/printqueue"
	"inventarius/internal/ptouch"
	"inventarius/internal/web"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	store, err := db.Open(ctx, filepath.Join(cfg.DataDir, "inventarius.db"))
	if err != nil {
		return err
	}
	defer store.Close()

	var printer printqueue.Printer
	switch {
	case cfg.Printer == "":
	case strings.HasPrefix(cfg.Printer, "file:"):
		printer = printqueue.FilePrinter{Dir: strings.TrimPrefix(cfg.Printer, "file:")}
	default:
		printer = &ptouch.Printer{Dial: ptouch.USB(cfg.Printer)}
	}

	a := auth.New(cfg, store)
	webFS := web.FS()
	if webFS == nil {
		slog.Warn("frontend not built into this binary; use the Vite dev server")
	}
	// The queue and server reference each other: the queue renders jobs with
	// the server's label settings.
	var srv *api.Server
	queue := printqueue.New(store, printer, cfg.PrintBatchDelay, func(j db.PrintJob, t labels.Tape) (image.Image, error) {
		return srv.RenderJob(j, t)
	})
	srv, err = api.New(ctx, cfg, store, a, queue, webFS)
	if err != nil {
		return err
	}

	go queue.Run(ctx)
	go a.CleanupSessions(ctx)

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		httpSrv.Shutdown(shutdown)
	}()
	slog.Info("listening", "addr", cfg.Addr, "base_url", cfg.BaseURL, "printer", cfg.Printer, "dev_auth", cfg.DevAuth)
	if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
