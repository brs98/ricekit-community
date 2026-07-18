<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://github.com/FelixKratz/SketchyBar" rel="noreferrer noopener" target="_blank">SketchyBar</a></h2>
</div>

### Install and setup

Install SketchyBar from its official Homebrew tap:

```bash
brew install FelixKratz/formulae/sketchybar
```

Review and apply the setup shown by RiceKit. On a clean Mac, RiceKit previews
and creates a small visible starter at `~/.config/sketchybar/sketchybarrc`.
If that file already contains a shell or Lua/SbarLua configuration, RiceKit
does not modify it. The setup view instead gives manual instructions for
integrating the generated `~/.config/sketchybar/colors.sh` using the existing
configuration's language.

On each theme apply, RiceKit resolves SketchyBar from the standard Apple
Silicon and Intel Homebrew paths (then `PATH`), starts or reloads it, and waits
for a bounded `sketchybar --query bar` check. Missing binaries, failed reloads,
and an unresponsive bar are reported as apply errors rather than success.

The RiceKit starter uses ordinary items and requires no Screen Recording
permission. SketchyBar's optional `alias` component mirrors items from the
macOS menu bar and does require Screen Recording; grant it only if you add
aliases. No Input Monitoring permission is part of this setup.

Upstream references: [installation](https://felixkratz.github.io/SketchyBar/setup),
[queries](https://felixkratz.github.io/SketchyBar/config/querying), and
[alias permissions](https://felixkratz.github.io/SketchyBar/config/components#item-alias----mirror-items-of-the-original-macos-status-bar-into-sketchybar).
