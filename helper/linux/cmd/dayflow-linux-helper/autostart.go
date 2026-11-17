package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/godbus/dbus/v5"
	"github.com/kokuwaio/dayflow-electron/helper/linux/portal"
)

// runAutostart turns launch at login on or off. Inside Flatpak it asks the
// Background portal, which writes the autostart entry on the host; outside
// it writes an XDG autostart .desktop file.
func runAutostart(args []string) error {
	fs := flag.NewFlagSet("autostart", flag.ExitOnError)
	enable := fs.Bool("enable", true, "launch at login")
	_ = fs.Parse(args)
	command := fs.Args() // outside Flatpak: the program and its arguments

	if os.Getenv("FLATPAK_ID") != "" {
		conn, err := dbus.ConnectSessionBus()
		if err != nil {
			return err
		}
		defer conn.Close()
		p := portal.New(conn)
		res, err := p.Request("org.freedesktop.portal.Background.RequestBackground", []any{""}, map[string]dbus.Variant{
			"reason":      dbus.MakeVariant("Record your screen in the background to build your timeline"),
			"autostart":   dbus.MakeVariant(*enable),
			"commandline": dbus.MakeVariant([]string{"dayflow-electron", "--hidden"}),
		})
		if err != nil {
			return err
		}
		emit("autostart", map[string]any{"enabled": res["autostart"].Value(), "background": res["background"].Value()})
		return nil
	}

	config := os.Getenv("XDG_CONFIG_HOME")
	if config == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		config = filepath.Join(home, ".config")
	}
	file := filepath.Join(config, "autostart", appID+".desktop")
	if !*enable {
		if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		emit("autostart", map[string]any{"enabled": false})
		return nil
	}
	if len(command) == 0 {
		return errors.New("autostart: pass the command to start after the flags")
	}
	entry := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=Dayflow\nExec=%s --hidden\nX-GNOME-Autostart-enabled=true\n", execLine(command))
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(file, []byte(entry), 0o644); err != nil {
		return err
	}
	emit("autostart", map[string]any{"enabled": true, "file": file})
	return nil
}

// execLine quotes arguments for a desktop entry's Exec key: arguments with
// reserved characters go in double quotes, with ", `, $ and \ escaped.
func execLine(args []string) string {
	quoted := make([]string, len(args))
	for i, a := range args {
		if a != "" && !strings.ContainsAny(a, " \t\n\"'\\><~|&;$*?#()`") {
			quoted[i] = a
			continue
		}
		var b strings.Builder
		b.WriteByte('"')
		for _, r := range a {
			if strings.ContainsRune("\"`$\\", r) {
				b.WriteByte('\\')
			}
			b.WriteRune(r)
		}
		b.WriteByte('"')
		quoted[i] = b.String()
	}
	return strings.Join(quoted, " ")
}
