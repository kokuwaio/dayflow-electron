# Builds the helper inside the Flatpak SDK, which has libpipewire-0.3, using
# the host's Go toolchain. Only ./pipewire needs cgo; the other packages
# also test on the host with plain "go test ./frames/... ./portal/... ./wayland/...".
SDK ?= org.freedesktop.Sdk//25.08
OUT ?= bin/dayflow-linux-helper
VERSION ?= dev
GOROOT_HOST ?= $(shell go env GOROOT)
# The SDK sandbox sees only the home folder (paths under /usr cannot be shared
# at all), so a Go installed elsewhere (/usr/local/go, /usr/lib/go) is copied
# once into the cache and used from there.
GOROOT_SDK := $(if $(filter $(HOME)/%,$(GOROOT_HOST)),$(GOROOT_HOST),$(HOME)/.cache/dayflow-electron/go-$(shell $(GOROOT_HOST)/bin/go env GOVERSION))
IN_SDK = flatpak run --filesystem=home --command=sh $(SDK) -c 'cd $(CURDIR) && CGO_ENABLED=1 GOTOOLCHAIN=local GOROOT=$(GOROOT_SDK) $(GOROOT_SDK)/bin/go

.PHONY: build vet test lint toolchain
build: toolchain
	$(IN_SDK) build -trimpath -ldflags "-X main.version=$(VERSION)" -o $(OUT) ./cmd/dayflow-linux-helper'

vet: toolchain
	$(IN_SDK) vet ./...'

test: toolchain
	$(IN_SDK) test ./...'

toolchain:
	@if [ ! -x "$(GOROOT_SDK)/bin/go" ]; then \
		echo "copying $(GOROOT_HOST) to $(GOROOT_SDK) for the Flatpak SDK"; \
		mkdir -p "$(GOROOT_SDK)" && cp -R "$(GOROOT_HOST)/." "$(GOROOT_SDK)/"; \
	fi

# On the host: needs golangci-lint and the libpipewire-0.3 headers (CI installs both).
# Some distributions' libpipewire-0.3.pc passes -fno-strict-overflow, which cgo blocks by default.
lint:
	CGO_CFLAGS_ALLOW=-fno-strict-overflow golangci-lint run ./...
