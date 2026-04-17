-- Ricekit WezTerm config module
-- Usage: local ricekit = dofile(wezterm.config_dir .. '/ricekit-config.lua')
--        ricekit.apply_to_config(config)
local M = {}

function M.apply_to_config(config)
  config.default_cursor_style = "SteadyBar"
  config.cursor_blink_rate = 500

  config.window_padding = {
    left = "1cell",
    right = "1cell",
    top = "0.5cell",
    bottom = "0.5cell",
  }

  config.window_background_opacity = 0.95
  config.macos_window_background_blur = 20

  config.use_fancy_tab_bar = false
  config.tab_bar_at_bottom = true
  config.hide_tab_bar_if_only_one_tab = true
  config.tab_max_width = 32
  config.show_new_tab_button_in_tab_bar = false

  config.window_frame = {
    font_size = 12.0,
    active_titlebar_bg = "{{darken(background, 5%)}}",
    inactive_titlebar_bg = "{{darken(background, 10%)}}",
  }

  config.command_palette_bg_color = "{{surface}}"
  config.command_palette_fg_color = "{{foreground}}"
end

return M
