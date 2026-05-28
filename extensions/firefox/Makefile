# Build the Ricekit Firefox/Zen extension into a loadable XPI.
#
#   make          → dist/ricekit-firefox.xpi
#   make xpi      → same
#   make clean    → remove dist/
#
# Unsigned XPIs install via:
#   - about:debugging → Load Temporary Add-on
#   - Firefox Developer Edition / Nightly with xpinstall.signatures.required=false
#
# For stable Firefox, sign via `web-ext sign` (not wired up here).

NAME    := ricekit-firefox
DIST    := dist
XPI     := $(DIST)/$(NAME).xpi

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
