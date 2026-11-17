package main

import (
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
