# Build the Ricekit Chrome extension into a loadable .zip (CRX optional).
#
#   make          → dist/ricekit-chrome-<version>.zip
#   make zip      → same
#   make clean    → remove dist/
#
# Loading unpacked:
#   chrome://extensions → Developer mode → Load unpacked → this directory
#
# The "key" field in manifest.json pins the extension ID to
# ngjbhommfkaanpkgmlfacgleeliofmkf so the ricekit native-messaging host can
# allowlist a single chrome-extension://<id>/ origin across all users.

NAME    := ricekit-chrome
VERSION := $(shell sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
DIST    := dist
ZIP     := $(DIST)/$(NAME)-$(VERSION).zip

SOURCES := manifest.json \
           background.js \
           content.js

.PHONY: all zip clean

all: zip

zip: $(ZIP)

$(ZIP): $(SOURCES) Makefile | $(DIST)
	@rm -f $@
	@zip -qX $@ $(SOURCES)
	@echo "built $@"

$(DIST):
	@mkdir -p $(DIST)

clean:
	rm -rf $(DIST)
