# ricekit-community/userstyles

Live-reloading web-page theming for Ricekit. The moment you run `ricekit apply <theme>`, every open tab re-colours with the new palette — no refresh, no manual step.

## How it works

```
ricekit apply <theme>
        │
        ▼  writes state.toml
┌──────────────────────────────────────────────────────────┐
│  Native messaging host   (src/host.ts, compiled binary)  │
│  - Deno.watchFs on ~/.config/ricekit/state.toml          │
│  - shells out to `ricekit theme show`                    │
│  - maps ricekit palette → 26 Catppuccin tokens           │
│  - emits a fresh :root { --ctp-* } CSS blob              │
└──────────────────────────────┬───────────────────────────┘
                               │ stdio (4-byte LE length + JSON)
                               ▼
┌──────────────────────────────────────────────────────────┐
│  Firefox addon   (addon/)                                │
│  - WebExtension experiment API: sheet.apply(css)         │
│  - nsIStyleSheetService.loadAndRegisterSheet(USER_SHEET) │
│  - global user-origin stylesheet → all docs, all windows │
└──────────────────────────────────────────────────────────┘
                               │
                               ▼  cascades into every page
                     131 transformed Catppuccin userstyles
                     (each references var(--ctp-*) via Stylus)
```

Every Catppuccin userstyle has been transformed at build time:
- LESS palette vars (`@mauve`, `@text`) → `var(--ctp-mauve)`, `var(--ctp-text)`
- LESS color math (`fade(@accent, 30%)`, `lighten(@surface0, 5%)`) → CSS relative colors (`rgb(from var(--ctp-accent) r g b / 0.3)`, `hsl(from var(--ctp-surface0) h s calc(l + 5%))`)
- Stylus `@preprocessor less` directive stripped so Stylus treats the payload as plain CSS

The addon only ever *sets* the 26 `:root` variables; the userstyles do the rest via the cascade.

## Layout

```
userstyles/
├── upstream/catppuccin/      git submodule → catppuccin/userstyles
├── src/
│   ├── compile.ts            LESS → CSS transformer (palette + math rewrite)
│   ├── rewrite-less.ts       AST rewriter for value expressions
│   ├── palette.ts            ricekit palette → Catppuccin tokens
│   ├── build.ts              compile every upstream userstyle
│   ├── generate-import.ts    produce Stylus bulk-import JSON
│   ├── host.ts               native messaging host (pushes CSS to addon)
│   ├── install.ts            compile host binary + register native-messaging manifest
│   └── ...                   dev helpers (try-compile, pinpoint, dump-rewritten)
├── addon/                    Firefox WebExtension + experiment API
│   ├── manifest.json
│   ├── api.js                nsIStyleSheetService wrapper (parent scope)
│   ├── schema.json           experiment API surface
│   └── background.js         native-host bridge
├── styles/                   ricekit-native userstyles (non-catppuccin)
├── build/                    (gitignored) compiled .user.css + import.json
└── deno.json                 tasks: build, install, preview, test
```

## Usage

```bash
# One-time: compile the native host, register messaging manifest, build CSS bundle
deno task install
deno task build

# Load the addon:
#   about:debugging → This Firefox → Load Temporary Add-on → addon/manifest.json
#
# Bulk-install the userstyles in Stylus:
#   Stylus → Manage → Backup (↕) → Import → build/import.json
```

After that, `ricekit apply <any-theme>` instantly re-themes every open tab.

## Keeping upstream in sync

The Catppuccin userstyles repo lives at `upstream/catppuccin/` as a git submodule, pinned to a specific commit. A daily GitHub Action (`.github/workflows/bump-userstyles-upstream.yml`) opens a PR when upstream has new commits — the PR runs the full build so we catch any breakage introduced by new LESS idioms before merging.

To bump manually:

```bash
git submodule update --remote userstyles/upstream/catppuccin
git add userstyles/upstream/catppuccin
git commit -m "chore(userstyles): bump upstream catppuccin"
```

## Adding a ricekit-native userstyle

Drop `styles/<site-slug>/ricekit.user.less` (or `.user.css`). The build loop picks it up automatically and includes it in `build/import.json`. These aren't transformed the way Catppuccin userstyles are — write them directly against `var(--ctp-*)` variables.

## Status

**Build**: 131 of 134 Catppuccin userstyles compile cleanly. Three failures (`canvas-lms`, `lastfm`, `npm`) hit LESS edge cases the transformer doesn't cover yet — they ship as-is and fall through to Catppuccin's hard-coded Mocha defaults.

**Platform**: Firefox (tested) and Zen Browser (manifest registered, untested). Chromium has no equivalent to `nsIStyleSheetService`; support would need a different architecture.
