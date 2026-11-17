package main

// grant: opens the ScreenCast share dialog once, during onboarding, so the
// restore token exists before recording starts. The session ends right after
// the dialog; no frames are read.

import (
	"context"
	"errors"
	"flag"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/godbus/dbus/v5"
	"github.com/kokuwaio/dayflow-electron/helper/linux/portal"
)

// errNotRemembered means the user shared the screens but did not allow
// restoring, so the desktop will ask again when recording starts.
var errNotRemembered = errors.New("the desktop did not remember the choice; allow restoring the permission in the dialog, or it asks again when recording starts")

// closer is a started session; *portal.ScreenCast satisfies it.
type closer interface{ Close() }

// startFunc starts a session that reads and renews the restore token in tokenFile.
type startFunc func(ctx context.Context, tokenFile string) (closer, portal.Info, error)

func runGrant(args []string) error {
	fs := flag.NewFlagSet("grant", flag.ExitOnError)
	tokenFile := fs.String("token", defaultDataPath("restore-token"), "file that keeps the portal restore token")
	_ = fs.Parse(args)

	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return err
	}
	defer conn.Close()
	// A stop while the dialog is open closes the dialog.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return grant(ctx, *tokenFile, func(ctx context.Context, tokenFile string) (closer, portal.Info, error) {
		sc, info, err := portal.StartScreenCast(ctx, conn, appID, tokenFile, 4) // the capture's cursor mode
		if err != nil {
			return nil, info, err
		}
		return sc, info, nil
	})
}

// grant runs one session, closes it and reports "granted" once the restore
// token is stored.
func grant(ctx context.Context, tokenFile string, start startFunc) error {
	sc, info, err := start(ctx, tokenFile)
	for _, w := range info.Warnings {
		emit("warning", map[string]any{"message": w})
	}
	if err != nil {
		return err
	}
	sc.Close()
	if b, err := os.ReadFile(tokenFile); err != nil || strings.TrimSpace(string(b)) == "" {
		return errNotRemembered
	}
	emit("granted", map[string]any{"usedRestore": info.UsedRestore, "dialogMs": info.DialogMs})
	return nil
}
