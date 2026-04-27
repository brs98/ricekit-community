# rkpatch

Single binary that patches Electron apps with ricekit injections. Replaces the
per-template `patch.mjs` scripts.

## Usage

```bash
rkpatch <app> <command>
# e.g.
rkpatch linear status
rkpatch linear install
rkpatch slack install
rkpatch linear restore
```

`<app>` matches a config file under `configs/` (e.g. `linear` →
`configs/linear.toml`). `<command>` is `status`, `install`, or `restore`.

## Platform support

| OS    | Status     | Notes                                                                 |
| ----- | ---------- | --------------------------------------------------------------------- |
| macOS | Full       | Re-signs the bundle and updates the `Info.plist` integrity manifest.  |
| Linux | Best-effort | No re-sign step; ASAR integrity manifest update is a no-op (see below). |
| Windows | Not yet  | Future work.                                                          |

### Linux caveats

- **ASAR integrity** — On Linux, Electron enforces ASAR integrity via the
  `embeddedAsarIntegrityValidation` fuse compiled into the binary, not via a
  filesystem manifest like macOS's `Info.plist`. rkpatch can't update that
  fuse without binary patching, so we don't try. Most upstream Linux Electron
  builds ship with the fuse off and load a modified asar fine; if a build does
  enforce it, the app will fail to launch with a hash-mismatch error and you'll
  need to run that app's macOS build (or wait for a future fuse-aware
  workflow).
- **Permissions** — Most Linux Electron apps install under `/usr/lib/<app>` or
  `/opt/<app>`, which are root-owned. Run with `sudo -E rkpatch …` so the
  backup directory still resolves to your user's `~/.config`; without `-E`,
  HOME points at `/root` and you'll have orphaned backups.
- **Snap / Flatpak** — Snap installs live on a read-only squashfs and aren't
  supported. Flatpak isn't supported either; both packaging methods need a
  different approach.

### macOS caveats

If the app's bundle in `/Applications` is root-owned, prefix with `sudo`.

## Build

```bash
cd tools/rkpatch
cargo build --release
# binary at target/release/rkpatch — add to PATH for dev use
```

## How it resolves paths

- **Config dir** — `--configs <dir>`, then `$RKPATCH_CONFIGS`, then the
  `configs/` directory baked in at compile time (i.e. this repo's
  `tools/rkpatch/configs/`).
- **Template dir** — `--templates <dir>`, then `$RKPATCH_TEMPLATE_DIR`, then
  `~/.config/ricekit/custom-configs/`. The template-specific files
  (`ricekit-inject.js`, `ricekit-theme.user.js`, …) are read from
  `<template_base>/<template>/`, where `template` is set in the per-app config.

For dev against the in-repo template sources, point `--templates` at
`<repo>/templates`.

## Adding a new app

Per-OS values live under `[macos]` / `[linux]` sub-tables. Shared identity
(`bundle_id`, `template`, `inject_file`, substitutions) lives at the top.

```toml
bundle_id = "com.foo"
template = "foo-desktop"
inject_file = "ricekit-inject.js"

[[substitutions]]
placeholder = "__RICEKIT_THEME_JS__"
file = "ricekit-theme.user.js"
encode = "json"

[macos]
app_path = "/Applications/Foo.app"
asar_candidates = ["Contents/Resources/app.asar"]

[linux]
# First existing path wins. Use this for packagings that vary by distro.
app_path_candidates = ["/usr/lib/foo", "/opt/foo"]
asar_candidates = ["resources/app.asar"]
process_name = "foo"          # used by pgrep/pkill
display_name = "Foo"          # shown in UI strings
# Optional. Defaults to `<app_path>/<process_name>`.
# launch_command = ["/usr/lib/foo/foo"]
```

Configs that still use the original flat top-level shape (no `[macos]` table)
are treated as macOS-only — the loader synthesizes a `[macos]` section from
them. New configs should use sub-tables.

`encode = "json"` wraps the substitution contents in `JSON.stringify` so
quoting/escaping is safe; `raw` inlines verbatim.

After dropping in a config, run `rkpatch <name> status` to verify resolution.
