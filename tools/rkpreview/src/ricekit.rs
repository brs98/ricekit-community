use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;

/// Subset of `ricekit current --json` we care about.
#[derive(Debug, Deserialize)]
struct CurrentOutput {
    theme: String,
}

/// Read the currently-active theme slug via `ricekit current --json`.
pub fn current_theme() -> Result<String> {
    let out = Command::new("ricekit")
        .args(["current", "--json"])
        .output()
        .context("running `ricekit current --json` (is ricekit on $PATH?)")?;
    if !out.status.success() {
        bail!(
            "`ricekit current --json` exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let parsed: CurrentOutput = serde_json::from_slice(&out.stdout)
        .context("parsing `ricekit current --json` output")?;
    Ok(parsed.theme)
}

/// Apply a theme via `ricekit apply <slug>`. Returns when ricekit exits.
pub fn apply_theme(slug: &str) -> Result<()> {
    let status = Command::new("ricekit")
        .args(["apply", slug])
        .status()
        .with_context(|| format!("running `ricekit apply {slug}`"))?;
    if !status.success() {
        bail!("`ricekit apply {slug}` exited {status}");
    }
    Ok(())
}

/// Install a theme via `ricekit marketplace install <slug>`.
pub fn install_theme(slug: &str) -> Result<()> {
    let status = Command::new("ricekit")
        .args(["marketplace", "install", slug])
        .status()
        .with_context(|| format!("running `ricekit marketplace install {slug}`"))?;
    if !status.success() {
        bail!("`ricekit marketplace install {slug}` exited {status}");
    }
    Ok(())
}

/// Path to a theme's metadata file inside the user's ricekit themes dir.
fn theme_meta_path(slug: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("no HOME directory available"))?;
    Ok(home
        .join(".config")
        .join("ricekit")
        .join("themes")
        .join(slug)
        .join("theme.toml"))
}

/// Check whether a theme slug is installed (i.e. its `theme.toml` exists on disk).
pub fn is_installed(slug: &str) -> Result<bool> {
    Ok(theme_meta_path(slug)?.is_file())
}

/// Return the subset of `slugs` that aren't installed, preserving input order.
pub fn missing_themes(slugs: &[String]) -> Result<Vec<String>> {
    let mut missing = Vec::new();
    for slug in slugs {
        if !is_installed(slug)? {
            missing.push(slug.clone());
        }
    }
    Ok(missing)
}
