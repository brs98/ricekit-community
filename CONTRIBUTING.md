# Contributing to ricekit-community

Thanks for wanting to contribute. This repo is the public submission surface for Ricekit — the main app stays closed-source, but everything here is community-owned.

> **Repo status:** this is an active migration from the main Ricekit repo. Right now `extensions/firefox/` and `userstyles/` live here. Theme, template, and playground contribution flows will arrive in upcoming phases — watch issue [brs98/ricekit#78](https://github.com/brs98/ricekit/issues/78) for progress.

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
3. Write against the `var(--ctp-*)` variables the addon sets on `:root` — the full list is in `userstyles/src/palette.ts`
4. Run `cd userstyles && deno task build` and confirm your file shows up in `build/dist/`
5. Open a PR

### Changing the compiler, addon, or host

1. Fork this repo and create a branch
2. Make your change inside `userstyles/src/` or `userstyles/addon/`
3. Run `cd userstyles && deno task test && deno task build`
4. The build should still report 134/134 compiled
5. Open a PR

**Do not commit changes under `userstyles/upstream/catppuccin/`.** That directory is a git submodule tracking [catppuccin/userstyles](https://github.com/catppuccin/userstyles); upstream patches belong there, and a daily GitHub Action bumps the pin automatically.

## Contributing themes or templates (coming soon)

Not yet accepting submissions — the tooling for CI validation and runtime fetching is still being built. When it's ready:

- Themes go in `themes/<your-theme-name>/` with a `theme.toml` + optional wallpapers
- Templates go in `templates/<app-name>/` with a `config.toml` metadata file + template files
- CI runs a public `ricekit-validate` tool against changed directories on every PR
- Once merged, content ships to users in the next tagged release (`ricekit-content-vN`) that the desktop app fetches automatically

## Contributing to the playground (coming soon)

The `playground/` directory will contain a standalone Vite-built WASM demo app. Contribution flow TBD.

## Questions

Open an issue here or cross-reference [brs98/ricekit#78](https://github.com/brs98/ricekit/issues/78).
