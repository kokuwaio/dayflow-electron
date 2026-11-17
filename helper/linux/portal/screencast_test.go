package portal

import (
	"reflect"
	"testing"

	"github.com/godbus/dbus/v5"
)

// structVariant is how godbus delivers a D-Bus (ii) struct.
func structVariant(a, b int32) dbus.Variant { return dbus.MakeVariant([]interface{}{a, b}) }

func TestParseStreams(t *testing.T) {
	tests := []struct {
		name string
		raw  []rawStream
		want []Stream
	}{
		{
			"two monitors side by side",
			[]rawStream{
				{Node: 110, Props: map[string]dbus.Variant{"position": structVariant(0, 0), "size": structVariant(2560, 1440)}},
				{Node: 62, Props: map[string]dbus.Variant{"position": structVariant(2560, 0), "size": structVariant(2560, 1440)}},
			},
			[]Stream{{Node: 110, W: 2560, H: 1440}, {Node: 62, X: 2560, W: 2560, H: 1440}},
		},
		{
			"missing geometry leaves zeros",
			[]rawStream{{Node: 7, Props: map[string]dbus.Variant{}}},
			[]Stream{{Node: 7}},
		},
		{
			"wrongly typed geometry is ignored",
			[]rawStream{{Node: 8, Props: map[string]dbus.Variant{
				"position": dbus.MakeVariant([]interface{}{uint32(1), uint32(2)}),
				"size":     dbus.MakeVariant([]interface{}{int32(1920)}),
			}}},
			[]Stream{{Node: 8}},
		},
		{"no streams", nil, []Stream{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseStreams(tt.raw); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("parseStreams() = %+v, want %+v", got, tt.want)
			}
		})
	}
}
