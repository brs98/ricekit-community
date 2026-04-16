# ricekit-community

Community-contributed content for [Ricekit](https://github.com/brs98/ricekit) — a macOS desktop customization toolkit that applies color palettes across terminal emulators, editors, status bars, and other apps via config templates.

## What lives here

This repo is the public home for all community-contributable Ricekit content. The main Ricekit application (CLI, Tauri desktop app, Rust core) is a closed-source commercial product; the content below is open and PR-able by anyone.

| Directory | Status | What it is |
| --- | --- | --- |
| `extensions/firefox/` | Migrated | Firefox / Zen Browser extension source |
| `themes/` | Upcoming | Bundled theme definitions (TOML + optional wallpapers) |
| `templates/` | Upcoming | Config templates (terminal emulators, editors, status bars, etc.) |
| `playground/` | Upcoming | Vite-built WASM web playground for previewing themes |

The main Ricekit app will fetch `themes/` and `templates/` at runtime from this repo's tagged release tarballs, with a minimal snapshot embedded in the binary as an offline fallback.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to submit a new theme, config template, or browser-extension change.

## License

See individual `LICENSE` files under each top-level directory. Content contributed to this repo is licensed under the terms stated in the directory it lives in.
