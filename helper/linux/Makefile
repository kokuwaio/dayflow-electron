# Builds the helper inside the Flatpak SDK, which has libpipewire-0.3, using
# the host's Go toolchain, shared read-only into the sandbox because it may
# live outside the home folder (CI runners). Only ./pipewire needs cgo; the
# other packages also test on the host with plain "go test ./frames/...
# ./portal/... ./wayland/...".
SDK ?= org.freedesktop.Sdk//25.08
OUT ?= bin/dayflow-linux-helper
GOROOT_HOST := $(shell go env GOROOT)
IN_SDK = flatpak run --filesystem=home --filesystem=$(GOROOT_HOST):ro --command=sh $(SDK) -c 'cd $(CURDIR) && CGO_ENABLED=1 GOTOOLCHAIN=local $(GOROOT_HOST)/bin/go

.PHONY: build vet test
build:
	$(IN_SDK) build -trimpath -o $(OUT) ./cmd/dayflow-linux-helper'

vet:
	$(IN_SDK) vet ./...'

test:
	$(IN_SDK) test ./...'
