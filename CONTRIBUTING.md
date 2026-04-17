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
5. Open a pull request against `main`
6. A maintainer reviews, test-loads the template locally, and merges
7. Accepted templates ship in the next `content-v*` release tarball

Template syntax: `{{variable}}` substitution plus `{{function(args)}}` color operations (`darken`, `lighten`, `alpha`, `blend`, `contrast`). Ricekit provides 26 palette variables at render time. The release workflow does a basic TOML parse-check before shipping.

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
