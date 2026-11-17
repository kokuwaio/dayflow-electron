// Command dayflow-linux-helper gives the Electron app access to the Linux
// desktop without native Node modules. It prints one JSON object per line on
// stdout; every object has "type" and "ts" (Unix milliseconds).
//
//	capture -dir D [-interval 10] [-height 1080] [-token F]
//	        ScreenCast portal + PipeWire: one JPEG of the screen under the
//	        mouse per interval. Pauses while locked, restarts after unlock.
//	        Reads "block"/"unblock" lines on stdin; while blocked it saves
//	        nothing and reports "frame-skipped" instead.
//	watch   [-idle 300]
//	        screen lock, sleep and idle
//	window  active window title and app (KDE only, opt-in KWin permission
//	        in Flatpak); the app uses it for blocked apps
//	autostart -enable=true|false [-command C]
//	        launch at login (Background portal inside Flatpak)
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

const appID = "io.github.kokuwaio.DayflowElectron"

// version is set at build time: go build -ldflags "-X main.version=1.2.3" (scripts/version.sh).
var version = "dev"

var emitMu sync.Mutex

func emit(kind string, fields map[string]any) {
	if fields == nil {
		fields = map[string]any{}
	}
	fields["type"] = kind
	fields["ts"] = time.Now().UnixMilli()
	b, _ := json.Marshal(fields)
	emitMu.Lock()
	defer emitMu.Unlock()
	fmt.Println(string(b))
}

func fail(err error) {
	emit("error", map[string]any{"message": err.Error()})
	os.Exit(1)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: dayflow-linux-helper capture|watch|window|autostart|version [flags]")
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "capture":
		err = runCapture(os.Args[2:])
	case "watch":
		err = runWatch(os.Args[2:])
	case "window":
		err = runWindow()
	case "autostart":
		err = runAutostart(os.Args[2:])
	case "version":
		fmt.Println(version)
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fail(err)
	}
}

func waitForInterrupt() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch
}
