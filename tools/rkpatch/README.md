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

1. Drop a TOML at `configs/<name>.toml`. Required keys:

   ```toml
   app_path = "/Applications/Foo.app"
   bundle_id = "com.foo"
   asar_candidates = ["Contents/Resources/app.asar"]
   template = "foo-desktop"
   inject_file = "ricekit-inject.js"
   ```

2. Optional: list `[[substitutions]]` blocks to splice file contents into
   placeholders inside the inject payload before injection. `encode = "json"`
   wraps the contents in `JSON.stringify` so quoting/escaping is safe; `raw`
   inlines verbatim.

3. Run `rkpatch <name> status` to verify resolution.
