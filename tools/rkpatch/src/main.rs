use anyhow::{anyhow, Context, Result};
use rkpatch::config::expand_tilde;
use rkpatch::{cmd, config, ui};
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(
    name = "rkpatch",
    about = "Patch Electron apps with ricekit injections",
    long_about = "rkpatch <app> <command>\n\n\
        <app>     name of a config file under the configs dir (e.g. `linear` for `configs/linear.toml`)\n\
        <command> one of: status, install, restore, prune"
)]
struct Cli {
    /// App config name (e.g. `linear` resolves to `<configs>/linear.toml`).
    app: String,

    #[command(subcommand)]
    command: Cmd,

    /// Override config directory. Default: $RKPATCH_CONFIGS, then the configs/ dir baked in at build time.
    #[arg(long, global = true)]
    configs: Option<PathBuf>,

    /// Override template base directory. Default: $RKPATCH_TEMPLATE_DIR, then the first of
    /// `~/.config/ricekit/custom-configs` and `~/.config/ricekit/installed-configs` that
    /// contains the template.
    #[arg(long, global = true)]
    templates: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print current patch state of the app.
    Status,
    /// Inject the ricekit payload into the app's main process bundle.
    Install,
    /// Restore the most recent backup made by `install`.
    Restore,
    /// Delete backups for app versions other than the one currently installed.
    Prune,
}

fn main() {
    if let Err(e) = run() {
        ui::print_error(&e);
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let cfg_dir = resolve_configs_dir(cli.configs.as_deref())?;
    let cfg_path = cfg_dir.join(format!("{}.toml", cli.app));
    // We need the template name to pick between candidate template bases below.
    // Reading the toml twice (once here, once inside `AppConfig::load`) keeps
    // config.rs's interface narrow — the cost is one extra ~1KB parse.
    let template_name = read_template_name(&cfg_path)
        .with_context(|| format!("Couldn't load the {} config.", cli.app))?;
    let template_base = resolve_template_base(cli.templates.as_deref(), &template_name)?;
    let app_cfg = config::AppConfig::load(&cfg_path, &template_base)
        .with_context(|| format!("Couldn't load the {} config.", cli.app))?;
    match cli.command {
        Cmd::Status => cmd::status(&app_cfg),
        Cmd::Install => cmd::install(&app_cfg),
        Cmd::Restore => cmd::restore(&app_cfg),
        Cmd::Prune => cmd::prune(&app_cfg),
    }
}

fn read_template_name(cfg_path: &Path) -> Result<String> {
    let s = std::fs::read_to_string(cfg_path)
        .with_context(|| format!("Couldn't read {}.", cfg_path.display()))?;
    let value: toml::Value = toml::from_str(&s)
        .with_context(|| format!("Couldn't parse {}.", cfg_path.display()))?;
    value
        .get("template")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("config is missing top-level `template` field."))
}

fn resolve_configs_dir(override_dir: Option<&Path>) -> Result<PathBuf> {
    if let Some(d) = override_dir {
        return Ok(d.to_path_buf());
    }
    if let Ok(s) = std::env::var("RKPATCH_CONFIGS") {
        let p = expand_tilde(Path::new(&s));
        if p.is_dir() {
            return Ok(p);
        }
    }
    let baked = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/configs"));
    if baked.is_dir() {
        return Ok(baked);
    }
    anyhow::bail!("Couldn't find a config directory. Set RKPATCH_CONFIGS or pass --configs <dir>.")
}

fn resolve_template_base(override_dir: Option<&Path>, template_name: &str) -> Result<PathBuf> {
    if let Some(d) = override_dir {
        return Ok(expand_tilde(d));
    }
    if let Ok(s) = std::env::var("RKPATCH_TEMPLATE_DIR") {
        return Ok(expand_tilde(Path::new(&s)));
    }
    let home = dirs::home_dir().context("Couldn't find your home directory.")?;
    // Two locations Ricekit puts templates: `custom-configs` for hand-rolled
    // / template-author content, `installed-configs` for marketplace installs.
    // Probe in author-first order so a local edit overrides the marketplace
    // copy when both exist with the same template name. If neither contains
    // the template, fall back to `custom-configs` so the downstream
    // "Couldn't read injection template at …" error points at a path the
    // user is most likely to recognize.
    let primary = home.join(".config/ricekit/custom-configs");
    let secondary = home.join(".config/ricekit/installed-configs");
    for base in [&primary, &secondary] {
        if base.join(template_name).is_dir() {
            return Ok(base.clone());
        }
    }
    Ok(primary)
}

