// Package wayland detects idle time on Wayland through the ext-idle-notify-v1 protocol, with a
// minimal pure-Go Wayland client (no libwayland). Electron's
// powerMonitor.getSystemIdleTime() always returns 0 on Wayland.
package wayland

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"
)

type wlConn struct {
	c      net.Conn
	nextID uint32
}

func (w *wlConn) newID() uint32 { w.nextID++; return w.nextID }

// send writes one request: object id, opcode and already encoded arguments.
func (w *wlConn) send(object uint32, opcode uint16, args []byte) error {
	msg := make([]byte, 8, 8+len(args))
	binary.LittleEndian.PutUint32(msg[0:], object)
	binary.LittleEndian.PutUint32(msg[4:], uint32(8+len(args))<<16|uint32(opcode))
	_, err := w.c.Write(append(msg, args...))
	return err
}

func (w *wlConn) read() (object uint32, opcode uint16, body []byte, err error) {
	var hdr [8]byte
	if _, err = io.ReadFull(w.c, hdr[:]); err != nil {
		return
	}
	object = binary.LittleEndian.Uint32(hdr[0:])
	word := binary.LittleEndian.Uint32(hdr[4:])
	opcode = uint16(word & 0xffff)
	body = make([]byte, int(word>>16)-8)
	_, err = io.ReadFull(w.c, body)
	return
}

func wlUint(v uint32) []byte { return binary.LittleEndian.AppendUint32(nil, v) }

func wlString(s string) []byte {
	b := wlUint(uint32(len(s) + 1))
	b = append(b, s...)
	b = append(b, 0)
	for len(b)%4 != 0 {
		b = append(b, 0)
	}
	return b
}

func readString(b []byte) (string, []byte) {
	n := binary.LittleEndian.Uint32(b)
	s := string(b[4 : 4+n-1])
	padded := (n + 3) &^ 3
	return s, b[4+padded:]
}

// WatchIdle calls report(true, since) when there was no input for timeoutSec
// seconds and report(false, since) on the next input, until the connection to
// the compositor fails. since is when input stopped.
func WatchIdle(timeoutSec int, report func(idle bool, since time.Time)) error {
	timeout := &timeoutSec

	display := os.Getenv("WAYLAND_DISPLAY")
	if display == "" {
		return errors.New("WAYLAND_DISPLAY is not set (not a Wayland session)")
	}
	if !filepath.IsAbs(display) {
		display = filepath.Join(os.Getenv("XDG_RUNTIME_DIR"), display)
	}
	c, err := net.Dial("unix", display)
	if err != nil {
		return err
	}
	defer c.Close()
	w := &wlConn{c: c, nextID: 1} // id 1 is wl_display

	registry := w.newID()
	if err := w.send(1, 1, wlUint(registry)); err != nil { // wl_display.get_registry
		return err
	}
	callback := w.newID()
	if err := w.send(1, 0, wlUint(callback)); err != nil { // wl_display.sync
		return err
	}

	var seatName, notifierName, notifierVersion uint32
	for {
		obj, op, body, err := w.read()
		if err != nil {
			return err
		}
		if obj == 1 && op == 0 {
			msg, _ := readString(body[8:])
			return fmt.Errorf("wayland error: %s", msg)
		}
		if obj == registry && op == 0 { // wl_registry.global
			name := binary.LittleEndian.Uint32(body)
			iface, rest := readString(body[4:])
			version := binary.LittleEndian.Uint32(rest)
			switch iface {
			case "wl_seat":
				if seatName == 0 {
					seatName = name
				}
			case "ext_idle_notifier_v1":
				notifierName, notifierVersion = name, version
			}
		}
		if obj == callback && op == 0 { // wl_callback.done
			break
		}
	}
	if seatName == 0 || notifierName == 0 {
		return errors.New("compositor offers no ext_idle_notifier_v1 or wl_seat")
	}

	bind := func(name uint32, iface string, version uint32) (uint32, error) {
		id := w.newID()
		args := append(wlUint(name), wlString(iface)...)
		args = append(args, wlUint(version)...)
		args = append(args, wlUint(id)...)
		return id, w.send(registry, 0, args) // wl_registry.bind
	}
	seat, err := bind(seatName, "wl_seat", 1)
	if err != nil {
		return err
	}
	notifier, err := bind(notifierName, "ext_idle_notifier_v1", 1)
	if err != nil {
		return err
	}
	notification := w.newID()
	req := append(wlUint(notification), wlUint(uint32(*timeout*1000))...)
	req = append(req, wlUint(seat)...)
	if err := w.send(notifier, 1, req); err != nil { // get_idle_notification
		return err
	}
	_ = notifierVersion

	var idleSince time.Time
	for {
		obj, op, body, err := w.read()
		if err != nil {
			return err
		}
		if obj == 1 && op == 0 {
			msg, _ := readString(body[8:])
			return fmt.Errorf("wayland error: %s", msg)
		}
		if obj != notification {
			continue
		}
		switch op {
		case 0: // idled
			idleSince = time.Now().Add(-time.Duration(*timeout) * time.Second)
			report(true, idleSince)
		case 1: // resumed
			report(false, idleSince)
		}
	}
}
