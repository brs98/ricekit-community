use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub app_path: PathBuf,
    pub bundle_id: String,
    pub asar_candidates: Vec<String>,
    /// Subdirectory under the template base where this app's payload files live.
    pub template: String,
    /// Filename of the JS payload to inject, relative to `<template_base>/<template>/`.
    pub inject_file: PathBuf,
    /// Optional in-place substitutions performed on the inject payload before injection.
    #[serde(default)]
    pub substitutions: Vec<Substitution>,

    #[serde(skip)]
    pub template_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct Substitution {
    /// Literal placeholder string in the inject payload.
    pub placeholder: String,
    /// File whose contents replace the placeholder, relative to the template dir.
    pub file: PathBuf,
    /// `json` (default): replace with `JSON.stringify(contents)`. `raw`: inline verbatim.
    #[serde(default = "default_encode")]
    pub encode: Encode,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Encode {
    Json,
    Raw,
}

fn default_encode() -> Encode {
    Encode::Json
}

impl AppConfig {
    pub fn load(path: &Path, template_base: &Path) -> Result<Self> {
        let s = std::fs::read_to_string(path)
            .with_context(|| format!("Couldn't read {}.", path.display()))?;
        let mut cfg: AppConfig = toml::from_str(&s)?;
        cfg.template_dir = template_base.join(&cfg.template);
        cfg.app_path = expand_tilde(&cfg.app_path);
        Ok(cfg)
    }

    pub fn inject_path(&self) -> PathBuf {
        self.template_dir.join(&self.inject_file)
    }

    pub fn substitution_path(&self, sub: &Substitution) -> PathBuf {
        self.template_dir.join(&sub.file)
    }
}

fn expand_tilde(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    p.to_path_buf()
}
