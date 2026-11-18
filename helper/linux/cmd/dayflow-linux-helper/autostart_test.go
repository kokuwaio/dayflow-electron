package main

import "testing"

func TestExecLine(t *testing.T) {
	tests := []struct {
		args []string
		want string
	}{
		{[]string{"/usr/bin/electron", "/opt/app"}, "/usr/bin/electron /opt/app"},
		{[]string{"/home/me/My Apps/electron", "/x"}, `"/home/me/My Apps/electron" /x`},
		// Quoted for the Exec rules, then escaped as a desktop-entry string: backslashes double.
		{[]string{`/a"b$c`}, `"/a\\"b\\$c"`},
		{[]string{"/opt/100%/app"}, "/opt/100%%/app"},
		{[]string{""}, `""`},
	}
	for _, tt := range tests {
		if got := execLine(tt.args); got != tt.want {
			t.Errorf("execLine(%q) = %s, want %s", tt.args, got, tt.want)
		}
	}
}
