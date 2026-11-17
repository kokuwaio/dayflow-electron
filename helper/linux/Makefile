# Builds the helper inside the Flatpak SDK, which has libpipewire-0.3, using
# the host's Go toolchain. Only ./pipewire needs cgo; the other packages
# also test on the host with plain "go test ./frames/... ./portal/... ./wayland/...".
SDK ?= org.freedesktop.Sdk//25.08
OUT ?= bin/dayflow-linux-helper
GOROOT_HOST := $(shell go env GOROOT)
IN_SDK = flatpak run --filesystem=home --command=sh $(SDK) -c 'cd $(CURDIR) && CGO_ENABLED=1 GOTOOLCHAIN=local $(GOROOT_HOST)/bin/go

.PHONY: build vet test lint
build:
	$(IN_SDK) build -trimpath -o $(OUT) ./cmd/dayflow-linux-helper'

vet:
	$(IN_SDK) vet ./...'

test:
	$(IN_SDK) test ./...'

# On the host: needs golangci-lint and the libpipewire-0.3 headers (CI installs both).
lint:
	golangci-lint run ./...
