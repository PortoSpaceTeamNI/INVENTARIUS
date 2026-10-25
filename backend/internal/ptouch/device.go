package ptouch

import (
	"context"
	"errors"
	"fmt"
	"image"
	"io"
	"os"
	"time"
)

// Conn is an open connection to the printer.
type Conn interface {
	io.Writer
	// ReadPacket returns the next 32-byte status packet, or os.ErrDeadlineExceeded
	// if none arrives before the deadline.
	ReadPacket(deadline time.Time) ([]byte, error)
	Close() error
}

// Dialer opens a connection; the USB one opens the usblp device file.
type Dialer func() (Conn, error)

// Printer prints label images on a P-touch printer.
type Printer struct {
	Dial Dialer
	// MarginDots fed before and after each label (default MinMarginDots).
	MarginDots int
}

// USB returns a dialer for a printer attached through the Linux usblp
// driver, e.g. /dev/usb/lp0.
func USB(path string) Dialer {
	return func() (Conn, error) {
		f, err := os.OpenFile(path, os.O_RDWR, 0)
		if err != nil {
			return nil, err
		}
		return &fileConn{f: f}, nil
	}
}

type fileConn struct{ f *os.File }

func (c *fileConn) Write(p []byte) (int, error) { return c.f.Write(p) }
func (c *fileConn) Close() error                { return c.f.Close() }

func (c *fileConn) ReadPacket(deadline time.Time) ([]byte, error) {
	// usblp supports poll(), so the runtime poller can enforce the deadline.
	// Without one, a Read could block forever and keep the device busy, so
	// refuse to read rather than risk it.
	if err := c.f.SetReadDeadline(deadline); err != nil {
		return nil, fmt.Errorf("printer device does not support read deadlines: %w", err)
	}
	buf := make([]byte, 32)
	n := 0
	for n < len(buf) {
		m, err := c.f.Read(buf[n:])
		n += m
		// usblp returns 0 bytes (EOF) until the printer has something to send;
		// the PT-E550W takes a few hundred ms to answer a status request.
		if m == 0 && (err == nil || errors.Is(err, io.EOF)) {
			if time.Now().After(deadline) {
				return nil, os.ErrDeadlineExceeded
			}
			time.Sleep(50 * time.Millisecond)
			continue
		}
		if err != nil {
			return nil, err
		}
	}
	return buf, nil
}

// Status asks the printer for its status. It must not be called while printing.
func (p *Printer) Status(ctx context.Context) (Status, error) {
	c, err := p.Dial()
	if err != nil {
		return Status{}, err
	}
	defer c.Close()
	return requestStatus(ctx, c)
}

func requestStatus(ctx context.Context, c Conn) (Status, error) {
	// Invalidate + initialize clears any half-sent job, then request status.
	cmd := append(make([]byte, 100), 0x1b, 0x40, 0x1b, 0x69, 0x53)
	if _, err := c.Write(cmd); err != nil {
		return Status{}, err
	}
	deadline := time.Now().Add(3 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	for {
		pkt, err := c.ReadPacket(deadline)
		if err != nil {
			if errors.Is(err, os.ErrDeadlineExceeded) {
				return Status{}, fmt.Errorf("printer did not answer (is it on?)")
			}
			return Status{}, err
		}
		s, err := ParseStatus(pkt)
		if err != nil {
			return Status{}, err
		}
		if s.Type == StatusReply {
			return s, nil
		}
	}
}

// Result says what is known about a finished job.
type Result struct {
	Status    Status
	Confirmed bool // the printer reported every label as printed
}

// Print checks the printer, then prints labels as one job. wantTapeMM, if
// non-zero, refuses to print on any other tape width.
func (p *Printer) Print(ctx context.Context, labels []image.Image, wantTapeMM int) (Result, error) {
	c, err := p.Dial()
	if err != nil {
		return Result{}, err
	}
	defer c.Close()

	st, err := requestStatus(ctx, c)
	if err != nil {
		return Result{}, err
	}
	if err := st.Err(); err != nil {
		return Result{Status: st}, err
	}
	if wantTapeMM != 0 && st.MediaWidth != wantTapeMM {
		return Result{Status: st}, fmt.Errorf("printer has %d mm tape loaded, labels need %d mm", st.MediaWidth, wantTapeMM)
	}
	tape, ok := TapeFor(st.MediaWidth)
	if !ok {
		return Result{Status: st}, fmt.Errorf("unsupported tape width %d mm", st.MediaWidth)
	}

	data, err := Encode(labels, JobOptions{
		Tape:       tape,
		MediaType:  st.MediaType,
		MarginDots: p.MarginDots,
		HalfCut:    len(labels) > 1,
	})
	if err != nil {
		return Result{Status: st}, err
	}
	if _, err := c.Write(data); err != nil {
		return Result{Status: st}, err
	}

	// The printer sends status packets on its own while printing: one
	// "printing completed" per label, or an error.
	deadline := time.Now().Add(15*time.Second + time.Duration(len(labels))*3*time.Second)
	printed := 0
	for printed < len(labels) {
		pkt, err := c.ReadPacket(deadline)
		if err != nil {
			// The job was delivered; we just could not confirm it.
			return Result{Status: st}, nil
		}
		s, err := ParseStatus(pkt)
		if err != nil {
			continue
		}
		st = s
		switch s.Type {
		case StatusPrinted:
			printed++
		case StatusError:
			return Result{Status: s}, s.Err()
		case StatusTurnedOff:
			return Result{Status: s}, fmt.Errorf("printer turned off while printing")
		}
	}
	return Result{Status: st, Confirmed: true}, nil
}
