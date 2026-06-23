# ricekit-community/userstyles

![upstream compiling](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fbrs98%2Fricekit-community%2Fmain%2F.github%2Fbadges%2Fuserstyles-upstream.json)
![custom userstyles](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fbrs98%2Fricekit-community%2Fmain%2F.github%2Fbadges%2Fuserstyles-custom.json)

Build tooling that compiles upstream Catppuccin userstyles into a Stylus-importable bundle consuming ricekit's `--rk-*` CSS variables.

## What this directory does

Every Catppuccin userstyle is transformed at build time:
- LESS palette vars (`@text`, `@red`, `@mauve`) → `var(--rk-foreground)`, `var(--rk-red)`, `var(--rk-accent)` (full table below)
- LESS color math (`fade(@accent, 30%)`, `lighten(@surface0, 5%)`) → CSS relative colors (`rgb(from var(--rk-accent) r g b / 0.3)`, `hsl(from var(--rk-surface0) h s calc(l + 5))`)
- Stylus `@preprocessor less` directive stripped so Stylus treats the payload as plain CSS

Result: `build/import.json`, a Stylus bulk-import bundle. Every rule references `var(--rk-*)` — the `:root` block that defines those variables is rendered by ricekit main (see the `userstyles` config template) and live-reloaded by the ricekit Firefox addon.

### Catppuccin → ricekit mapping

ANSI-direct (from Catppuccin's style guide, `docs/style-guide.md §ANSI Color Generation`):

| Catppuccin | `--rk-*` | | Catppuccin | `--rk-*` |
|---|---|---|---|---|
| `@red`, `@green`, `@yellow`, `@blue` | same name | | `@surface1` | `--rk-black` |
| `@pink` | `--rk-magenta` | | `@surface2` | `--rk-bright-black` |
| `@teal` | `--rk-cyan` | | `@subtext0` | `--rk-white` |
| | | | `@subtext1` | `--rk-bright-white` |

Semantic direct: `@text` → `--rk-foreground`, `@base` → `--rk-background`, `@accent` / `@mauve` → `--rk-accent`.

OKLCH-derived at `:root` (tracks the theme): `@surface0`, `@mantle`, `@crust`, `@overlay0/1/2`, `@maroon`, `@flamingo`, `@rosewater`, `@peach`, `@sapphire`, `@sky`, `@lavender`.

## Layout

```
userstyles/
├── upstream/catppuccin/      git submodule → catppuccin/userstyles
├── src/
│   ├── compile.ts            LESS → CSS transformer (palette + math rewrite)
│   ├── rewrite-less.ts       AST rewriter for value expressions
│   ├── build.ts              compile every upstream userstyle
│   ├── generate-import.ts    produce Stylus bulk-import JSON
│   └── ...                   dev helpers (try-compile, pinpoint, dump-rewritten)
├── styles/                   ricekit-native userstyles (non-catppuccin)
├── build/                    (gitignored) compiled .user.css + import.json
└── deno.json                 tasks: build, test
```

## Usage

```bash
deno task build
# produces build/import.json
#
# Stylus → Manage → Backup (↕) → Import → build/import.json
```

Runtime live-reload (pushing fresh `:root` values on every `ricekit apply`) is owned by ricekit main: run `ricekit browser setup` to install the addon + native-messaging host. The addon ships the `userstyles` config that renders `~/.config/ricekit/active/userstyles/rk-vars.css`, which the host hot-reloads into every document.

## Auto-update

Every compiled `.user.css` is stamped at build time with:

- `@updateURL` → `https://raw.githubusercontent.com/brs98/ricekit-community/main/userstyles/build/dist/<site>.user.css`
- `@version` → `{upstream-version}.{YYYYMMDDHHMM}` (UTC)

Stylus polls `@updateURL` every 24 hours (configurable per user) and refreshes installed styles when it sees a newer `@version`. The daily `bump-userstyles-upstream` workflow rebuilds `build/` as part of each upstream bump PR. Styles whose compiled output is unchanged keep their existing `@version`, so Stylus only refreshes files that actually changed upstream.

If you edit `src/compile.ts` / `src/rewrite-less.ts` / `src/rewrite-meta.ts`, run `deno task build` and commit the result alongside your source change. The `check-userstyles-build` CI workflow enforces this on every PR.

## Keeping upstream in sync

The Catppuccin userstyles repo lives at `upstream/catppuccin/` as a git submodule, pinned to a specific commit. A daily GitHub Action (`.github/workflows/bump-userstyles-upstream.yml`) opens a PR when upstream has new commits — the PR runs the full build so we catch any breakage introduced by new LESS idioms before merging.

To bump manually:

```bash
git submodule update --remote userstyles/upstream/catppuccin
git add userstyles/upstream/catppuccin
git commit -m "chore(userstyles): bump upstream catppuccin"
```

## Adding a ricekit-native userstyle

Drop `styles/<site-slug>/ricekit.user.less` (or `.user.css`). The build loop picks it up automatically and includes it in `build/import.json`. These aren't transformed the way Catppuccin userstyles are — write them directly against the `--rk-*` variables ricekit installs at `:root`.

## Status

Compile and custom-userstyle counts are surfaced by the badges at the top of this README. The `userstyles-stats` workflow refreshes them on every push to main that touches `userstyles/`.

**Platform**: Firefox (tested) and Zen Browser (manifest registered, untested). Chromium has no equivalent to `nsIStyleSheetService`; support would need a different architecture.
