# Entry point for developing, checking and packaging the app. `make` lists the targets.
# helper/linux/Makefile builds the Go helper; CI (.github/workflows/build.yaml)
# runs the same checks and packages with the same electron-builder options.

HELPER = helper/linux
# 1.2.3 on a release tag, else 0.0.0-<branch>.<sha>; override with make VERSION=...
VERSION ?= $(shell scripts/version.sh)

.PHONY: help install dev check typecheck test test-helper lint build helper pack flatpak dist-win dist-mac version clean

help:
	@echo "make install      install npm dependencies (npm ci)"
	@echo "make dev          start the app with hot reload"
	@echo "make check        typecheck, test and lint everything (run before a PR)"
	@echo "make typecheck    TypeScript typecheck of main and renderer"
	@echo "make test         Vitest"
	@echo "make test-helper  Go tests of the Linux helper, inside the Flatpak SDK"
	@echo "make lint         golangci-lint on the Linux helper"
	@echo "make build        build the app into out/"
	@echo "make helper       build the Linux helper inside the Flatpak SDK"
	@echo "make pack         package the app into dist/linux-unpacked"
	@echo "make flatpak      pack, build the helper and install the Flatpak for this user"
	@echo "make version      print the version builds get (VERSION=... overrides it)"
	@echo "make dist-win     Windows NSIS installers (x64, arm64) in dist/; run on Windows"
	@echo "make dist-mac     macOS dmg images (arm64, x64) in dist/; run on macOS"
	@echo "make clean        remove build output"

install:
	npm ci

dev:
	npm run dev

check: typecheck test lint test-helper

typecheck:
	npm run typecheck

test:
	npm test

test-helper:
	$(MAKE) -C $(HELPER) test

lint:
	$(MAKE) -C $(HELPER) lint

build:
	npm run build

helper:
	$(MAKE) -C $(HELPER) build VERSION=$(VERSION)

pack:
	npx electron-vite build
	npx electron-builder --linux dir -c.extraMetadata.version=$(VERSION)

flatpak: pack helper
	flatpak-builder --user --install --force-clean packaging/flatpak/build packaging/flatpak/io.github.kokuwaio.DayflowElectron.yml

version:
	@echo $(VERSION)

dist-win:
	npx electron-vite build
	npx electron-builder --win nsis --x64 --publish never -c.extraMetadata.version=$(VERSION)
	npx electron-builder --win nsis --arm64 --publish never -c.extraMetadata.version=$(VERSION)

dist-mac:
	npx electron-vite build
	npx electron-builder --mac dmg --arm64 --x64 --publish never -c.extraMetadata.version=$(VERSION)

clean:
	rm -rf out dist packaging/flatpak/build packaging/flatpak/.flatpak-builder packaging/flatpak/repo $(HELPER)/bin
