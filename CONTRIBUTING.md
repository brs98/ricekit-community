# Contributing to ricekit-community

Thanks for wanting to contribute. This repo is the public submission surface for Ricekit — the main app stays closed-source, but everything here is community-owned.

## Contributing a theme

1. Fork this repo and create a branch
2. Add a new directory: `themes/<your-theme-name>/`
3. Create `theme.toml` with the required schema (see any existing theme for reference)
4. Optionally include a `wallpapers/` subdirectory with matching images
5. Open a pull request against `main`
6. A maintainer reviews, test-loads the theme locally, and merges
7. Accepted themes ship to users in the next `content-v*` release tarball

Theme schema essentials: `[metadata]` (name, author, version, variant: `dark`|`light`, description) and `[colors.ansi]` (18 required color keys). Semantic colors are optional — Ricekit derives sensible defaults. The release workflow does a basic TOML parse-check before shipping; the authoritative schema lives in the Ricekit desktop app itself (reviewers verify themes load in a running desktop build).

## Contributing a template

1. Fork this repo and create a branch
2. Add a new directory: `templates/<app-name>/`
3. Create `config.toml` with the required schema (see any existing template for reference)
4. Add your template files alongside `config.toml`
5. Open a pull request against `main`
6. A maintainer reviews, test-loads the template locally, and merges
7. Accepted templates ship in the next `content-v*` release tarball

Template syntax: `{{variable}}` substitution plus `{{function(args)}}` color operations (`darken`, `lighten`, `alpha`, `blend`, `contrast`). Ricekit provides 26 palette variables at render time. The release workflow does a basic TOML parse-check before shipping.

## Contributing an integration

Integrations are HTTP-based extensions — Govee strips, Home Assistant scenes, Hue/LIFX bulbs, anything you can hit with a `curl`. Unlike templates, they don't render a config file to disk; they fire an HTTP request as part of `apply_theme` with first-class secret storage.

1. Fork this repo and create a branch
2. Add a new directory: `integrations/<integration-name>/`
3. Create `integration.toml` (see `integrations/govee-color/integration.toml` for the canonical example)
4. Add a body template under `body/` if your endpoint takes a request body
5. Open a pull request against `main`
6. A maintainer reviews, test-loads the integration locally with their own API credentials, and merges

### Schema essentials

```toml
[metadata]
name = "your-integration"
author = "your-name"
version = "1.0.0"
description = "..."
app = "..."          # short identifier, e.g. "govee", "hass"
category = "..."     # open string — known values surface first in UI: lighting, smarthome, presence, audio
type = "integration"

# Secrets reference OS-keychain entries. Users set values via `ricekit secrets set <name> <key>`.
[secrets]
api_key = { keychain = "api_key", prompt = "Helpful prompt shown to the user" }

[on_apply]
method = "PUT"                       # GET, POST, PUT, PATCH, DELETE
url = "https://api.example.com/..."  # may contain @@secret:KEY@@ markers
headers = { "Authorization" = "Bearer @@secret:api_key@@" }
body = "body/payload.json.tmpl"      # optional; rendered through the template engine
timeout_ms = 5000                    # optional; default 5000
retry = { attempts = 2, backoff_ms = 500 }   # optional; default {2, 500}

[requires]
colors = ["semantic"]                # same shape as templates
```

### Body template syntax

Body templates use the same `{{...}}` engine as config templates with two extra integration-specific functions:

- `{{r(color)}}`, `{{g(color)}}`, `{{b(color)}}` — return the 0-255 RGB component as a JSON-safe integer (great for smart-light APIs that take RGB ints)
- `{{to_json_string(color)}}` — emit a hex color as a JSON-quoted string (e.g., `"#7aa2f7"`)

After templating, `@@secret:<key>@@` markers in the body, headers, and url are substituted with secret values from the keychain. **Secrets never appear in rendered debug copies on disk** — the substitution happens only at HTTP request time.

### Submission requirements

- Use only widely-available APIs that don't require approval beyond a basic developer signup
- Document the setup steps in `metadata.setup_instructions` (multi-line OK)
- Test with at least one real device/account before opening the PR — and mention what you tested in the PR description
- Don't commit secrets, tokens, or device identifiers in any file (use `@@secret:...@@` markers everywhere)

## Contributing a Firefox extension change

1. Fork this repo and create a branch
2. Make your change inside `extensions/firefox/`
3. Open a pull request against `main`
4. A maintainer reviews, tests against a recent Firefox + Zen Browser build, and merges
5. Accepted changes ship in the next AMO (addons.mozilla.org) submission

## Contributing a userstyle or a change to the userstyles system

The `userstyles/` tree has two distinct surfaces — pick the right one:

### Adding a ricekit-native userstyle (new site Catppuccin doesn't theme)

1. Fork this repo and create a branch
2. Add `userstyles/styles/<site-slug>/ricekit.user.less` (or `.user.css`)
3. Write against the `var(--rk-*)` variables the addon sets on `:root` — the full list is in `templates/userstyles/templates/rk-vars.css`
4. Run `cd userstyles && deno task build` and confirm your file shows up in `build/dist/`
5. Open a PR

### Changing the compiler

1. Fork this repo and create a branch
2. Make your change inside `userstyles/src/`
3. Run `cd userstyles && deno task test && deno task build`
4. The build should still report every upstream userstyle compiling (the count is visible on the `userstyles-stats` badge in `userstyles/README.md`)
5. Open a PR

**Do not commit changes under `userstyles/upstream/catppuccin/`.** That directory is a git submodule tracking [catppuccin/userstyles](https://github.com/catppuccin/userstyles); upstream patches belong there, and a daily GitHub Action bumps the pin automatically.

## Contributing to the playground (coming soon)

The `playground/` directory will contain a standalone Vite-built WASM demo app. Contribution flow TBD — tracked in issue [brs98/ricekit#95](https://github.com/brs98/ricekit/issues/95).

## Questions

Open an issue here or cross-reference [brs98/ricekit#78](https://github.com/brs98/ricekit/issues/78).
