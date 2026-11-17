package main

import "testing"

func TestExecLine(t *testing.T) {
	tests := []struct {
		args []string
		want string
	}{
		{[]string{"/usr/bin/electron", "/opt/app"}, "/usr/bin/electron /opt/app"},
		{[]string{"/home/me/My Apps/electron", "/x"}, `"/home/me/My Apps/electron" /x`},
		{[]string{`/a"b$c`}, `"/a\"b\$c"`},
		{[]string{""}, `""`},
	}
	for _, tt := range tests {
		if got := execLine(tt.args); got != tt.want {
			t.Errorf("execLine(%q) = %s, want %s", tt.args, got, tt.want)
		}
	}
}
