<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://github.com/FelixKratz/JankyBorders" rel="noreferrer noopener" target="_blank">JankyBorders</a></h2>
</div>

### Usage

JankyBorders must be installed:

```bash
brew install FelixKratz/formulae/borders
```

If using AeroSpace, add to your `aerospace.toml`:

```toml
after-startup-command = [
  'exec-and-forget source ~/.config/borders/borders.sh'
]
```

Otherwise, source this script from your shell profile or WM startup.
