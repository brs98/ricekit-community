// App config schema. Per-OS values live under `[macos]` / `[linux]` sub-tables;
// the loader picks the section for the current OS at parse time, so the rest
// of the crate sees a flat `AppConfig`.
//
// Back-compat: configs that put `app_path` + `asar_candidates` at the top
// level (the original shape) are treated as a macOS section. New configs
// should use sub-tables.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct AppConfig {
    pub bundle_id: String,
    pub template: String,
    pub inject_file: PathBuf,
    pub substitutions: Vec<Substitution>,
    pub template_dir: PathBuf,

    /// Resolved bundle root for the current OS.
    /// macOS: `/Applications/Foo.app`. Linux: `/opt/Foo` (or wherever the
    /// chosen `app_path_candidate` resolved to).
    pub app_path: PathBuf,
    /// asar paths to try, relative to `app_path`. First match wins.
    pub asar_candidates: Vec<String>,

    /// Linux-specific fields. `None` on macOS.
    pub linux: Option<LinuxFields>,
}

#[derive(Debug)]
pub struct LinuxFields {
    /// Name pgrep/pkill match against (e.g. "linear", "slack").
    pub process_name: String,
    /// User-facing name used in UI strings.
    pub display_name: String,
    /// argv used to relaunch the app after install/restore.
    pub launch_command: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
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

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Per-OS sections are read by `resolve()` only on the matching target.
struct Raw {
    bundle_id: String,
    template: String,
    inject_file: PathBuf,
    #[serde(default)]
    substitutions: Vec<Substitution>,

    // Back-compat: original flat shape. Treated as the [macos] section if no
    // explicit [macos] table is present.
    app_path: Option<PathBuf>,
    #[serde(default)]
    asar_candidates: Vec<String>,

    macos: Option<RawOsSection>,
    linux: Option<RawOsSection>,
}

#[derive(Debug, Deserialize, Default)]
#[allow(dead_code)] // Linux-only fields are unused on macOS builds (and vice versa).
struct RawOsSection {
    /// Direct bundle-root path. Mutually exclusive with `app_path_candidates`.
    app_path: Option<PathBuf>,
    /// Try each in order; first existing one wins. Useful on Linux where install
    /// dirs vary per packaging method (deb vs rpm vs manual).
    #[serde(default)]
    app_path_candidates: Vec<PathBuf>,
    #[serde(default)]
    asar_candidates: Vec<String>,

    // Linux-only fields. Ignored on macOS.
    process_name: Option<String>,
    display_name: Option<String>,
    #[serde(default)]
    launch_command: Vec<String>,
}

impl AppConfig {
    pub fn load(path: &Path, template_base: &Path) -> Result<Self> {
        let s = std::fs::read_to_string(path)
            .with_context(|| format!("Couldn't read {}.", path.display()))?;
        let raw: Raw = toml::from_str(&s)?;
        resolve(raw, template_base)
    }

    pub fn inject_path(&self) -> PathBuf {
        self.template_dir.join(&self.inject_file)
    }

    pub fn substitution_path(&self, sub: &Substitution) -> PathBuf {
        self.template_dir.join(&sub.file)
    }

    /// Resolve every asar candidate that exists on disk, returning each as
    /// `(relative_path, absolute_path)`. Errors if none exist.
    ///
    /// Callers should treat all returned asars as equally authoritative — for
    /// example, Slack on macOS ships both `app-arm64.asar` and `app-x64.asar`
    /// and Electron picks one at launch based on the running process arch.
    /// Patching only the first match leaves the other unmodified, so under
    /// Rosetta the wrong slice gets used and the theme silently disappears.
    pub fn find_all_asars(&self) -> Result<Vec<(String, PathBuf)>> {
        let found: Vec<(String, PathBuf)> = self
            .asar_candidates
            .iter()
            .filter_map(|rel| {
                let abs = self.app_path.join(rel);
                abs.exists().then_some((rel.clone(), abs))
            })
            .collect();
        if found.is_empty() {
            return Err(anyhow!(
                "Couldn't find the app's bundle inside {}. Tried: {}.",
                self.app_path.display(),
                self.asar_candidates.join(", ")
            ));
        }
        Ok(found)
    }
}

// Each `return` is a conditionally-compiled body; on any one host only one is
// in the AST. The `#[allow]` is for clippy, which sees the active arm as a
// "needless tail return" without realising the others are cfg'd out.
#[allow(clippy::needless_return)]
fn resolve(raw: Raw, template_base: &Path) -> Result<AppConfig> {
    #[cfg(target_os = "macos")]
    return resolve_macos(raw, template_base);
    #[cfg(target_os = "linux")]
    return resolve_linux(raw, template_base);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (raw, template_base);
        unreachable!("compile_error in platform/mod.rs blocks unsupported targets")
    }
}

#[allow(dead_code)] // Used only on macOS; kept compiled for typecheck coverage on all hosts.
fn resolve_macos(raw: Raw, template_base: &Path) -> Result<AppConfig> {
    // Synthesize [macos] from flat top-level fields when no explicit table is
    // given — keeps original-shape configs working unchanged.
    let section = raw.macos.unwrap_or_else(|| RawOsSection {
        app_path: raw.app_path.clone(),
        asar_candidates: raw.asar_candidates.clone(),
        ..Default::default()
    });
    let app_path = section
        .app_path
        .ok_or_else(|| anyhow!("config is missing `app_path` (top-level or under [macos])."))?;
    let asar_candidates = if section.asar_candidates.is_empty() {
        return Err(anyhow!(
            "config is missing `asar_candidates` (top-level or under [macos])."
        ));
    } else {
        section.asar_candidates
    };
    Ok(AppConfig {
        template_dir: template_base.join(&raw.template),
        bundle_id: raw.bundle_id,
        template: raw.template,
        inject_file: raw.inject_file,
        substitutions: raw.substitutions,
        app_path: expand_tilde(&app_path),
        asar_candidates,
        linux: None,
    })
}

#[allow(dead_code)] // Used only on Linux; kept compiled for typecheck coverage on all hosts.
fn resolve_linux(raw: Raw, template_base: &Path) -> Result<AppConfig> {
    let section = raw.linux.ok_or_else(|| {
        anyhow!(
            "config has no [linux] section; this app doesn't have Linux support configured yet."
        )
    })?;
    let app_path = if let Some(p) = section.app_path {
        let p = expand_tilde(&p);
        if !p.exists() {
            return Err(anyhow!(
                "Configured Linux app_path doesn't exist: {}.",
                p.display()
            ));
        }
        p
    } else if !section.app_path_candidates.is_empty() {
        let candidates: Vec<PathBuf> = section
            .app_path_candidates
            .iter()
            .map(|p| expand_tilde(p))
            .collect();
        candidates
            .iter()
            .find(|p| p.exists())
            .cloned()
            .ok_or_else(|| {
                anyhow!(
                    "None of the configured Linux install paths exist. Tried: {}.",
                    candidates
                        .iter()
                        .map(|p| p.display().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?
    } else {
        return Err(anyhow!(
            "[linux] section needs `app_path` or `app_path_candidates`."
        ));
    };
    if section.asar_candidates.is_empty() {
        return Err(anyhow!("[linux] section is missing `asar_candidates`."));
    }
    let process_name = section
        .process_name
        .ok_or_else(|| anyhow!("[linux] section is missing `process_name`."))?;
    let display_name = section.display_name.unwrap_or_else(|| process_name.clone());
    // Default launch command: run `<app_path>/<process_name>`. Lots of Electron
    // packagings drop the wrapper script there; configs can override.
    let launch_command = if !section.launch_command.is_empty() {
        section.launch_command
    } else {
        vec![app_path.join(&process_name).to_string_lossy().into_owned()]
    };
    Ok(AppConfig {
        template_dir: template_base.join(&raw.template),
        bundle_id: raw.bundle_id,
        template: raw.template,
        inject_file: raw.inject_file,
        substitutions: raw.substitutions,
        app_path,
        asar_candidates: section.asar_candidates,
        linux: Some(LinuxFields {
            process_name,
            display_name,
            launch_command,
        }),
    })
}

pub fn expand_tilde(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    if s == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    p.to_path_buf()
}
