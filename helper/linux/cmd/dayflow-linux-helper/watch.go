package main

import (
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/kokuwaio/dayflow-electron/helper/linux/wayland"
)

// runWatch reports screen lock, sleep and idle as JSON lines until stopped.
func runWatch(args []string) error {
	fs := flag.NewFlagSet("watch", flag.ExitOnError)
	idleSec := fs.Int("idle", 300, "seconds without input before reporting idle")
	_ = fs.Parse(args)

	session, err := dbus.ConnectSessionBus()
	if err != nil {
		return err
	}
	defer session.Close()
	system, err := dbus.ConnectSystemBus()
	if err != nil {
		return err
	}
	defer system.Close()

	if err := session.AddMatchSignal(
		dbus.WithMatchInterface("org.freedesktop.ScreenSaver"),
		dbus.WithMatchMember("ActiveChanged"),
	); err != nil {
		return err
	}
	if err := system.AddMatchSignal(
		dbus.WithMatchInterface("org.freedesktop.login1.Manager"),
		dbus.WithMatchMember("PrepareForSleep"),
	); err != nil {
		return err
	}
	// One channel per connection: each Close() closes its own channel.
	sessionSignals := make(chan *dbus.Signal, 16)
	systemSignals := make(chan *dbus.Signal, 16)
	session.Signal(sessionSignals)
	system.Signal(systemSignals)
	signals := make(chan *dbus.Signal, 16)
	forward := func(in chan *dbus.Signal) {
		for s := range in {
			signals <- s
		}
	}
	go forward(sessionSignals)
	go forward(systemSignals)

	go func() {
		err := wayland.WatchIdle(*idleSec, func(idle bool, since time.Time) {
			if idle {
				emit("idle", map[string]any{"idle": true, "since": since.UnixMilli()})
			} else {
				emit("idle", map[string]any{"idle": false})
			}
		})
		if err != nil {
			emit("warning", map[string]any{"message": "idle detection unavailable: " + err.Error()})
		}
	}()

	// Report the lock state once at start, then every change once (KDE
	// emits ActiveChanged on two object paths).
	var locked bool
	saver := session.Object("org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver")
	if err := saver.Call("org.freedesktop.ScreenSaver.GetActive", 0).Store(&locked); err != nil {
		emit("warning", map[string]any{"message": "lock state: " + err.Error()})
	}
	emit("lock", map[string]any{"locked": locked})

	interrupted := make(chan os.Signal, 1)
	signal.Notify(interrupted, os.Interrupt, syscall.SIGTERM)
	for {
		select {
		case sig := <-signals:
			switch sig.Name {
			case "org.freedesktop.ScreenSaver.ActiveChanged":
				if l, ok := sig.Body[0].(bool); ok && l != locked {
					locked = l
					emit("lock", map[string]any{"locked": l})
				}
			case "org.freedesktop.login1.Manager.PrepareForSleep":
				if s, ok := sig.Body[0].(bool); ok {
					emit("sleep", map[string]any{"sleeping": s})
				}
			}
		case <-interrupted:
			return nil
		}
	}
}
