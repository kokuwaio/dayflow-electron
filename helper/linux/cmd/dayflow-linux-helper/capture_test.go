package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFrameTimeLayout(t *testing.T) {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Skip("no time zone data:", err)
	}
	cases := []struct {
		at   time.Time
		want string
	}{
		// Same names as frameFileName in src/main/platform/frames.ts.
		{time.Date(2026, 11, 17, 9, 5, 7, 42_000_000, berlin), "20261117-090507.042+0100"},
		{time.Date(2026, 11, 17, 9, 5, 7, 980_000_000, berlin), "20261117-090507.980+0100"},
		{time.Date(2026, 7, 2, 23, 59, 59, 0, berlin), "20260702-235959.000+0200"},
	}
	for _, c := range cases {
		if got := c.at.Format(frameTimeLayout); got != c.want {
			t.Errorf("Format(%v) = %q, want %q", c.at, got, c.want)
		}
	}
}

func TestCreateFrameNeverReplacesAFile(t *testing.T) {
	dir := t.TempDir()
	at := time.Date(2026, 11, 17, 9, 5, 7, 42_000_000, time.UTC)
	taken := filepath.Join(dir, "20261117-090507.042+0000_s0.jpg")
	if err := os.WriteFile(taken, []byte("earlier frame"), 0o644); err != nil {
		t.Fatal(err)
	}
	f, name, err := createFrame(dir, at, 0)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	if want := filepath.Join(dir, "20261117-090507.043+0000_s0.jpg"); name != want {
		t.Errorf("name = %q, want %q", name, want)
	}
	if b, _ := os.ReadFile(taken); string(b) != "earlier frame" {
		t.Errorf("the earlier frame was replaced: %q", b)
	}
}
