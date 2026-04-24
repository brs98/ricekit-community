# Linear + Slack theme harvesters

Linear and Slack both use emotion/styled-components with **hashed class names** (`.sc-abcdef`, `.c-icon__file__xyz`, `.theme-provider-<sha>`, etc.). Those hashes change on each production build, so the generated portion of `userstyles/styles/{linear,slack}/ricekit.css` is tied to a specific app version.

When Linear or Slack ship a new build and the userstyle starts under-covering the UI, re-run the matching harvester and paste the output back into the userstyle source.

## Linear

1. Open [linear.app](https://linear.app) in Chrome while logged in.
2. Open DevTools → Console.
3. Paste the contents of [`harvest-linear.js`](./harvest-linear.js) and press Enter.
4. Full CSS is copied to the clipboard and logged.
5. Replace the contents of `userstyles/styles/linear/ricekit.css` with the clipboard, then `cd userstyles && deno task build`.

The harvester crawls both `document.styleSheets` and `document.adoptedStyleSheets` (the `theme-provider-*` adopted sheet holds Linear's entire `--sx-*` → lch() color table). Every `lch(L C H)` value is mapped to a ricekit palette var based on lightness + hue buckets.

## Slack

1. Open [app.slack.com](https://app.slack.com) in Chrome while logged in, with **dark theme enabled** (Slack → Preferences → Themes → Dark).
2. Open DevTools → Console.
3. Paste the contents of [`harvest-slack.js`](./harvest-slack.js) and press Enter.
4. Full CSS is copied to the clipboard and logged.
5. Replace the contents of `userstyles/styles/slack/ricekit.css` with the clipboard, then `cd userstyles && deno task build`.

The harvester produces three layered blocks:

- `--sk_*` RGB-tuple overrides (Slack wraps these in `rgba(var(--sk_X), 1)`).
- `:root` + `.sk-client-theme--dark` semantic tokens (`--dt_color-base-pry`, `--dt_color-content-pry`, etc.) mapped by **name** — tertiary surfaces map to crust, primary content to foreground, and so on.
- Literal hex/rgb overrides for Slack's decorative and non-var rules, with a skip list for emoji/filetype/brand/animation assets.

Box-shadow rules are scanned separately so focus rings and drop shadows pick up palette vars instead of solid black/white.

## Why not automate this?

Userstyles can't run JavaScript at load time, and neither app exposes a single "theme-json" surface that covers the whole UI. The harvesters run once per Linear/Slack release and bake a fresh snapshot into the source file. It's a manual step, but it's the only way to give a pure-CSS userstyle full coverage.
