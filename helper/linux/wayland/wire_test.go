package wayland

import (
	"bytes"
	"net"
	"testing"
)

func TestStringEncoding(t *testing.T) {
	tests := []struct {
		in      string
		wantLen int // 4-byte length + string + NUL, padded to 4
	}{
		{"", 8},
		{"abc", 8},
		{"wl_seat", 12},
		{"ext_idle_notifier_v1", 28},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			enc := wlString(tt.in)
			if len(enc) != tt.wantLen {
				t.Fatalf("len(wlString(%q)) = %d, want %d", tt.in, len(enc), tt.wantLen)
			}
			got, rest := readString(append(enc, 0xAA, 0xBB, 0xCC, 0xDD))
			if got != tt.in {
				t.Errorf("readString() = %q, want %q", got, tt.in)
			}
			if !bytes.Equal(rest, []byte{0xAA, 0xBB, 0xCC, 0xDD}) {
				t.Errorf("readString() left %x, want the following argument", rest)
			}
		})
	}
}

func TestMessageFraming(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	sender := &wlConn{c: client}
	receiver := &wlConn{c: server}

	args := append(wlUint(42), wlString("wl_seat")...)
	errc := make(chan error, 1)
	go func() {
		errc <- sender.send(3, 7, args)
	}()

	object, opcode, body, err := receiver.read()
	if err != nil {
		t.Fatal(err)
	}
	if sendErr := <-errc; sendErr != nil {
		t.Fatal(sendErr)
	}
	if object != 3 || opcode != 7 || !bytes.Equal(body, args) {
		t.Fatalf("read() = object %d, opcode %d, body %x; want 3, 7, %x", object, opcode, body, args)
	}
}

func TestNewIDCountsUpFromDisplay(t *testing.T) {
	w := &wlConn{nextID: 1} // id 1 is wl_display
	if a, b := w.newID(), w.newID(); a != 2 || b != 3 {
		t.Fatalf("newID() = %d, %d; want 2, 3", a, b)
	}
}
