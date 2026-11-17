package main

// Active window through a KWin script (KDE Plasma only). In the Flatpak this
// needs the opt-in permission --talk-name=org.kde.KWin.

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/godbus/dbus/v5"
)

type windowReceiver struct{}

func (windowReceiver) Active(caption, class string, pid int32) *dbus.Error {
	emit("window", map[string]any{"title": caption, "app": class, "pid": pid})
	return nil
}

const kwinScript = `
function report(w) {
  callDBus("%[1]s", "/window", "%[2]s", "Active",
    w ? String(w.caption || "") : "",
    w ? String(w.resourceClass || "") : "",
    w ? (w.pid || 0) : 0);
}
workspace.windowActivated.connect(report);
workspace.windowAdded.connect(function (w) {
  w.captionChanged.connect(function () { if (workspace.activeWindow === w) report(w); });
});
workspace.windowList().forEach(function (w) {
  w.captionChanged.connect(function () { if (workspace.activeWindow === w) report(w); });
});
report(workspace.activeWindow);
`

func runWindow() error {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.Export(windowReceiver{}, "/window", appID); err != nil {
		return err
	}

	// KWin loads the script from its own (host) file system. Inside Flatpak
	// only $XDG_RUNTIME_DIR/app/$FLATPAK_ID is shared with the host.
	scriptDir := os.TempDir()
	if id := os.Getenv("FLATPAK_ID"); id != "" {
		scriptDir = filepath.Join(os.Getenv("XDG_RUNTIME_DIR"), "app", id)
		if err := os.MkdirAll(scriptDir, 0o700); err != nil {
			return err
		}
	}
	script := filepath.Join(scriptDir, "dayflow-electron-window.js")
	if err := os.WriteFile(script, []byte(fmt.Sprintf(kwinScript, conn.Names()[0], appID)), 0o600); err != nil {
		return err
	}
	defer os.Remove(script)

	plugin := "dayflow-electron-window"
	kwin := conn.Object("org.kde.KWin", "/Scripting")
	// Inside Flatpak the PID is always the same, so a killed run leaves a
	// script with this name behind. Unload it first.
	kwin.Call("org.kde.kwin.Scripting.unloadScript", 0, plugin)
	var id int32
	if err := kwin.Call("org.kde.kwin.Scripting.loadScript", 0, script, plugin).Store(&id); err != nil {
		return fmt.Errorf("KWin loadScript (KDE Plasma only): %w", err)
	}
	defer kwin.Call("org.kde.kwin.Scripting.unloadScript", 0, plugin)
	if call := conn.Object("org.kde.KWin", dbus.ObjectPath(fmt.Sprintf("/Scripting/Script%d", id))).
		Call("org.kde.kwin.Script.run", 0); call.Err != nil {
		return fmt.Errorf("KWin run script: %w", call.Err)
	}
	emit("window-watcher", map[string]any{"scriptId": id})
	waitForInterrupt()
	return nil
}
