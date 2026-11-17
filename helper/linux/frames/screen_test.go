package frames

import (
	"testing"
	"time"
)

func TestPickActiveStream(t *testing.T) {
	screen := func(x, y int, age time.Duration) CursorReading {
		return CursorReading{Valid: true, X: x, Y: y, Width: 2560, Height: 1440, Age: age}
	}
	tests := []struct {
		name    string
		streams []CursorReading
		want    int
	}{
		{"no cursor anywhere", []CursorReading{{Width: 2560, Height: 1440}, {Width: 2560, Height: 1440}}, -1},
		{"cursor on the second screen", []CursorReading{{Width: 2560, Height: 1440}, screen(100, 200, time.Second)}, 1},
		{
			// At the border the left screen still reports x = 2560 (just outside it).
			"position just outside a screen does not count",
			[]CursorReading{screen(2560, 300, 0), screen(0, 300, time.Second)},
			1,
		},
		{"negative positions do not count", []CursorReading{screen(-12, 18, 0), screen(5, 18, time.Second)}, 1},
		{"newest report wins when both are inside", []CursorReading{screen(10, 10, 2*time.Second), screen(10, 10, 300*time.Millisecond)}, 1},
		{"invalid cursor data is ignored", []CursorReading{{Valid: false, X: 5, Y: 5, Width: 2560, Height: 1440}, screen(5, 5, time.Hour)}, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PickActiveStream(tt.streams); got != tt.want {
				t.Fatalf("PickActiveStream() = %d, want %d", got, tt.want)
			}
		})
	}
}
