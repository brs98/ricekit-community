<div align="center">
<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/assets/ricekit.png" width="100" alt="logo" />
<h2>Ricekit for <a href="https://wezterm.org" rel="noreferrer noopener" target="_blank">WezTerm</a></h2>

<img src="https://raw.githubusercontent.com/brs98/ricekit-community/main/templates/wezterm-colors/preview.png" />
</div>

### Usage

Add to your `.wezterm.lua`:

```lua
local ricekit = dofile(wezterm.config_dir .. '/ricekit-colors.lua')
ricekit.add_to_config_reload_watch_list(config)
```
