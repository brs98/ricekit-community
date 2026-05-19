<img align="center" src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" /><br />
<h2 align="center">Ricekit for <a href="https://starship.rs" rel="noreferrer noopener" target="_blank">Starship</a></h2>

### Usage

Add to your `starship.toml`:

```toml
palette = "ricekit"
```

Then use palette color names in your format strings:

```toml
[character]
success_symbol = "[❯](accent)"
error_symbol = "[❯](error)"
```

Ricekit will manage the `[palettes.ricekit]` section automatically.
