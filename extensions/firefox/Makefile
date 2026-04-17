# Build the Ricekit Firefox/Zen extension into a loadable XPI.
#
#   make          → dist/ricekit-theme-<version>.xpi
#   make xpi      → same
#   make clean    → remove dist/
#
# Version is pulled from manifest.json so bumping the manifest is the only
# thing needed for a release.
#
# Unsigned XPIs install via:
#   - about:debugging → Load Temporary Add-on
#   - Firefox Developer Edition / Nightly with xpinstall.signatures.required=false
#
# For stable Firefox, sign via `web-ext sign` (not wired up here).

NAME    := ricekit-theme
VERSION := $(shell sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
DIST    := dist
XPI     := $(DIST)/$(NAME)-$(VERSION).xpi

SOURCES := manifest.json \
           background.js \
           api.js \
           api-sheet.js \
           schema.json \
           schema-sheet.json

.PHONY: all xpi clean

all: xpi

xpi: $(XPI)

$(XPI): $(SOURCES) Makefile | $(DIST)
	@rm -f $@
	@zip -qX $@ $(SOURCES)
	@echo "built $@"

$(DIST):
	@mkdir -p $(DIST)

clean:
	rm -rf $(DIST)
