# Slack Desktop Ricekit Injection

Slack uses emotion/styled-components with hashed class names that rotate on
every production build, so a static stylesheet goes stale within a release.
`ricekit-theme.user.js` walks Slack's `document.styleSheets` at runtime,
classifies each declaration (`--sk_*` token, `--dt_color-plt-*` token, literal
hex/rgb, box-shadow), and emits palette-driven overrides into a singleton
`<style id="ricekit-slack">` tag. A `MutationObserver` re-runs the harvest when
Slack lazy-loads chunks (emoji picker, huddle UI, etc.), and a 1-second
palette poll re-runs it when `--rk-*` on `:root` changes.

Only `ricekit-vars.css` is injected via `webContents.insertCSS` — it sets the
`--rk-*` custom properties on `:root` so the userscript has palette colors to
read. There is no fallback CSS; the userscript is the entire theming surface.

The same `ricekit-theme.user.js` is also distributed as a Tampermonkey
userscript for users who run Slack in a regular browser tab — drop it into
Tampermonkey, no extra config.

## Setup

Patching is handled by the `rkpatch` binary in this repo. Build and install
it once:

```bash
cd tools/rkpatch && cargo install --path .
# binary lands at ~/.cargo/bin/rkpatch — make sure that's on PATH
```

Then enable the `slack-desktop` template in Ricekit and apply your theme so
`~/.config/ricekit/active/slack-desktop/ricekit-vars.css` exists. After that:

```bash
rkpatch slack status
rkpatch slack install
```

That's it for the common case. Two notes:

- **macOS Sequoia (15) and later:** the first `install` against a fresh
  Apple-notarized Slack will print a "macOS is blocking in-place edits —
  relocating to staging" notice. That's the AMFI fallback — rkpatch copies
  the bundle to a same-volume staging dir, patches the copy, and atomically
  swaps it into `/Applications`. Subsequent runs go in place. See
  `tools/rkpatch/README.md` for the full mechanism.
- **Permission errors:** if `install` fails with a filesystem permission
  error (root-owned `/Applications/Slack.app`, IT-managed machine), retry
  with `sudo rkpatch slack install`.

`rkpatch slack install` reads `ricekit-theme.user.js`, embeds its content as a
JSON-stringified literal into `ricekit-inject.js` (substituting the
`__RICEKIT_THEME_JS__` placeholder declared in `tools/rkpatch/configs/slack.toml`),
and writes the combined payload into Slack's asar — `app-arm64.asar` and/or
`app-x64.asar` for universal-binary downloads, or `app.asar` for per-arch
downloads. At runtime the injector calls `frame.executeJavaScript` with the
embedded script on every `frame-created` event so the userscript runs before
Slack's bundle adds its own stylesheets.

## Recovery

```bash
rkpatch slack restore
```

## Tampermonkey usage

For browser-tab Slack, install `ricekit-theme.user.js` in Tampermonkey
unchanged. The `@match https://app.slack.com/*` rule scopes it correctly. A
global ricekit Stylus userstyle that sets `--rk-*` on `:root` for
`app.slack.com` is required so the userscript has colors to read.

## Transparency preservation

The harvester deliberately keeps Slack's intended alpha rather than baking
opaque palette colors over translucent surfaces. The literal-color mapper
splits incoming `rgba()` / hex by intent:

- `rgba(0,0,0,α<1)` (intended-darken overlay) → `color-mix(in oklch, var(--rk-crust) α%, transparent)`
- `rgba(255,255,255,α<1)` (intended-lift overlay) → `color-mix(in oklch, var(--rk-foreground) α%, transparent)`
- `rgba(<chromatic>, α<1)` → `color-mix(in oklch, var(--rk-<hue>) α%, transparent)`
- `rgba(<neutral>, α<1)` → mix of the lightness-band fallback at α
- `rgba(*, 1)` → opaque palette pick by lightness band (no inversion — input is already dark)
- `rgba(0,0,0,0)` → not emitted

Token-driven rewrites use `rgb(from var(--rk-Y) r g b / α)` to keep Slack's
exact alpha while sourcing the color from the active palette.

A small hand-written `core` block lands LAST in the emitted stylesheet so
explicit rules for `.ReactModal__Overlay`, `.c-popover`, and
`.c-menu__list` win over auto-harvested overrides on the same selectors.

## Theme palette refresh

`ricekit-vars.css` is rendered by Ricekit on every theme change. The injector
watches the file via `fs.watchFile` and re-inserts it into every tracked
`webContents`; the userscript's palette poll picks up the new `--rk-*` values
on its next 1-second tick and re-harvests. No quit/relaunch needed.

## Known side effects

- **Ad-hoc resigning.** The helper runs `codesign --force --deep --sign -`
  after modifying the ASAR. This replaces Slack's original Apple Developer
  signature with an ad-hoc one. Slack's auto-updater may refuse to apply
  delta updates or may silently overwrite the entire app bundle, reverting
  the patch.
- **App updates revert the patch.** Every Slack update replaces
  `/Applications/Slack.app`. Re-run `install` after each update. Run `status`
  periodically to check whether the marker is still present.

## Debugging

The userscript exposes `window.__ricekitSlackTheme` with:

- `state` — `'init' | 'ready' | 'error'`
- `harvestCount`, `lastHarvestMs`, `lastStats` (counts of `sk` / `root` /
  `dark` / `lit` / `shadow` rules emitted, total bytes)
- `lastPaletteHash`
- `errors[]` (per-sheet failures, typically cross-origin)

If Slack ships a build whose stylesheets are entirely cross-origin (none have
been observed, but possible), the harvest will skip those sheets and the
covered area will shrink. Check `errors` in the console.
