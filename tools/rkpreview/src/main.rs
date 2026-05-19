use anyhow::{bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use rkpreview::{composite, config};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "rkpreview",
    about = "Composite or capture 4-theme ricekit display images.",
    long_about = "rkpreview has three modes:\n\
        \n  compose   — composite 4 pre-made screenshots into one diagonal-cut image\
        \n  capture   — drive ricekit + screencapture to make all 4 themed screenshots, then composite (macOS only)\
        \n  windows   — list visible windows for use with `capture --window-id` (macOS only)"
)]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Composite 4 same-size images into one with diagonal `/` cuts.
    Compose(ComposeArgs),
    /// Drive ricekit + screencapture to produce all 4 themed shots, then composite.
    #[cfg(target_os = "macos")]
    Capture(CaptureArgs),
    /// List visible application windows (id + bounds + title).
    #[cfg(target_os = "macos")]
    Windows(WindowsArgs),
}

#[derive(Args)]
struct ComposeArgs {
    /// Four input images, left-to-right. Must all share identical dimensions.
    #[arg(required = true, num_args = 4)]
    inputs: Vec<PathBuf>,

    /// Output path. Format is inferred from the extension (.png, .jpg, .webp).
    #[arg(short, long)]
    output: PathBuf,
}

#[cfg(target_os = "macos")]
#[derive(Args)]
struct CaptureArgs {
    /// Application name or bundle id (e.g. "Slack" or "com.tinyspeck.slackmacgap").
    /// Must match the app's CGWindow owner name.
    #[arg(long)]
    app: String,

    /// Output path for the composited image.
    #[arg(short, long)]
    output: PathBuf,

    /// Override config: path to an alternate rkpreview.toml.
    #[arg(long)]
    config: Option<PathBuf>,

    /// Disambiguate among multiple windows of the same app by title substring
    /// (case-insensitive).
    #[arg(long)]
    window_title: Option<String>,

    /// Explicit CGWindowID — skips all app/title matching. Use `rkpreview windows`
    /// to discover IDs.
    #[arg(long)]
    window_id: Option<u32>,

    /// Window width override. Default comes from rkpreview.toml.
    #[arg(long)]
    width: Option<u32>,
    /// Window height override.
    #[arg(long)]
    height: Option<u32>,
    /// Window position as "x,y". Default from rkpreview.toml.
    #[arg(long, value_parser = parse_position)]
    position: Option<(i32, i32)>,

    /// Delay (ms) after `ricekit apply` exits, before screenshotting.
    #[arg(long)]
    settle_ms: Option<u64>,
    /// Delay (ms) after focusing + resizing the window.
    #[arg(long)]
    post_focus_ms: Option<u64>,

    /// Install missing themes from the marketplace before running. Off by
    /// default — without this, missing themes produce an actionable error
    /// listing the install commands you should run.
    #[arg(long)]
    auto_install: bool,
}

#[cfg(target_os = "macos")]
#[derive(Args)]
struct WindowsArgs {
    /// Filter to windows owned by this app (case-sensitive match on CGWindow
    /// owner name). Omit to list all visible windows.
    #[arg(long)]
    app: Option<String>,
}

fn parse_position(s: &str) -> Result<(i32, i32), String> {
    let (xs, ys) = s
        .split_once(',')
        .ok_or_else(|| format!("expected x,y but got {s:?}"))?;
    let x: i32 = xs
        .trim()
        .parse()
        .map_err(|e| format!("bad x in {s:?}: {e}"))?;
    let y: i32 = ys
        .trim()
        .parse()
        .map_err(|e| format!("bad y in {s:?}: {e}"))?;
    Ok((x, y))
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Cmd::Compose(args) => composite::run_compose(&args.inputs, &args.output),
        #[cfg(target_os = "macos")]
        Cmd::Capture(args) => run_capture(args),
        #[cfg(target_os = "macos")]
        Cmd::Windows(args) => run_windows(args),
    }
}

#[cfg(target_os = "macos")]
fn run_capture(args: CaptureArgs) -> Result<()> {
    use rkpreview::capture::{self, CaptureParams};

    let cfg = config::load(args.config.as_deref()).context("loading rkpreview config")?;
    if cfg.themes.len() != 4 {
        bail!(
            "rkpreview.toml has {} themes; capture requires exactly 4",
            cfg.themes.len()
        );
    }

    let width = args.width.unwrap_or(cfg.capture.window_width);
    let height = args.height.unwrap_or(cfg.capture.window_height);
    let position = args
        .position
        .unwrap_or((cfg.capture.window_position[0], cfg.capture.window_position[1]));
    let settle_ms = args
        .settle_ms
        .unwrap_or_else(|| cfg.settle_ms_for(&args.app));
    let post_focus_ms = args
        .post_focus_ms
        .unwrap_or_else(|| cfg.post_focus_ms_for(&args.app));

    let params = CaptureParams {
        app: args.app,
        window_title: args.window_title,
        window_id: args.window_id,
        width,
        height,
        position,
        settle: Duration::from_millis(settle_ms),
        post_focus: Duration::from_millis(post_focus_ms),
        output: args.output,
        auto_install: args.auto_install,
    };
    capture::run(&cfg, &params)
}

#[cfg(target_os = "macos")]
fn run_windows(args: WindowsArgs) -> Result<()> {
    let has_perm = rkpreview::window::has_screen_recording_permission();
    if !has_perm {
        eprintln!(
            "warning: Screen Recording permission is not granted to this process.\n\
             Window titles will be omitted from the listing below — macOS only\n\
             exposes them to processes with Screen Recording access.\n\
             \n\
             To fix: System Settings → Privacy & Security → Screen & System Audio\n\
             Recording → enable the entry for your terminal (or add it), then quit\n\
             and relaunch the terminal so the new permission is picked up.\n"
        );
    }
    let windows = rkpreview::window::list()?;
    let filtered: Vec<_> = match &args.app {
        Some(app) => windows.into_iter().filter(|w| &w.owner_name == app).collect(),
        None => windows,
    };
    println!(
        "{:<8}  {:<30}  {:<22}  title",
        "id", "owner", "bounds (w×h+x+y)"
    );
    for w in &filtered {
        let bounds = format!(
            "{:.0}x{:.0}+{:.0}+{:.0}",
            w.bounds.width, w.bounds.height, w.bounds.x, w.bounds.y
        );
        let title = w.title.as_deref().unwrap_or("");
        println!("{:<8}  {:<30}  {:<22}  {}", w.id, w.owner_name, bounds, title);
    }
    Ok(())
}
