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
rkpatch linear prune       # delete backups for older app versions
```

`<app>` matches a config file under `configs/` (e.g. `linear` →
`configs/linear.toml`). `<command>` is `status`, `install`, `restore`, or
`prune`.

`prune` keeps the backup directory for the currently-installed app version
and deletes the rest. Useful after an app self-updates: the old version's
backup becomes orphaned (you can no longer `restore` to it because the asar
on disk is from the new version).

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

- **Sequoia (15) and later — AMFI launch provenance.** The first time you
  patch an app whose bundle is still under its original Apple-issued
  signature, the kernel refuses in-place writes to files inside the bundle
  (even for root, even after `xattr -d com.apple.provenance`). rkpatch
  detects this with a write-mode probe on the asar; on EPERM it copies the
  bundle to a same-volume staging directory next to it
  (`.rkpatch-staging-<pid>/`), patches the copy, and atomically swaps it
  into place. Once the bundle has been ad-hoc resigned, AMFI no longer
  engages and subsequent runs patch in place. You'll see a "macOS is
  blocking in-place edits — relocating to staging" notice in the install
  output the first time.
- **Bundle ownership.** If the app's bundle in `/Applications` is
  root-owned, prefix with `sudo`. The relocate path doesn't help with this
  — that's a filesystem permission issue, not an AMFI one.

## Install

```bash
cd tools/rkpatch
cargo install --path .
# binary at ~/.cargo/bin/rkpatch (assumes that's on your PATH)
```

## How it resolves paths

- **Config dir** — `--configs <dir>`, then `$RKPATCH_CONFIGS`, then the
  `configs/` directory baked in at compile time (i.e. this repo's
  `tools/rkpatch/configs/`).
- **Template dir** — `--templates <dir>`, then `$RKPATCH_TEMPLATE_DIR`, then
  the first of `~/.config/ricekit/custom-configs/` and
  `~/.config/ricekit/installed-configs/` that contains the template named
  in the per-app config. The template-specific files
  (`ricekit-inject.js`, `ricekit-theme.user.js`, …) are read from
  `<template_base>/<template>/`. The dual default lets templates fetched
  from Ricekit's marketplace (which lands them in `installed-configs/`) and
  hand-rolled ones (in `custom-configs/`) both work without a flag.

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
