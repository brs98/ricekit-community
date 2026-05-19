<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" /><br />
<h2 align="center">Ricekit for <a href="https://github.com/nikitabobko/AeroSpace" rel="noreferrer noopener" target="_blank">AeroSpace</a></h2>

### Usage

JankyBorders must be installed:

```bash
brew install FelixKratz/formulae/borders
```

Add to your `.aerospace.toml`:

```toml
after-startup-command = [
  'exec-and-forget source ~/.config/aerospace/ricekit-borders.sh'
]
```

> NOTE: This template conflicts with `jankyborders-colors` — enable one or the other, not both.
