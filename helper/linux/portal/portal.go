// Package portal talks to xdg-desktop-portal over D-Bus: requests that answer
// through a Request object, and ScreenCast sessions for all monitors.
package portal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"

	"github.com/godbus/dbus/v5"
)

var tokenCounter atomic.Uint64

// ErrCancelled means the user dismissed the portal dialog.
var ErrCancelled = errors.New("cancelled by the user")

// Portal is the org.freedesktop.portal.Desktop object on the session bus.
type Portal struct {
	conn   *dbus.Conn
	obj    dbus.BusObject
	sender string
}

func New(conn *dbus.Conn) *Portal {
	sender := strings.ReplaceAll(strings.TrimPrefix(conn.Names()[0], ":"), ".", "_")
	return &Portal{
		conn:   conn,
		obj:    conn.Object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop"),
		sender: sender,
	}
}

// Request calls a portal method that answers through a Request object and
// waits for its Response signal. A method without an interface prefix is a
// ScreenCast method. Cancelling ctx closes the request, which also closes any
// dialog it opened.
func (p *Portal) Request(ctx context.Context, method string, args []any, options map[string]dbus.Variant) (map[string]dbus.Variant, error) {
	token := fmt.Sprintf("dayflow%d_%d", os.Getpid(), tokenCounter.Add(1))
	options["handle_token"] = dbus.MakeVariant(token)
	path := dbus.ObjectPath("/org/freedesktop/portal/desktop/request/" + p.sender + "/" + token)

	match := []dbus.MatchOption{
		dbus.WithMatchObjectPath(path),
		dbus.WithMatchInterface("org.freedesktop.portal.Request"),
		dbus.WithMatchMember("Response"),
	}
	if err := p.conn.AddMatchSignal(match...); err != nil {
		return nil, err
	}
	// RemoveSignal only drops the local channel; the bus-side rule must go too,
	// or restarts on the same connection pile them up.
	defer func() { _ = p.conn.RemoveMatchSignal(match...) }()
	signals := make(chan *dbus.Signal, 4)
	p.conn.Signal(signals)
	defer p.conn.RemoveSignal(signals)

	full := method
	if !strings.Contains(method, ".") {
		full = "org.freedesktop.portal.ScreenCast." + method
	}
	call := p.obj.CallWithContext(ctx, full, 0, append(args, options)...)
	if call.Err != nil {
		return nil, fmt.Errorf("%s: %w", method, call.Err)
	}
	for {
		select {
		case <-ctx.Done():
			_ = p.conn.Object("org.freedesktop.portal.Desktop", path).Call("org.freedesktop.portal.Request.Close", 0).Err
			return nil, fmt.Errorf("%s: %w", method, ctx.Err())
		case sig, ok := <-signals:
			if !ok {
				return nil, errors.New("signal channel closed")
			}
			if sig.Path != path || sig.Name != "org.freedesktop.portal.Request.Response" {
				continue
			}
			code := sig.Body[0].(uint32)
			results := sig.Body[1].(map[string]dbus.Variant)
			switch code {
			case 0:
				return results, nil
			case 1:
				return nil, fmt.Errorf("%s: %w", method, ErrCancelled)
			default:
				return nil, fmt.Errorf("%s: failed (response %d)", method, code)
			}
		}
	}
}
