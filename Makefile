# Entry point for developing, checking and packaging the app. `make` lists the targets.
# helper/linux/Makefile builds the Go helper; CI (.github/workflows/build.yaml)
# runs the same checks and packages with the same electron-builder options.

HELPER = helper/linux
# 1.2.3 on a release tag, else 0.0.0-<branch>.<sha>; override with make VERSION=...
VERSION ?= $(shell scripts/version.sh)
HELPER_BIN = $(HELPER)/bin/dayflow-linux-helper
HELPER_SRC = $(shell find $(HELPER) -name '*.go' -o -name go.mod -o -name go.sum)
# On Linux the app needs the helper; dev rebuilds it when its sources changed.
DEV_HELPER = $(if $(filter Linux,$(shell uname -s)),$(HELPER_BIN))

.PHONY: help install dev dev-clean bench-models screenshots check typecheck test test-helper lint build helper pack flatpak dist-linux dist-win dist-mac icons version clean

help:
	@echo "make install      install npm dependencies (npm ci)"
	@echo "make dev          start the app with hot reload"
	@echo "make dev-clean    like dev, with empty data, so the first-run setup shows again"
	@echo "make check        typecheck, test and lint everything (run before a PR)"
	@echo "make bench-models MODELS=\"a b\"  speed of local Ollama models on recorded screenshots"
	@echo "make screenshots  the README screenshots, from invented data, into out/screenshots"
	@echo "make typecheck    TypeScript typecheck of main and renderer"
	@echo "make test         Vitest"
	@echo "make test-helper  Go tests of the Linux helper, inside the Flatpak SDK"
	@echo "make lint         golangci-lint on the Linux helper"
	@echo "make build        build the app into out/"
	@echo "make helper       build the Linux helper inside the Flatpak SDK"
	@echo "make pack         package the app into dist/linux-unpacked"
	@echo "make flatpak      pack, build the helper and install the Flatpak for this user"
	@echo "make icons        render the PNG icons in resources/ from their SVGs (needs rsvg-convert)"
	@echo "make version      print the version builds get (VERSION=... overrides it)"
	@echo "make dist-linux   Flatpak bundle and the mise tarball for this architecture in dist/"
	@echo "make dist-win     Windows NSIS installers (x64, arm64) and latest.yml in dist/; run on Windows"
	@echo "make dist-mac     macOS dmg images and update zips (arm64, x64) in dist/; run on macOS"
	@echo "make clean        remove build output"

install:
	npm ci

dev: $(DEV_HELPER)
	npm run dev

# The first-run setup again: an empty data folder in .dev-clean-data, emptied
# at each start (kept after quitting, to look at). The usual dev data stays
# untouched; API keys live in the system keyring and stay too.
dev-clean: $(DEV_HELPER)
	rm -rf .dev-clean-data
	DAYFLOW_DATA_DIR="$(CURDIR)/.dev-clean-data" npm run dev

check: typecheck test lint test-helper

# Speed of local models on screenshots already recorded (scripts/bench-local-models.test.ts).
# MODELS: Ollama model names; BATCHES: how many of the latest batches (default 1);
# MINUTES: only the first minutes of each batch (default 1, 15 for whole batches);
# BENCH_BASE_URL and BENCH_DATA_DIR override the server and the data folder.
MODELS ?=
BATCHES ?= 1
MINUTES ?= 1
bench-models:
	@test -n "$(MODELS)" || { echo 'usage: make bench-models MODELS="qwen3-vl:2b-instruct qwen3-vl:8b-instruct" [BATCHES=2] [MINUTES=15]'; exit 2; }
	BENCH_MODELS="$(MODELS)" BENCH_BATCHES=$(BATCHES) BENCH_MINUTES=$(MINUTES) npx vitest run scripts/bench-local-models.test.ts --reporter=verbose --silent=false

typecheck:
	npm run typecheck

test:
	npm test

test-helper:
	$(MAKE) -C $(HELPER) test

lint:
	$(MAKE) -C $(HELPER) lint

# The README screenshots (scripts/screenshots.ts): invented data in a temporary folder, capture off,
# no AI provider reachable; the PNGs land in out/screenshots.
screenshots: build
	npx jiti scripts/screenshots.ts

build:
	npm run build

helper:
	$(MAKE) -C $(HELPER) build VERSION=$(VERSION)

$(HELPER_BIN): $(HELPER_SRC)
	$(MAKE) -C $(HELPER) build VERSION=$(VERSION)

pack:
	npx electron-vite build
	npx electron-builder --linux dir --publish never -c.extraMetadata.version=$(VERSION)

flatpak: pack helper
	flatpak-builder --user --install --force-clean packaging/flatpak/build packaging/flatpak/io.github.kokuwaio.DayflowElectron.yml

# PNGs from resources/*.svg; commit them with the SVGs.
icons:
	scripts/render-icons.sh

version:
	@echo $(VERSION)

# The Flatpak bundle (dist/dayflow-electron.flatpak) and the tarball for mise around it
# (scripts/linux-tarball.sh), for the host architecture, like the releases carry.
LINUX_ARCH = $(if $(filter aarch64 arm64,$(shell uname -m)),arm64,x64)
dist-linux: pack helper
	flatpak-builder --user --force-clean --repo=packaging/flatpak/repo packaging/flatpak/build packaging/flatpak/io.github.kokuwaio.DayflowElectron.yml
	flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo packaging/flatpak/repo dist/dayflow-electron.flatpak io.github.kokuwaio.DayflowElectron
	scripts/linux-tarball.sh dist/dayflow-electron.flatpak $(LINUX_ARCH) dist

dist-win:
	npx electron-vite build
	npx electron-builder --win nsis --x64 --publish never -c.extraMetadata.version=$(VERSION)
	mv dist/latest.yml dist/latest-x64.yml
	npx electron-builder --win nsis --arm64 --publish never -c.extraMetadata.version=$(VERSION)
	node scripts/merge-update-feeds.ts dist/latest.yml dist/latest-x64.yml dist/latest.yml
	rm dist/latest-x64.yml

dist-mac:
	npx electron-vite build
	npx electron-builder --mac dmg zip --arm64 --x64 --publish never -c.extraMetadata.version=$(VERSION)

clean:
	rm -rf out dist packaging/flatpak/build packaging/flatpak/.flatpak-builder packaging/flatpak/repo $(HELPER)/bin
