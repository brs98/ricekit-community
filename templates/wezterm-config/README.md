<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://wezterm.org" rel="noreferrer noopener" target="_blank">WezTerm</a></h2>
</div>

### Usage

WezTerm UI and appearance settings as an importable module. Add to your `.wezterm.lua`:

```lua
local ricekit_config = dofile(wezterm.config_dir .. '/ricekit-config.lua')
ricekit_config.apply_to_config(config)
```
