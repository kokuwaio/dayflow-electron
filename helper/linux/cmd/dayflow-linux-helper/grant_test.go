package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/kokuwaio/dayflow-electron/helper/linux/portal"
)

type fakeSession struct{ closed bool }

func (s *fakeSession) Close() { s.closed = true }

func TestGrant(t *testing.T) {
	cancelled := errors.New("Start: cancelled")
	tests := []struct {
		name    string
		token   string // what the session writes; "" writes nothing
		err     error
		wantErr error
	}{
		{name: "stores the token and closes the session", token: "abc"},
		{name: "reports a dialog that was cancelled", err: cancelled, wantErr: cancelled},
		{name: "reports a choice that was not remembered", wantErr: errNotRemembered},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokenFile := filepath.Join(t.TempDir(), "token")
			session := &fakeSession{}
			start := func(_ context.Context, file string) (closer, portal.Info, error) {
				if tt.err != nil {
					return nil, portal.Info{}, tt.err
				}
				if tt.token != "" {
					if err := os.WriteFile(file, []byte(tt.token), 0o600); err != nil {
						t.Fatal(err)
					}
				}
				return session, portal.Info{}, nil
			}
			err := grant(context.Background(), tokenFile, start)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("grant() = %v, want %v", err, tt.wantErr)
			}
			if wantClosed := tt.err == nil; session.closed != wantClosed {
				t.Errorf("session closed = %t, want %t", session.closed, wantClosed)
			}
		})
	}
}
