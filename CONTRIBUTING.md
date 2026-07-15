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
5. Optionally include a preview screenshot — see [Template previews](#template-previews) below
6. Open a pull request against `main`
7. A maintainer reviews, test-loads the template locally, and merges
8. Accepted templates ship in the next `content-v*` release tarball

Template syntax: `{{variable}}` substitution plus `{{function(args)}}` color operations (`darken`, `lighten`, `alpha`, `blend`, `contrast`). Ricekit provides 26 palette variables at render time. The release workflow does a basic TOML parse-check before shipping.

### Template previews

Templates can ship a preview screenshot that the marketplace card displays — a real image of the rendered config in use, so users can see what they're installing before they commit. The intent is "a wezterm window with the config's color treatment applied," not the app's brand mark.

1. Drop the image alongside `config.toml`, e.g. `templates/wezterm-colors/preview.png`. Allowed extensions: `png`, `jpg`, `jpeg`, `webp`, `gif`, `svg`. No subdirectories — the file must live at the top of the template directory.
2. Add a single line to the `[metadata]` block:

   ```toml
   preview = "preview.png"
   ```

   The value is a relative filename inside the template directory; absolute paths, `..` traversal, and symlinks pointing outside the directory are rejected by the desktop app at load time.

3. Recommended shape: a wide screenshot (~1200×800 PNG works well) showing the target app with a recognizable theme applied. The marketplace card crops to a ~16:9 hero ~112px tall, so the top portion of the image is what users see first — frame accordingly.

The image ships in the release tarball alongside `config.toml` — no special workflow handling. Templates without a `preview` field keep working: the marketplace card falls back to a generic placeholder, and the Configs row uses the existing two-letter monogram derived from `app`.

**Sourcing.** Screenshots are easiest to capture yourself — apply the template against any bundled Ricekit theme, take a window screenshot, crop. If you're including an app window with visible content, avoid PII (open files, account names, terminal history with secrets). Don't lift screenshots from third-party blog posts or app stores without confirming the license permits redistribution.

## Authoring a Rice

Rices are maintainer-curated complete looks. Community Rice submissions are not open yet; this contract documents the layout used for first-party curation.

Create one directory per Rice at `rices/<slug>/`:

```text
rices/<slug>/
├── rice.toml
├── screenshots/
│   └── desktop.png
└── wallpapers/
    └── desktop.jpg
```

The manifest uses the same stable slug as its directory and references theme and config slugs shipped in the same content release:

```toml
slug = "focused-terminal"
name = "Focused Terminal"
description = "A distraction-free terminal workspace"
theme = "matte-black"
wallpaper = "wallpapers/desktop.jpg"
configs = ["ghostty-colors", "starship-colors"]
screenshots = ["screenshots/desktop.png"]
```

`slug`, `name`, and `theme` are required. `description`, `wallpaper`, `configs`, and `screenshots` are optional in the app schema, but first-party Rices should include a useful description and at least one representative screenshot. Asset paths must be relative to the Rice directory; absolute paths, `..` traversal, missing files, and escaping symlinks fail release validation. Referenced themes and configs must exist in `themes/` and `templates/` in the same release.

The content release copies the directory unchanged to `rices/<slug>/` in the tarball and adds the slug to the sorted `manifest.json` `rices` array. RiceKit refreshes that payload into its community cache and lists the manifest entry in the marketplace. Installing a Rice materializes its referenced RiceKit theme and config-template dependencies from that same verified release, but leaves those configs inactive until the user explicitly applies the Rice. It never installs applications or integrations, executes setup recipes, or activates configs as a side effect of installation.

Before opening the maintainer PR, run:

```bash
python3 scripts/release_content.py validate --root .
python3 scripts/test_release_content.py
```

### Release contract

Content tags and manifest versions must contain exactly three numeric segments because RiceKit clients select releases with `content-vX.Y.Z`. Native Rice config backends require schema major 2, so current releases use `2.YYYYMMDD.GITHUB_RUN_NUMBER`. Schema-major-1 clients remain pinned to the last compatible v1 release and never download native Rice packages they cannot install safely. A four-part calendar version is not compatible. `scripts/release_content.py build-release` is the only release packager: it validates references, emits the sorted manifest, packs the optional `rices/` root with the existing content roots, writes the checksum, and verifies the resulting archive. Repositories without `rices/` still produce a manifest with `"rices": []`.

Already-shipped v1 clients inspect only GitHub's first 30 releases. The release
workflow therefore fails before a new v2 release would push the newest v1
release out of that window. Do not bypass the guard: prune superseded releases
or publish a separately reviewed, pre-native v1 keepalive from pinned v1
content before continuing.

The pull-request workflow also builds `.github/fixtures/rice-contract/` as a release-format tarball. That fixture is outside the top-level content roots and cannot ship in a production archive. To exercise the real application contract from a checkout of merged `brs98/ricekit` main, run:

```bash
VERSION=2.19700101.1
OUT="$(mktemp -d)"
python3 scripts/release_content.py build-release \
  --root . \
  --output-dir "$OUT" \
  --version "$VERSION" \
  --schema-major 2 \
  --published-at 1970-01-01T00:00:00Z
RICEKIT_COMMUNITY_TARBALL="$OUT/ricekit-content-v$VERSION.tar.gz" \
RICEKIT_COMMUNITY_VERSION="$VERSION" \
cargo test --manifest-path ../ricekit/Cargo.toml \
  -p ricekit-core --test community_refresh \
  real_community_tarball_refresh_install_and_apply_contract -- --ignored --exact
```

This builds and exercises the production archive, including native config targets and every top-level Rice. Run the same final command against the actual release artifact whenever a production `rices/` directory is added or changed; this proves real refresh, list, dependency install, and apply behavior without reimplementing those operations in this repository.

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
category = "..."     # open string; pick from the known list below or coin a new one
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

#### Known categories

The `category` field is an open string — Ricekit accepts any value so new integration shapes don't need a core release to land. The well-known values below sort first in UI and have established conventions:

| Category | Use for |
| --- | --- |
| `lighting` | Smart bulbs, strips, panels (Govee, Hue, LIFX, Nanoleaf) |
| `smarthome` | Scene controllers, hubs, multi-device automations (Home Assistant, HomeKit bridges) |
| `presence` | Status surfaces (Slack status, Discord rich presence, status pages) |
| `audio` | Audio-visual sync targets, spatial-audio room state |

If your integration genuinely doesn't fit any of these, coin a new short kebab-case identifier — but flag it in your PR so we can either standardize or fold it into an existing bucket.

### Body template syntax

Body templates use the same `{{...}}` engine as config templates with these extra integration-specific functions:

- `{{r(color)}}`, `{{g(color)}}`, `{{b(color)}}` — return the 0-255 RGB component as a JSON-safe integer (great for smart-light APIs that take RGB ints, e.g., `{"r": 122, "g": 162, "b": 247}`)
- `{{rgb_int(color)}}` — pack the RGB triple into a single 24-bit integer `(r << 16) | (g << 8) | b`. Govee's v2 API expects this shape for `colorRgb`; many other smart-light cloud APIs do too.
- `{{rgb_int_for(color, @profile)}}` — like `rgb_int` but translates the color through a device color profile first (see [Device color profiles](#device-color-profiles)). `@self` resolves to the integration's own `[device_profile]` block; `@srgb` is identity passthrough (byte-equal to `rgb_int`).
- `{{rgb_for(color, @profile)}}` — same as `rgb_int_for` but emits a `#rrggbb` hex string. Useful for APIs that take hex (Hue) rather than int24 (Govee).
- `{{to_json_string(color)}}` — emit a hex color as a JSON-quoted string (e.g., `"#7aa2f7"`)
- `{{now_millis()}}` — current Unix time in milliseconds. Useful for `requestId` / idempotency-key fields that some APIs require to dedupe replays.

After templating, `@@secret:<key>@@` markers in the body, headers, and url are substituted with secret values from the keychain. **Secrets never appear in rendered debug copies on disk** — the substitution happens only at HTTP request time.

### Device color profiles

Smart-light devices don't share a color space with monitors — a Govee LED strip's `#ff9c91` looks visibly more saturated and brighter than the same hex on a calibrated screen because the LED maps bytes straight to PWM duty cycles without sRGB decoding. An optional `[device_profile]` block on your integration tells Ricekit to translate palette colors through CIE 1931 XYZ before emission so the device output matches what users see on their monitor.

Skeleton (sRGB primaries — adjust for your device after visual-match):

```toml
[device_profile]
red   = { x = 0.6400, y = 0.3300 }
green = { x = 0.3000, y = 0.6000 }
blue  = { x = 0.1500, y = 0.0600 }
white = { x = 0.3127, y = 0.3290 }
transfer = "linear"
```

The bundled `govee-color/integration.toml` ships values calibrated against a Govee H6047 (notably `green = { x = 0.21, y = 0.71 }` rather than sRGB green) — see its inline comment for the calibration session details. Use it as a reference when authoring profiles for adjacent vendors (Hue, LIFX, Nanoleaf), but expect your own device to need its own visual-match pass.

Fields:

- `red`, `green`, `blue` — CIE 1931 chromaticity coordinates of the device's RGB primaries. Use the device datasheet, vendor-published values, or visual-match against a reference monitor. If you don't have measurements, the sRGB primaries above are a reasonable starting point — the largest perceptual win comes from the transfer function, the chromaticities are a refinement on top.
- `white` — chromaticity of the device's reference white. **Must be D65** (`x = 0.3127, y = 0.3290`) in the current Ricekit release. Bradford chromatic adaptation for non-D65 illuminants is a future feature.
- `transfer` — how the device interprets RGB bytes. Three forms accepted:
  - `transfer = "linear"` — bytes map proportionally to LED PWM duty (no gamma). The right choice in our visual-match testing for Govee RGBIC; should also work for most "dumb" LED strips and bulbs that don't advertise color management.
  - `transfer = "srgb"` — the device internally applies sRGB decoding. Rare; usually only displays.
  - `transfer = { kind = "gamma", value = 2.2 }` — fixed-gamma chains, for legacy hardware that documents a specific curve.

The block is optional. Without it, `rgb_int(color)` and `rgb_int_for(color, @srgb)` both emit unmodified palette bytes — fully backward-compatible.

When you reference `@self` in a body template, the manifest **must** declare a `[device_profile]` or the apply will fail with a clear error before any HTTP request fires. Manifest typos (out-of-range chromaticities, collinear primaries, non-D65 white, non-positive gamma) are rejected at install time so they surface during `ricekit integration install`, not partway through a theme apply.

#### Limits of single-profile chromaticity tuning

Chromaticity-only profiles can hit a wall on mid-tone colors that mix all three channels heavily — the matrix changes all output channels in a coupled way, and some hues need *per-channel* scaling (boost red, suppress green, etc.) that no chromaticity choice can express. The bundled `govee-color` profile's calibration session passed three of four test themes no-touch but landed close-enough-not-exact on a mid-saturation cool blue. If your device exhibits the same pattern, the per-channel `compensation` block (saturation/brightness scaling) tracked in [brs98/ricekit#113](https://github.com/brs98/ricekit/issues/113) is the next-needed feature; please file follow-up issues with concrete byte data so we can size the impact.

### Submission requirements

- Use only widely-available APIs that don't require approval beyond a basic developer signup
- Document the setup steps in `metadata.setup_instructions` (multi-line OK)
- Test with at least one real device/account before opening the PR — and mention what you tested in the PR description
- Don't commit secrets, tokens, or device identifiers in any file (use `@@secret:...@@` markers everywhere)

### Testing your integration locally

The community-repo release workflow only runs a TOML parse-check, so the schema authority is the desktop app itself. To round-trip an integration end-to-end before opening the PR:

1. Copy your integration directory into `~/.config/ricekit/custom-integrations/<your-integration>/`
2. Confirm it's discovered:
   ```bash
   ricekit integration list
   ricekit integration info <your-integration>
   ```
3. Store the secrets the manifest declares:
   ```bash
   ricekit secrets set <your-integration> <key>
   ```
   Hit each declared `[secrets]` entry in turn — `secrets list` shows which keys are still missing.
4. Enable it and apply a theme:
   ```bash
   ricekit integration enable <your-integration>
   ricekit apply tokyo-night
   ```
5. Watch the `Integrations:` section of the apply output. Three lines you might see:
   - `✓ <name> 200 (412ms)` — clean success.
   - `⚠ <name> 200 (412ms) → app code 400: Device is offline` — HTTP succeeded but the app reported a failure inside the response body. Ricekit detects common shapes (`{"code": <non-200>, "msg|message": "..."}`) and surfaces them inline. **Make sure your integration's happy path doesn't false-trigger this** — if your API uses a `code` field with non-200 success values, the `⚠` indicator will fire. Either reshape the response (rare, since you don't control the upstream) or document the false-positive in your PR.
   - `✗ <name> [HTTP 503] → ... (after 2 attempts)` — request actually failed, full retry budget exhausted.
6. Try a dry run: `RICEKIT_DRY_RUN=1 ricekit apply tokyo-night`. The integration should show as `dry-run` and no real HTTP call should fire.

The desktop app (`npx --prefix ui tauri dev` from a clone of [brs98/ricekit](https://github.com/brs98/ricekit)) reads from the same `custom-integrations/` directory, so you can sanity-check that the metadata renders cleanly in the UI's integration manager (when that surface lands — Phase 2).

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
