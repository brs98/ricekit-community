# ricekit-community

Community-contributed content for [Ricekit](https://github.com/brs98/ricekit) — a macOS desktop customization toolkit that applies color palettes across terminal emulators, editors, status bars, and other apps via config templates.

## What lives here

This repo is the public home for all community-contributable Ricekit content. The main Ricekit application (CLI, Tauri desktop app, Rust core) is a closed-source commercial product; the content below is open and PR-able by anyone.

| Directory | Status | What it is |
| --- | --- | --- |
| `extensions/firefox/` | Accepting PRs | Firefox / Zen Browser extension source |
| `themes/` | Accepting PRs | Bundled theme definitions (TOML + optional wallpapers) |
| `templates/` | Accepting PRs | Config templates (terminal emulators, editors, status bars, etc.) |
| `playground/` | Upcoming | Vite-built WASM web playground for previewing themes |

The main Ricekit app fetches `themes/` and `templates/` at runtime from this repo's tagged release tarballs (`content-v*`), with a minimal snapshot embedded in the binary as an offline fallback. Each release produces `ricekit-content-v{N}.tar.gz`, a matching `.sha256` checksum file, and a `manifest.json` listing the included content.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to submit a new theme, config template, or browser-extension change.

## License

See individual `LICENSE` files under each top-level directory. Content contributed to this repo is licensed under the terms stated in the directory it lives in.
