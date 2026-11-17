package portal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

// Stream is one shared monitor: its PipeWire node and its place on the desktop.
type Stream struct {
	Node       uint32
	X, Y, W, H int32
}

// pair reads a D-Bus (ii) struct, which godbus delivers as []interface{}.
func pair(v dbus.Variant) []int32 {
	fields, ok := v.Value().([]interface{})
	if !ok || len(fields) != 2 {
		return nil
	}
	a, ok1 := fields[0].(int32)
	b, ok2 := fields[1].(int32)
	if !ok1 || !ok2 {
		return nil
	}
	return []int32{a, b}
}

// ScreenCast is a started portal session.
type ScreenCast struct {
	conn    *dbus.Conn
	portal  *Portal
	session dbus.ObjectPath
	Streams []Stream
}

// Info describes how a session started.
type Info struct {
	UsedRestore bool
	// DialogMs is how long Start took, including any dialog.
	DialogMs int64
	Warnings []string
}

// Close ends the session; the compositor stops the streams.
func (s *ScreenCast) Close() {
	s.conn.Object("org.freedesktop.portal.Desktop", s.session).Call("org.freedesktop.portal.Session.Close", 0)
}

// OpenPipeWireRemote returns a PipeWire fd that can see the session's streams.
func (s *ScreenCast) OpenPipeWireRemote() (int, error) {
	var fd dbus.UnixFD
	if err := s.portal.obj.Call("org.freedesktop.portal.ScreenCast.OpenPipeWireRemote", 0, s.session, map[string]dbus.Variant{}).Store(&fd); err != nil {
		return -1, fmt.Errorf("OpenPipeWireRemote: %w", err)
	}
	return int(fd), nil
}

// StartScreenCast opens a ScreenCast portal session for all monitors, reusing
// and renewing the restore token in tokenFile. cursorMode: 1 hidden,
// 2 embedded, 4 metadata. appID registers host (non-Flatpak) processes.
func StartScreenCast(conn *dbus.Conn, appID, tokenFile string, cursorMode uint32) (*ScreenCast, Info, error) {
	var info Info
	if os.Getenv("FLATPAK_ID") == "" {
		// Host apps have no app ID unless they register one.
		reg := conn.Object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop")
		if call := reg.Call("org.freedesktop.host.portal.Registry.Register", 0, appID, map[string]dbus.Variant{}); call.Err != nil {
			info.Warnings = append(info.Warnings, "registry: "+call.Err.Error())
		}
	}

	p := New(conn)
	cursorModes, _ := p.obj.GetProperty("org.freedesktop.portal.ScreenCast.AvailableCursorModes")
	res, err := p.Request("CreateSession", nil, map[string]dbus.Variant{
		"session_handle_token": dbus.MakeVariant(fmt.Sprintf("dayflowsession%d", os.Getpid())),
	})
	if err != nil {
		return nil, info, err
	}
	sc := &ScreenCast{conn: conn, portal: p, session: dbus.ObjectPath(res["session_handle"].Value().(string))}

	selectOpts := map[string]dbus.Variant{
		"types":        dbus.MakeVariant(uint32(1)), // monitors
		"multiple":     dbus.MakeVariant(true),      // all screens; we keep the one under the mouse
		"persist_mode": dbus.MakeVariant(uint32(2)), // until revoked
	}
	if modes, ok := cursorModes.Value().(uint32); ok && modes&cursorMode != 0 {
		selectOpts["cursor_mode"] = dbus.MakeVariant(cursorMode)
	} else {
		info.Warnings = append(info.Warnings, fmt.Sprintf("cursor mode %d not offered (%v)", cursorMode, cursorModes.Value()))
	}
	restored := false
	if b, err := os.ReadFile(tokenFile); err == nil && len(strings.TrimSpace(string(b))) > 0 {
		selectOpts["restore_token"] = dbus.MakeVariant(strings.TrimSpace(string(b)))
		restored = true
	}
	if _, err := p.Request("SelectSources", []any{sc.session}, selectOpts); err != nil {
		sc.Close()
		return nil, info, err
	}
	started := time.Now()
	res, err = p.Request("Start", []any{sc.session, ""}, map[string]dbus.Variant{})
	if err != nil {
		sc.Close()
		return nil, info, err
	}
	if tok, ok := res["restore_token"]; ok {
		if err := os.MkdirAll(filepath.Dir(tokenFile), 0o700); err != nil {
			return nil, info, err
		}
		if err := os.WriteFile(tokenFile, []byte(tok.Value().(string)), 0o600); err != nil {
			return nil, info, err
		}
	}

	var raw []rawStream
	if err := dbus.Store([]any{res["streams"].Value()}, &raw); err != nil {
		sc.Close()
		return nil, info, fmt.Errorf("streams: %w", err)
	}
	sc.Streams = parseStreams(raw)
	if len(sc.Streams) == 0 {
		sc.Close()
		return nil, info, errors.New("portal returned no streams")
	}
	info.UsedRestore = restored
	info.DialogMs = time.Since(started).Milliseconds()
	return sc, info, nil
}

// rawStream is one entry of the portal's "streams" result, a(ua{sv}).
type rawStream struct {
	Node  uint32
	Props map[string]dbus.Variant
}

func parseStreams(raw []rawStream) []Stream {
	streams := make([]Stream, 0, len(raw))
	for _, r := range raw {
		s := Stream{Node: r.Node}
		if pos := pair(r.Props["position"]); pos != nil {
			s.X, s.Y = pos[0], pos[1]
		}
		if size := pair(r.Props["size"]); size != nil {
			s.W, s.H = size[0], size[1]
		}
		streams = append(streams, s)
	}
	return streams
}
