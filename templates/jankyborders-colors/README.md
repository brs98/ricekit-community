<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://github.com/FelixKratz/JankyBorders" rel="noreferrer noopener" target="_blank">JankyBorders</a></h2>
</div>

### Install and setup

JankyBorders must be installed:

```bash
brew install FelixKratz/formulae/borders
```

On each theme apply, `borders.sh` resolves the binary from the standard Apple
Silicon and Intel Homebrew paths (then `PATH`). It updates an existing process
without killing it, or starts a new process and waits for a bounded readiness
check. A missing binary, rejected update, early exit, or startup timeout is
reported as an apply error rather than silently succeeding.

No separate setup is required for visible borders. JankyBorders supports
macOS 14 and newer. To start it automatically after login, configure the
upstream `~/.config/borders/bordersrc` and Homebrew service; that optional
persistence setup is not treated as a prerequisite for a successful Rice
apply.

JankyBorders does not require Accessibility permission in its normal mode.
The optional `ax_focus=on` compatibility mode uses the slower Accessibility
API and is only needed for some tools that modify window properties, such as
yabai. The RiceKit configuration does not enable `ax_focus`.

Upstream references: [JankyBorders usage and bordersrc](https://github.com/FelixKratz/JankyBorders#usage)
and the [`ax_focus` option](https://github.com/FelixKratz/JankyBorders/wiki/Man-Page).
