# Entry point for developing, checking and packaging the app. `make` lists the targets.
# The npm scripts and helper/linux/Makefile do the work; CI runs the same steps.

HELPER = helper/linux
# 1.2.3 on a release tag, else 0.0.0-<branch>.<sha>; override with make VERSION=...
VERSION ?= $(shell scripts/version.sh)

.PHONY: help install dev check typecheck test test-helper lint build helper pack flatpak version clean

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
	flatpak-builder --user --install --force-clean flatpak/build flatpak/io.github.kokuwaio.DayflowElectron.yml

version:
	@echo $(VERSION)

clean:
	rm -rf out dist flatpak/build flatpak/.flatpak-builder flatpak/repo $(HELPER)/bin
