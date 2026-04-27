use anyhow::{Context, Result};
use rkpatch::{cmd, config};
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(
    name = "rkpatch",
    about = "Patch Electron apps with ricekit injections",
    long_about = "rkpatch <app> <command>\n\n\
        <app>     name of a config file under the configs dir (e.g. `linear` for `configs/linear.toml`)\n\
        <command> one of: status, install, restore"
)]
struct Cli {
    /// App config name (e.g. `linear` resolves to `<configs>/linear.toml`).
    app: String,

    #[command(subcommand)]
    command: Cmd,

    /// Override config directory. Default: $RKPATCH_CONFIGS, then the configs/ dir baked in at build time.
    #[arg(long, global = true)]
    configs: Option<PathBuf>,

    /// Override template base directory. Default: $RKPATCH_TEMPLATE_DIR, then ~/.config/ricekit/custom-configs.
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
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {:#}", e);
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let cfg_dir = resolve_configs_dir(cli.configs.as_deref())?;
    let template_base = resolve_template_base(cli.templates.as_deref())?;
    let cfg_path = cfg_dir.join(format!("{}.toml", cli.app));
    let app_cfg = config::AppConfig::load(&cfg_path, &template_base)
        .with_context(|| format!("loading {}", cfg_path.display()))?;
    match cli.command {
        Cmd::Status => cmd::status(&app_cfg),
        Cmd::Install => cmd::install(&app_cfg),
        Cmd::Restore => cmd::restore(&app_cfg),
    }
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
    anyhow::bail!("no config dir found; set RKPATCH_CONFIGS or pass --configs <dir>")
}

fn resolve_template_base(override_dir: Option<&Path>) -> Result<PathBuf> {
    if let Some(d) = override_dir {
        return Ok(expand_tilde(d));
    }
    if let Ok(s) = std::env::var("RKPATCH_TEMPLATE_DIR") {
        return Ok(expand_tilde(Path::new(&s)));
    }
    let home = dirs::home_dir().context("could not resolve home directory")?;
    Ok(home.join(".config/ricekit/custom-configs"))
}

fn expand_tilde(p: &Path) -> PathBuf {
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
