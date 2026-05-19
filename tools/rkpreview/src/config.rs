use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

/// Bundled default config — same file maintainers edit at `tools/rkpreview/rkpreview.toml`.
const BUILTIN_DEFAULT: &str = include_str!("../rkpreview.toml");

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub themes: Vec<String>,
    #[serde(default)]
    pub capture: CaptureDefaults,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CaptureDefaults {
    pub window_width: u32,
    pub window_height: u32,
    pub window_position: [i32; 2],
    pub settle_ms: u64,
    pub post_focus_ms: u64,
    #[serde(default)]
    pub apps: HashMap<String, AppOverride>,
}

impl Default for CaptureDefaults {
    fn default() -> Self {
        // Mirrors the bundled rkpreview.toml so deserializing an empty
        // [capture] section gives the same result as the file's defaults.
        Self {
            window_width: 1280,
            window_height: 720,
            window_position: [100, 100],
            settle_ms: 2000,
            post_focus_ms: 300,
            apps: HashMap::new(),
        }
    }
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct AppOverride {
    pub settle_ms: Option<u64>,
    pub post_focus_ms: Option<u64>,
}

impl Config {
    /// Resolve the effective settle_ms for a given --app key, falling back to the
    /// project default if no per-app override exists.
    pub fn settle_ms_for(&self, app_key: &str) -> u64 {
        self.capture
            .apps
            .get(app_key)
            .and_then(|o| o.settle_ms)
            .unwrap_or(self.capture.settle_ms)
    }

    /// Resolve the effective post_focus_ms for a given --app key.
    pub fn post_focus_ms_for(&self, app_key: &str) -> u64 {
        self.capture
            .apps
            .get(app_key)
            .and_then(|o| o.post_focus_ms)
            .unwrap_or(self.capture.post_focus_ms)
    }
}

/// Load config in resolution order:
///   1. explicit `--config <path>` if Some
///   2. ~/.config/ricekit/rkpreview.toml if it exists
///   3. compiled-in default from the repo's rkpreview.toml
pub fn load(explicit: Option<&Path>) -> Result<Config> {
    if let Some(path) = explicit {
        return load_from_path(path);
    }
    let user_path = dirs::config_dir()
        .map(|c| c.join("ricekit").join("rkpreview.toml"));
    if let Some(p) = &user_path {
        if p.exists() {
            return load_from_path(p);
        }
    }
    toml::from_str(BUILTIN_DEFAULT)
        .context("parsing bundled default rkpreview.toml (this is a build bug)")
}

fn load_from_path(path: &Path) -> Result<Config> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    toml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_default_parses_with_expected_themes() {
        let cfg: Config = toml::from_str(BUILTIN_DEFAULT).expect("bundled default must parse");
        assert_eq!(
            cfg.themes,
            vec!["catppuccin-latte", "nord", "dracula", "hackerman"]
        );
        assert_eq!(cfg.capture.window_width, 1280);
        assert_eq!(cfg.capture.window_height, 720);
    }

    #[test]
    fn per_app_settle_override_wins() {
        let cfg: Config = toml::from_str(
            r#"
            themes = ["a", "b", "c", "d"]
            [capture]
            window_width = 800
            window_height = 600
            window_position = [0, 0]
            settle_ms = 1000
            post_focus_ms = 100
            [capture.apps."Slack"]
            settle_ms = 5000
            "#,
        )
        .unwrap();
        assert_eq!(cfg.settle_ms_for("Slack"), 5000);
        assert_eq!(cfg.settle_ms_for("Other"), 1000);
        assert_eq!(cfg.post_focus_ms_for("Slack"), 100); // no override → default
    }

    #[test]
    fn empty_capture_section_uses_defaults() {
        let cfg: Config = toml::from_str(
            r#"
            themes = ["a", "b", "c", "d"]
            [capture]
            window_width = 1
            window_height = 2
            window_position = [3, 4]
            settle_ms = 5
            post_focus_ms = 6
            "#,
        )
        .unwrap();
        assert!(cfg.capture.apps.is_empty());
        assert_eq!(cfg.capture.window_width, 1);
    }
}
