-- Ricekit WezTerm colors
-- Usage: config.colors = dofile(os.getenv("HOME") .. "/.config/ricekit/active/wezterm/ricekit-colors.lua")
return {
  foreground = "{{foreground}}",
  background = "{{background}}",
  cursor_bg = "{{accent}}",
  cursor_fg = "{{background}}",
  cursor_border = "{{accent}}",
  selection_bg = "{{blue}}",
  selection_fg = "{{foreground}}",
  scrollbar_thumb = "{{muted}}",
  split = "{{border}}",

  ansi = {
    "{{black}}", "{{red}}", "{{green}}", "{{yellow}}",
    "{{blue}}", "{{magenta}}", "{{cyan}}", "{{white}}",
  },
  brights = {
    "{{bright_black}}", "{{bright_red}}", "{{bright_green}}", "{{bright_yellow}}",
    "{{bright_blue}}", "{{bright_magenta}}", "{{bright_cyan}}", "{{bright_white}}",
  },

  tab_bar = {
    background = "{{darken(background, 5%)}}",
    active_tab = {
      bg_color = "{{surface}}",
      fg_color = "{{foreground}}",
    },
    inactive_tab = {
      bg_color = "{{darken(background, 10%)}}",
      fg_color = "{{muted}}",
    },
    inactive_tab_hover = {
      bg_color = "{{surface}}",
      fg_color = "{{foreground}}",
    },
    new_tab = {
      bg_color = "{{darken(background, 5%)}}",
      fg_color = "{{muted}}",
    },
    new_tab_hover = {
      bg_color = "{{surface}}",
      fg_color = "{{foreground}}",
    },
  },
}
