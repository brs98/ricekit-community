# ricekit-validate

Schema validator for Ricekit community themes and config templates. Enforces the documented structure only — does **not** judge quality (no contrast ratios, no color theory, no taste calls).

## What it checks

### For a theme submission
- `theme.toml` exists and parses
- Required metadata fields (`name`, `author`, `version`, `variant`) are present and non-empty
- All 18 ANSI color fields are valid `#RRGGBB` hex
- Directory name is a valid slug (`[a-z0-9]+(-[a-z0-9]+)*`)
- Wallpaper files (if present) use supported formats (`.png`, `.jpg`, `.jpeg`, `.heic`, `.webp`)

### For a config template submission
- `config.toml` exists and parses
- Required metadata (`name`, `author`, `version`, `app`, `category`) present and non-empty
- At least one `[target.*]` section defined
- `templates/` directory exists and is non-empty
- Every `{{...}}` expression in each template:
  - Is properly closed
  - References a known palette variable (`foreground`, `background`, the 16 ANSI names, the 8 semantic names) or a known function
  - Known functions (`darken`, `lighten`, `alpha`, `blend`, `contrast`) receive the correct number of arguments
  - Color arguments in functions reference known palette variables
- `requires.colors` contains only `ansi` or `semantic`

## Usage

```bash
# Build
cargo build --release

# Validate a theme directory
./target/release/ricekit-validate themes/gruvbox-dark

# Validate a config directory
./target/release/ricekit-validate templates/alacritty-colors

# Exit code: 0 on success, 1 on validation errors, 2 on usage errors
```

## License

MIT — see [LICENSE](./LICENSE).
