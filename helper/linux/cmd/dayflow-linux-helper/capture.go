package main

// capture: one JPEG of the screen under the mouse per interval, from a
// ScreenCast portal session (all screens, restore token) read through
// PipeWire. Pauses while the screen is locked and restarts the session after
// unlock, when the monitors come back.

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/kokuwaio/dayflow-electron/helper/linux/frames"
	"github.com/kokuwaio/dayflow-electron/helper/linux/pipewire"
	"github.com/kokuwaio/dayflow-electron/helper/linux/portal"
)

type pwOptions struct {
	dir         string
	interval    time.Duration
	height      int
	maxfps      int
	statusEvery time.Duration
	tokenFile   string
}

const (
	// maxMissedFrames ends a session whose stream stopped delivering frames.
	maxMissedFrames = 6
	// maxSessionFailures ends the helper after that many unproductive sessions.
	maxSessionFailures = 3
	// frameTimeLayout names frames like the Windows and macOS capture
	// (src/main/platform/frames.ts): local time to the millisecond and the UTC offset.
	frameTimeLayout = "20060102-150405.000-0700"
)

// blocked is set while the app reports a blocked window (password manager)
// in front; see readBlockCommands.
var blocked atomic.Bool

// readBlockCommands reads "block" and "unblock" lines from the app.
func readBlockCommands(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		switch strings.TrimSpace(scanner.Text()) {
		case "block":
			blocked.Store(true)
		case "unblock":
			blocked.Store(false)
		}
	}
}

var (
	errInterrupted = errors.New("interrupted")
	// errStart marks a session that could not start (dialog cancelled, portal
	// or PipeWire failure). The helper exits so the app can back off, instead
	// of reopening the share dialog every few seconds.
	errStart = errors.New("capture could not start")
)

func runCapture(args []string) error {
	fs := flag.NewFlagSet("capture", flag.ExitOnError)
	dir := fs.String("dir", defaultDataPath("frames"), "directory for JPEG frames")
	interval := fs.Int("interval", 10, "seconds between saved frames")
	height := fs.Int("height", 1080, "frame height in pixels")
	maxfps := fs.Int("maxfps", 1, "maximum frame rate requested from the compositor")
	statusEvery := fs.Int("status", 60, "seconds between status lines")
	tokenFile := fs.String("token", defaultDataPath("restore-token"), "file that keeps the portal restore token")
	_ = fs.Parse(args)
	opts := pwOptions{*dir, time.Duration(*interval) * time.Second, *height, *maxfps,
		time.Duration(*statusEvery) * time.Second, *tokenFile}

	if err := os.MkdirAll(opts.dir, 0o755); err != nil {
		return err
	}
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return err
	}
	defer conn.Close()

	// Lock state: nothing is saved while locked, and a session that lost its
	// streams (monitors off) restarts after unlock.
	var locked atomic.Bool
	go readBlockCommands(os.Stdin)
	if err := conn.AddMatchSignal(dbus.WithMatchInterface("org.freedesktop.ScreenSaver"), dbus.WithMatchMember("ActiveChanged")); err != nil {
		return err
	}
	lockSignals := make(chan *dbus.Signal, 8)
	conn.Signal(lockSignals)
	go func() {
		for sig := range lockSignals {
			if sig.Name != "org.freedesktop.ScreenSaver.ActiveChanged" || len(sig.Body) != 1 {
				continue
			}
			if l, ok := sig.Body[0].(bool); ok && locked.Swap(l) != l {
				emit("lock", map[string]any{"locked": l})
			}
		}
	}()

	interrupted := make(chan os.Signal, 1)
	signal.Notify(interrupted, os.Interrupt, syscall.SIGTERM)

	// Sessions that end without handling a frame while unlocked count as
	// failures; after a few in a row the helper exits so the app backs off.
	failures := 0
	for attempt := 1; ; attempt++ {
		framesDue := 0 // frames saved, or skipped because a blocked app was in front
		err := runPWSession(conn, opts, &locked, interrupted, &framesDue)
		if errors.Is(err, errInterrupted) {
			emit("stopped", map[string]any{"reason": "interrupted"})
			return nil
		}
		if errors.Is(err, errStart) {
			return err
		}
		emit("session-ended", map[string]any{"error": fmt.Sprint(err), "attempt": attempt, "framesDue": framesDue})
		if framesDue > 0 || locked.Load() {
			failures = 0
		} else if failures++; failures >= maxSessionFailures {
			return fmt.Errorf("capture keeps failing: %w", err)
		}
		// Wait until unlocked, then give the monitors a moment to come back.
		for locked.Load() {
			select {
			case <-interrupted:
				emit("stopped", map[string]any{"reason": "interrupted"})
				return nil
			case <-time.After(time.Second):
			}
		}
		select {
		case <-interrupted:
			emit("stopped", map[string]any{"reason": "interrupted"})
			return nil
		case <-time.After(3 * time.Second):
		}
		emit("restarting", map[string]any{"attempt": attempt + 1})
	}
}

// runPWSession runs one portal session until a stream fails or we are
// interrupted (errInterrupted).
func runPWSession(conn *dbus.Conn, opts pwOptions, locked *atomic.Bool, interrupted <-chan os.Signal, framesDue *int) error {
	// A stop while the share dialog is open closes the dialog and ends the helper.
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	var stopped atomic.Bool
	go func() {
		select {
		case <-interrupted:
			stopped.Store(true)
			cancel()
		case <-started:
		}
	}()
	sc, info, err := portal.StartScreenCast(ctx, conn, appID, opts.tokenFile, 4) // cursor as metadata
	close(started)
	cancel()
	for _, w := range info.Warnings {
		emit("warning", map[string]any{"message": w})
	}
	if stopped.Load() {
		if err == nil {
			sc.Close()
		}
		return errInterrupted
	}
	if err != nil {
		return fmt.Errorf("%w: %w", errStart, err)
	}
	defer sc.Close()
	described := make([]string, len(sc.Streams))
	nodes := make([]uint32, len(sc.Streams))
	for i, s := range sc.Streams {
		described[i] = fmt.Sprintf("node %d %dx%d+%d+%d", s.Node, s.W, s.H, s.X, s.Y)
		nodes[i] = s.Node
	}
	emit("started", map[string]any{"streams": described, "usedRestore": info.UsedRestore, "dialogMs": info.DialogMs, "cursorMode": 4})

	fd, err := sc.OpenPipeWireRemote()
	if err != nil {
		return fmt.Errorf("%w: %w", errStart, err)
	}
	if err := pipewire.Start(fd, nodes, opts.maxfps); err != nil {
		return fmt.Errorf("%w: %w", errStart, err)
	}
	defer pipewire.Stop()
	emit("pipewire", map[string]any{"streams": len(sc.Streams), "maxfps": opts.maxfps})

	save := time.NewTicker(opts.interval)
	defer save.Stop()
	poll := time.NewTicker(250 * time.Millisecond)
	defer poll.Stop()
	status := time.NewTicker(opts.statusEvery)
	defer status.Stop()

	active := -1
	var frameBuf []byte
	var rgba *image.RGBA
	missed := 0
	for {
		select {
		case <-interrupted:
			return errInterrupted
		case <-poll.C:
			readings := make([]frames.CursorReading, len(sc.Streams))
			for i := range sc.Streams {
				st, _ := pipewire.Snapshot(i, nil)
				if st.Err != "" || st.State < 0 {
					return fmt.Errorf("stream %d failed (state %d): %s", i, st.State, st.Err)
				}
				readings[i] = frames.CursorReading{
					Valid: st.CursorValid, X: st.CursorX, Y: st.CursorY, Width: st.Width, Height: st.Height, Age: st.CursorAge,
				}
			}
			best := frames.PickActiveStream(readings)
			if best >= 0 && best != active {
				active = best
				s := sc.Streams[best]
				st, _ := pipewire.Snapshot(best, nil)
				emit("cursor-screen", map[string]any{"stream": best, "geometry": fmt.Sprintf("%dx%d+%d+%d", s.W, s.H, s.X, s.Y), "x": st.CursorX, "y": st.CursorY})
			}
		case <-status.C:
			list := []map[string]any{}
			for i := range sc.Streams {
				st, _ := pipewire.Snapshot(i, nil)
				list = append(list, map[string]any{
					"stream": i, "size": fmt.Sprintf("%dx%d", st.Width, st.Height), "format": st.Format,
					"dataType": st.DataType, "buffers": st.Buffers, "copied": st.Copied,
					"cursorUpdates": st.CursorUpdates, "cursorValid": st.CursorValid, "state": st.State,
				})
			}
			emit("status", map[string]any{"streams": list, "locked": locked.Load()})
		case <-save.C:
			if locked.Load() {
				continue
			}
			if blocked.Load() {
				// A blocked app is in front: save nothing, only say that a frame was due.
				*framesDue++
				emit("frame-skipped", map[string]any{"capturedAt": time.Now().UnixMilli(), "reason": "blocked"})
				continue
			}
			idx := active
			if idx < 0 {
				idx = 0
			}
			// Ask for the next frame and wait for it (the compositor sends
			// one per second).
			before, _ := pipewire.Snapshot(idx, nil)
			pipewire.Request(idx)
			deadline := time.Now().Add(2500 * time.Millisecond)
			st, size := before, 0
			for time.Now().Before(deadline) {
				time.Sleep(50 * time.Millisecond)
				st, size = pipewire.Snapshot(idx, nil)
				if st.Copied > before.Copied {
					break
				}
			}
			if st.Copied == before.Copied || size == 0 {
				missed++
				emit("warning", map[string]any{"message": fmt.Sprintf("no new frame on stream %d", idx)})
				if missed >= maxMissedFrames {
					return fmt.Errorf("no frames from stream %d for %d intervals", idx, missed)
				}
				continue
			}
			if cap(frameBuf) < size {
				frameBuf = make([]byte, size)
			}
			st, size = pipewire.Snapshot(idx, frameBuf[:size])
			start := time.Now()
			var err error
			rgba, err = frames.ToRGBA(rgba, frameBuf[:size], st.Width, st.Height, st.Format)
			if err != nil {
				return err
			}
			// The app may have sent "block" while we waited for the frame.
			if blocked.Load() {
				*framesDue++
				emit("frame-skipped", map[string]any{"capturedAt": time.Now().UnixMilli(), "reason": "blocked"})
				continue
			}
			out := frames.ScaleToHeight(rgba, opts.height)
			now := time.Now()
			f, name, err := createFrame(opts.dir, now, idx)
			if err != nil {
				return err
			}
			err = jpeg.Encode(f, out, &jpeg.Options{Quality: 75})
			// Close reports write errors too; a half-written frame must not be announced.
			if cerr := f.Close(); err == nil {
				err = cerr
			}
			if err != nil {
				_ = os.Remove(name)
				return err
			}
			info, _ := os.Stat(name)
			b := out.Bounds()
			missed = 0
			*framesDue++
			emit("frame", map[string]any{
				"path": name, "capturedAt": now.UnixMilli(), "stream": idx, "bytes": info.Size(),
				"width": b.Dx(), "height": b.Dy(), "encodeMs": time.Since(start).Milliseconds(),
			})
			debug.FreeOSMemory() // the scaled image and encoder buffers are garbage now
		}
	}
}

func defaultDataPath(name string) string {
	if d := os.Getenv("XDG_DATA_HOME"); d != "" {
		return filepath.Join(d, name)
	}
	return name
}

// createFrame creates a new frame file named after its capture time. It never
// replaces a file: a taken name (two frames in one millisecond) moves on to
// the next millisecond. Milliseconds keep a restarted capture's first frame
// apart from the one before it, the UTC offset the repeated autumn hour.
func createFrame(dir string, at time.Time, screen int) (*os.File, string, error) {
	const attempts = 5
	var err error
	for i := range attempts {
		name := filepath.Join(dir, fmt.Sprintf("%s_s%d.jpg", at.Add(time.Duration(i)*time.Millisecond).Format(frameTimeLayout), screen))
		var f *os.File
		f, err = os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			return f, name, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, "", err
		}
	}
	return nil, "", err
}
