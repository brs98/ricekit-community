//! Schema validator for Ricekit community themes and config templates.
//!
//! Enforces the documented spec — does **not** evaluate quality (no contrast
//! ratios, no color theory, no taste calls). Two public entry points:
//!
//! - [`validate_theme_dir`] — validates a `themes/<name>/` directory
//! - [`validate_config_dir`] — validates a `templates/<name>/` directory
//!
//! Both return a [`ValidationReport`]. Callers should check [`ValidationReport::is_ok`]
//! and print the contained errors on failure.
//!
//! # Schema coupling
//!
//! The deserialization types below (`Theme`, `Config`, and their nested structs)
//! **mirror the private-repo `ricekit-core` types by necessity**. Keep in sync
//! when the schema evolves — this is a human discipline gate, not enforced by
//! tooling. Extra fields in submitted TOML are tolerated (serde's default), so
//! additive schema changes in the private repo don't break this validator.

use std::path::Path;
use std::sync::LazyLock;

use anyhow::Result;
use regex::Regex;
use serde::Deserialize;

// ---------------------------------------------------------------------------
// Regexes + const tables
// ---------------------------------------------------------------------------

/// Slug regex for directory names: lowercase, digits, single-hyphens between segments.
static SLUG_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9]+(-[a-z0-9]+)*$").expect("valid regex"));

/// Hex color regex: `#RRGGBB` (6 digits, case-insensitive).
static HEX_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^#[0-9A-Fa-f]{6}$").expect("valid regex"));

/// Known palette variable names (18 ANSI + 8 semantic).
const KNOWN_PALETTE_NAMES: &[&str] = &[
    "foreground",
    "background",
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "bright_black",
    "bright_red",
    "bright_green",
    "bright_yellow",
    "bright_blue",
    "bright_magenta",
    "bright_cyan",
    "bright_white",
    "accent",
    "error",
    "warning",
    "success",
    "info",
    "surface",
    "border",
    "muted",
];

/// Known template function names and their expected argument counts.
const KNOWN_FUNCTIONS: &[(&str, usize)] = &[
    ("darken", 2),
    ("lighten", 2),
    ("alpha", 2),
    ("blend", 3),
    ("contrast", 1),
];

/// Known color requirement sets.
const KNOWN_COLOR_SETS: &[&str] = &["ansi", "semantic"];

/// Supported wallpaper file extensions.
const WALLPAPER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "heic", "webp"];

// ---------------------------------------------------------------------------
// Schema types (duplicated from private-repo `ricekit-core` — keep in sync)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct Theme {
    metadata: ThemeMetadata,
    colors: ThemeColors,
}

#[derive(Deserialize)]
struct ThemeMetadata {
    name: String,
    author: String,
    version: String,
    #[allow(dead_code)]
    variant: ThemeVariant,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum ThemeVariant {
    Dark,
    Light,
}

#[derive(Deserialize)]
struct ThemeColors {
    ansi: AnsiColors,
}

#[derive(Deserialize)]
struct AnsiColors {
    foreground: String,
    background: String,
    black: String,
    red: String,
    green: String,
    yellow: String,
    blue: String,
    magenta: String,
    cyan: String,
    white: String,
    bright_black: String,
    bright_red: String,
    bright_green: String,
    bright_yellow: String,
    bright_blue: String,
    bright_magenta: String,
    bright_cyan: String,
    bright_white: String,
}

#[derive(Deserialize)]
struct Config {
    metadata: ConfigMetadata,
    #[serde(default)]
    target: std::collections::HashMap<String, toml::Value>,
    #[serde(default)]
    requires: ConfigRequires,
}

#[derive(Deserialize)]
struct ConfigMetadata {
    name: String,
    author: String,
    version: String,
    app: String,
    #[allow(dead_code)]
    category: ConfigCategory,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum ConfigCategory {
    Terminal,
    Editor,
    Statusbar,
    Wm,
    System,
    Browser,
}

#[derive(Default, Deserialize)]
struct ConfigRequires {
    #[serde(default)]
    colors: Vec<String>,
}

// ---------------------------------------------------------------------------
// ValidationReport
// ---------------------------------------------------------------------------

/// Result of validating a theme or config directory.
///
/// `kind` is `"theme"` or `"config"`. `errors` is the collected list of
/// human-readable validation errors. Empty errors means the submission passes.
pub struct ValidationReport {
    pub kind: &'static str,
    pub errors: Vec<String>,
}

impl ValidationReport {
    fn new(kind: &'static str) -> Self {
        Self {
            kind,
            errors: Vec::new(),
        }
    }

    fn error(&mut self, msg: impl Into<String>) {
        self.errors.push(msg.into());
    }

    /// Returns true if validation passed (no errors).
    pub fn is_ok(&self) -> bool {
        self.errors.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Theme directory validation
// ---------------------------------------------------------------------------

/// Validate a theme directory.
///
/// Checks: `theme.toml` exists and parses, required metadata is present and
/// non-empty, all 18 ANSI colors are valid hex, directory name is a valid slug,
/// wallpaper files (if present) use supported formats.
pub fn validate_theme_dir(path: &Path) -> Result<ValidationReport> {
    let mut report = ValidationReport::new("theme");

    // 1. theme.toml exists
    let toml_path = path.join("theme.toml");
    if !toml_path.exists() {
        report.error("theme.toml not found");
        return Ok(report);
    }

    // 2. Parses as Theme
    let content = std::fs::read_to_string(&toml_path)?;
    let theme: Theme = match toml::from_str(&content) {
        Ok(t) => t,
        Err(e) => {
            report.error(format!("failed to parse theme.toml: {e}"));
            return Ok(report);
        }
    };

    // 3. Metadata fields non-empty
    if theme.metadata.name.trim().is_empty() {
        report.error("metadata.name is empty");
    }
    if theme.metadata.author.trim().is_empty() {
        report.error("metadata.author is empty");
    }
    if theme.metadata.version.trim().is_empty() {
        report.error("metadata.version is empty");
    }
    // variant is an enum; if parsing succeeded it's valid.

    // 4. All 18 ANSI colors are valid hex
    let ansi = &theme.colors.ansi;
    let ansi_fields: &[(&str, &str)] = &[
        ("foreground", &ansi.foreground),
        ("background", &ansi.background),
        ("black", &ansi.black),
        ("red", &ansi.red),
        ("green", &ansi.green),
        ("yellow", &ansi.yellow),
        ("blue", &ansi.blue),
        ("magenta", &ansi.magenta),
        ("cyan", &ansi.cyan),
        ("white", &ansi.white),
        ("bright_black", &ansi.bright_black),
        ("bright_red", &ansi.bright_red),
        ("bright_green", &ansi.bright_green),
        ("bright_yellow", &ansi.bright_yellow),
        ("bright_blue", &ansi.bright_blue),
        ("bright_magenta", &ansi.bright_magenta),
        ("bright_cyan", &ansi.bright_cyan),
        ("bright_white", &ansi.bright_white),
    ];
    for (name, value) in ansi_fields {
        if !HEX_REGEX.is_match(value) {
            report.error(format!("invalid hex color for {name}: {value}"));
        }
    }

    // 5. Directory name is a valid slug
    if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
        if !SLUG_REGEX.is_match(dir_name) {
            report.error(format!(
                "directory name '{dir_name}' is not a valid slug (must match [a-z0-9]+(-[a-z0-9]+)*)"
            ));
        }
    }

    // 6. Wallpaper extensions are in supported list
    let wallpapers_dir = path.join("wallpapers");
    if wallpapers_dir.exists() && wallpapers_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&wallpapers_dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_file() {
                    let ext = entry_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    if !WALLPAPER_EXTENSIONS.contains(&ext.as_str()) {
                        let fname = entry_path.file_name().unwrap_or_default().to_string_lossy();
                        let supported = WALLPAPER_EXTENSIONS.join(", ");
                        report.error(format!(
                            "unsupported wallpaper format: {fname} (expected {supported})"
                        ));
                    }
                }
            }
        }
    }

    Ok(report)
}

// ---------------------------------------------------------------------------
// Config directory validation
// ---------------------------------------------------------------------------

/// Validate a config template directory.
///
/// Checks: `config.toml` exists and parses, required metadata is present and
/// non-empty, at least one `[target.*]` section, `templates/` dir exists with
/// files, every template expression is well-formed and uses known names,
/// `requires.colors` only contains known sets.
pub fn validate_config_dir(path: &Path) -> Result<ValidationReport> {
    let mut report = ValidationReport::new("config");

    // 1. config.toml exists
    let toml_path = path.join("config.toml");
    if !toml_path.exists() {
        report.error("config.toml not found");
        return Ok(report);
    }

    // 2. Parses as Config
    let content = std::fs::read_to_string(&toml_path)?;
    let config: Config = match toml::from_str(&content) {
        Ok(c) => c,
        Err(e) => {
            report.error(format!("failed to parse config.toml: {e}"));
            return Ok(report);
        }
    };

    // 3. Metadata fields non-empty
    if config.metadata.name.trim().is_empty() {
        report.error("metadata.name is empty");
    }
    if config.metadata.author.trim().is_empty() {
        report.error("metadata.author is empty");
    }
    if config.metadata.version.trim().is_empty() {
        report.error("metadata.version is empty");
    }
    if config.metadata.app.trim().is_empty() {
        report.error("metadata.app is empty");
    }
    // category is an enum — if parsing succeeded it's valid.

    // 4. At least one target
    if config.target.is_empty() {
        report.error("no targets defined (need at least one [target.*] section)");
    }

    // 5. templates/ directory exists and is non-empty
    let templates_dir = path.join("templates");
    if !templates_dir.exists() || !templates_dir.is_dir() {
        report.error("templates/ directory not found");
    } else {
        let file_count = std::fs::read_dir(&templates_dir)?
            .filter_map(std::result::Result::ok)
            .filter(|e| e.path().is_file())
            .count();
        if file_count == 0 {
            report.error("templates/ directory is empty");
        } else {
            // 6. Validate template expressions in each template file
            for entry in std::fs::read_dir(&templates_dir)?.filter_map(std::result::Result::ok) {
                let entry_path = entry.path();
                if entry_path.is_file() {
                    let template_content = std::fs::read_to_string(&entry_path)?;
                    let fname = entry_path.file_name().unwrap_or_default().to_string_lossy();
                    validate_template_expressions(&template_content, &fname, &mut report);
                }
            }
        }
    }

    // 7. requires.colors only contains known sets
    for color_set in &config.requires.colors {
        if !KNOWN_COLOR_SETS.contains(&color_set.as_str()) {
            report.error(format!(
                "unknown color requirement: '{color_set}' (expected 'ansi' or 'semantic')"
            ));
        }
    }

    Ok(report)
}

// ---------------------------------------------------------------------------
// Template expression parsing
// ---------------------------------------------------------------------------

/// Scan a template file's content and validate every `{{...}}` expression.
fn validate_template_expressions(content: &str, filename: &str, report: &mut ValidationReport) {
    let mut remaining = content;

    while let Some(start) = remaining.find("{{") {
        let after_open = &remaining[start + 2..];
        let end = match after_open.find("}}") {
            Some(e) => e,
            None => {
                report.error(format!("{filename}: unclosed {{{{ expression"));
                return;
            }
        };

        let expr = after_open[..end].trim();

        if expr.contains('(') {
            validate_function_call(expr, filename, report);
        } else if !KNOWN_PALETTE_NAMES.contains(&expr) {
            report.error(format!("{filename}: unknown variable '{expr}'"));
        }

        remaining = &after_open[end + 2..];
    }
}

/// Validate a function call expression like `darken(background, 10%)`.
fn validate_function_call(expr: &str, filename: &str, report: &mut ValidationReport) {
    let paren_pos = match expr.find('(') {
        Some(p) => p,
        None => return, // caller already checked presence
    };

    let func_name = expr[..paren_pos].trim();
    let rest = expr[paren_pos + 1..].trim();
    let args_str = match rest.strip_suffix(')') {
        Some(s) => s,
        None => {
            report.error(format!("{filename}: missing closing ')' in: {expr}"));
            return;
        }
    };

    let args: Vec<&str> = args_str.split(',').map(str::trim).collect();

    let expected_args = KNOWN_FUNCTIONS
        .iter()
        .find(|(name, _)| *name == func_name)
        .map(|(_, count)| *count);

    match expected_args {
        None => {
            report.error(format!("{filename}: unknown function '{func_name}'"));
        }
        Some(expected) => {
            if args.len() != expected {
                report.error(format!(
                    "{filename}: {func_name}() expects {expected} argument(s), got {}",
                    args.len()
                ));
            } else {
                // Validate color-typed args reference known palette names.
                match func_name {
                    "darken" | "lighten" | "alpha" | "contrast" => {
                        if !KNOWN_PALETTE_NAMES.contains(&args[0]) {
                            report.error(format!(
                                "{filename}: unknown palette name '{}' in {func_name}()",
                                args[0]
                            ));
                        }
                    }
                    "blend" => {
                        if !KNOWN_PALETTE_NAMES.contains(&args[0]) {
                            report.error(format!(
                                "{filename}: unknown palette name '{}' in {func_name}()",
                                args[0]
                            ));
                        }
                        if !KNOWN_PALETTE_NAMES.contains(&args[1]) {
                            report.error(format!(
                                "{filename}: unknown palette name '{}' in {func_name}()",
                                args[1]
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn valid_theme_toml() -> &'static str {
        r##"[metadata]
name = "Tokyo Night"
author = "enkia"
version = "1.0.0"
variant = "dark"

[colors.ansi]
foreground = "#c0caf5"
background = "#1a1b26"
black = "#15161e"
red = "#f7768e"
green = "#9ece6a"
yellow = "#e0af68"
blue = "#7aa2f7"
magenta = "#bb9af7"
cyan = "#7dcfff"
white = "#a9b1d6"
bright_black = "#414868"
bright_red = "#f7768e"
bright_green = "#9ece6a"
bright_yellow = "#e0af68"
bright_blue = "#7aa2f7"
bright_magenta = "#bb9af7"
bright_cyan = "#7dcfff"
bright_white = "#c0caf5"
"##
    }

    fn valid_config_toml() -> &'static str {
        r##"[metadata]
name = "Alacritty Theme"
author = "ricekit"
version = "1.0.0"
app = "alacritty"
category = "terminal"

[requires]
colors = ["ansi"]

[target.macos]
path = "~/.config/alacritty/colors.toml"
"##
    }

    fn valid_template() -> &'static str {
        r##"[colors.primary]
foreground = "{{foreground}}"
background = "{{background}}"

[colors.bright]
red = "{{bright_red}}"
surface = "{{darken(background, 5%)}}"
blended = "{{blend(foreground, background, 50%)}}"
contrast_fg = "{{contrast(background)}}"
"##
    }

    fn setup_valid_theme_dir() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let theme_dir = tmp.path().join("tokyo-night");
        std::fs::create_dir_all(&theme_dir).unwrap();
        std::fs::write(theme_dir.join("theme.toml"), valid_theme_toml()).unwrap();
        tmp
    }

    fn setup_valid_config_dir() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let config_dir = tmp.path().join("alacritty");
        std::fs::create_dir_all(config_dir.join("templates")).unwrap();
        std::fs::write(config_dir.join("config.toml"), valid_config_toml()).unwrap();
        std::fs::write(
            config_dir.join("templates").join("colors.toml"),
            valid_template(),
        )
        .unwrap();
        tmp
    }

    // ── Theme validation tests ─────────────────────────────────────────────

    #[test]
    fn valid_theme_dir_passes() {
        let tmp = setup_valid_theme_dir();
        let theme_dir = tmp.path().join("tokyo-night");
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(report.is_ok(), "expected no errors, got {:?}", report.errors);
    }

    #[test]
    fn missing_theme_toml_error() {
        let tmp = TempDir::new().unwrap();
        let theme_dir = tmp.path().join("empty");
        std::fs::create_dir_all(&theme_dir).unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("theme.toml not found")));
    }

    #[test]
    fn invalid_theme_toml_parse_error() {
        let tmp = TempDir::new().unwrap();
        let theme_dir = tmp.path().join("broken");
        std::fs::create_dir_all(&theme_dir).unwrap();
        std::fs::write(theme_dir.join("theme.toml"), "this is not = valid [toml").unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("failed to parse")));
    }

    #[test]
    fn empty_metadata_fields_error() {
        let tmp = TempDir::new().unwrap();
        let theme_dir = tmp.path().join("empty-meta");
        std::fs::create_dir_all(&theme_dir).unwrap();
        let toml = r##"[metadata]
name = ""
author = ""
version = ""
variant = "dark"

[colors.ansi]
foreground = "#ffffff"
background = "#000000"
black = "#000000"
red = "#ff0000"
green = "#00ff00"
yellow = "#ffff00"
blue = "#0000ff"
magenta = "#ff00ff"
cyan = "#00ffff"
white = "#ffffff"
bright_black = "#808080"
bright_red = "#ff8080"
bright_green = "#80ff80"
bright_yellow = "#ffff80"
bright_blue = "#8080ff"
bright_magenta = "#ff80ff"
bright_cyan = "#80ffff"
bright_white = "#ffffff"
"##;
        std::fs::write(theme_dir.join("theme.toml"), toml).unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("metadata.name is empty")));
        assert!(report.errors.iter().any(|e| e.contains("metadata.author is empty")));
        assert!(report.errors.iter().any(|e| e.contains("metadata.version is empty")));
    }

    #[test]
    fn invalid_hex_error() {
        let tmp = TempDir::new().unwrap();
        let theme_dir = tmp.path().join("bad-hex");
        std::fs::create_dir_all(&theme_dir).unwrap();
        let toml = r##"[metadata]
name = "Bad"
author = "x"
version = "1"
variant = "dark"

[colors.ansi]
foreground = "not-a-hex"
background = "#000000"
black = "#000000"
red = "#ff0000"
green = "#00ff00"
yellow = "#ffff00"
blue = "#0000ff"
magenta = "#ff00ff"
cyan = "#00ffff"
white = "#ffffff"
bright_black = "#808080"
bright_red = "#ff8080"
bright_green = "#80ff80"
bright_yellow = "#ffff80"
bright_blue = "#8080ff"
bright_magenta = "#ff80ff"
bright_cyan = "#80ffff"
bright_white = "#ffffff"
"##;
        std::fs::write(theme_dir.join("theme.toml"), toml).unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("invalid hex color for foreground")));
    }

    #[test]
    fn bad_slug_error() {
        let tmp = TempDir::new().unwrap();
        let theme_dir = tmp.path().join("Bad_Slug");
        std::fs::create_dir_all(&theme_dir).unwrap();
        std::fs::write(theme_dir.join("theme.toml"), valid_theme_toml()).unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("not a valid slug")));
    }

    #[test]
    fn valid_slug_passes() {
        let tmp = TempDir::new().unwrap();
        let theme_dir = tmp.path().join("tokyo-night-storm");
        std::fs::create_dir_all(&theme_dir).unwrap();
        std::fs::write(theme_dir.join("theme.toml"), valid_theme_toml()).unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(report.is_ok(), "got {:?}", report.errors);
    }

    #[test]
    fn invalid_wallpaper_extension_error() {
        let tmp = setup_valid_theme_dir();
        let theme_dir = tmp.path().join("tokyo-night");
        std::fs::create_dir_all(theme_dir.join("wallpapers")).unwrap();
        std::fs::write(theme_dir.join("wallpapers").join("bad.bmp"), []).unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("unsupported wallpaper format")));
    }

    #[test]
    fn supported_wallpaper_extensions_pass() {
        let tmp = setup_valid_theme_dir();
        let theme_dir = tmp.path().join("tokyo-night");
        std::fs::create_dir_all(theme_dir.join("wallpapers")).unwrap();
        for ext in &["png", "jpg", "jpeg", "webp"] {
            std::fs::write(theme_dir.join("wallpapers").join(format!("wp.{ext}")), []).unwrap();
        }
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(report.is_ok(), "got {:?}", report.errors);
    }

    #[test]
    fn heic_wallpaper_no_error() {
        let tmp = setup_valid_theme_dir();
        let theme_dir = tmp.path().join("tokyo-night");
        std::fs::create_dir_all(theme_dir.join("wallpapers")).unwrap();
        std::fs::write(theme_dir.join("wallpapers").join("wp.heic"), []).unwrap();
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert!(report.is_ok(), "got {:?}", report.errors);
    }

    // ── Config validation tests ────────────────────────────────────────────

    #[test]
    fn valid_config_dir_passes() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(report.is_ok(), "got {:?}", report.errors);
    }

    #[test]
    fn missing_config_toml_error() {
        let tmp = TempDir::new().unwrap();
        let config_dir = tmp.path().join("empty");
        std::fs::create_dir_all(&config_dir).unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("config.toml not found")));
    }

    #[test]
    fn no_targets_error() {
        let tmp = TempDir::new().unwrap();
        let config_dir = tmp.path().join("no-target");
        std::fs::create_dir_all(config_dir.join("templates")).unwrap();
        let toml = r##"[metadata]
name = "no targets"
author = "x"
version = "1"
app = "x"
category = "terminal"

[requires]
colors = ["ansi"]
"##;
        std::fs::write(config_dir.join("config.toml"), toml).unwrap();
        std::fs::write(config_dir.join("templates").join("t.toml"), "").unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("no targets defined")));
    }

    #[test]
    fn missing_templates_dir_error() {
        let tmp = TempDir::new().unwrap();
        let config_dir = tmp.path().join("no-templates");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(config_dir.join("config.toml"), valid_config_toml()).unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("templates/ directory not found")));
    }

    #[test]
    fn empty_templates_dir_error() {
        let tmp = TempDir::new().unwrap();
        let config_dir = tmp.path().join("empty-templates");
        std::fs::create_dir_all(config_dir.join("templates")).unwrap();
        std::fs::write(config_dir.join("config.toml"), valid_config_toml()).unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("templates/ directory is empty")));
    }

    #[test]
    fn unknown_template_variable_error() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        std::fs::write(
            config_dir.join("templates").join("bad.toml"),
            r##"x = "{{unknown_color}}""##,
        )
        .unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("unknown variable 'unknown_color'")));
    }

    #[test]
    fn unknown_function_error() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        std::fs::write(
            config_dir.join("templates").join("bad.toml"),
            r##"x = "{{invert(foreground)}}""##,
        )
        .unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("unknown function 'invert'")));
    }

    #[test]
    fn wrong_arg_count_error() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        std::fs::write(
            config_dir.join("templates").join("bad.toml"),
            r##"x = "{{darken(foreground)}}""##,
        )
        .unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("darken() expects 2 argument(s)")));
    }

    #[test]
    fn unknown_palette_in_function_error() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        std::fs::write(
            config_dir.join("templates").join("bad.toml"),
            r##"x = "{{darken(typo_color, 10%)}}""##,
        )
        .unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("unknown palette name 'typo_color'")));
    }

    #[test]
    fn valid_expressions_pass() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(report.is_ok(), "got {:?}", report.errors);
    }

    #[test]
    fn unknown_color_set_error() {
        let tmp = TempDir::new().unwrap();
        let config_dir = tmp.path().join("bad-set");
        std::fs::create_dir_all(config_dir.join("templates")).unwrap();
        let toml = r##"[metadata]
name = "x"
author = "x"
version = "1"
app = "x"
category = "terminal"

[requires]
colors = ["mystery"]

[target.macos]
path = "~/.config/x"
"##;
        std::fs::write(config_dir.join("config.toml"), toml).unwrap();
        std::fs::write(config_dir.join("templates").join("t.toml"), "").unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("unknown color requirement: 'mystery'")));
    }

    #[test]
    fn unclosed_expression_error() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        std::fs::write(
            config_dir.join("templates").join("bad.toml"),
            r##"x = "{{foreground""##,
        )
        .unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("unclosed {{ expression")));
    }

    #[test]
    fn blend_unknown_second_color_error() {
        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        std::fs::write(
            config_dir.join("templates").join("bad.toml"),
            r##"x = "{{blend(foreground, typo_color, 50%)}}""##,
        )
        .unwrap();
        let report = validate_config_dir(&config_dir).unwrap();
        assert!(!report.is_ok());
        assert!(report.errors.iter().any(|e| e.contains("unknown palette name 'typo_color'")));
    }

    #[test]
    fn report_kind_is_set() {
        let tmp = setup_valid_theme_dir();
        let theme_dir = tmp.path().join("tokyo-night");
        let report = validate_theme_dir(&theme_dir).unwrap();
        assert_eq!(report.kind, "theme");

        let tmp = setup_valid_config_dir();
        let config_dir = tmp.path().join("alacritty");
        let report = validate_config_dir(&config_dir).unwrap();
        assert_eq!(report.kind, "config");
    }
}
