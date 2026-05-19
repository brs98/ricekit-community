use crate::composite;
use crate::config::Config;
use crate::ricekit;
use crate::window;
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Parameters for a single capture run, after CLI/config resolution.
#[derive(Debug)]
pub struct CaptureParams {
    pub app: String,
    pub window_title: Option<String>,
    pub window_id: Option<u32>,
    pub width: u32,
    pub height: u32,
    pub position: (i32, i32),
    pub settle: Duration,
    pub post_focus: Duration,
    pub output: PathBuf,
    pub auto_install: bool,
}

/// Captures the 4 themed screenshots in standard order, composites, and writes
/// to `params.output`. Always restores the original theme on the way out.
pub fn run(cfg: &Config, params: &CaptureParams) -> Result<()> {
    if cfg.themes.len() != 4 {
        bail!(
            "config has {} themes, expected exactly 4",
            cfg.themes.len()
        );
    }
    // --window-title needs Screen Recording permission to work at all, since
    // CGWindowList only populates window titles for processes that have it.
    // Without it, every title comes back empty and the substring match silently
    // fails. Detect this up front rather than after applying the first theme.
    if params.window_title.is_some() && !window::has_screen_recording_permission() {
        bail!(
            "--window-title requires Screen Recording permission, but this process doesn't have it.\n\
             Window titles can't be read without it (macOS omits them from CGWindowList output).\n\
             \n\
             Fix: System Settings → Privacy & Security → Screen & System Audio Recording → enable\n\
             your terminal, then quit and relaunch the terminal. Or pass --window-id instead."
        );
    }
    preflight_themes(&cfg.themes, params.auto_install)?;

    // Record the theme to restore. From this point on, any exit path (success,
    // error, ctrlc) must invoke restore_original_theme().
    let original = ricekit::current_theme().context("reading current ricekit theme")?;
    set_restore_target(original.clone());
    install_signal_handler();

    let result = (|| -> Result<()> {
        // Decide what title (if any) to use when telling AppleScript to raise a
        // specific window. If --window-title was given, use it directly. If
        // --window-id was given, look up that window's current title from
        // CGWindowList so the AppleScript can target it precisely. Otherwise
        // we fall back to "frontmost window of the app".
        let focus_title: Option<String> = match (&params.window_title, params.window_id) {
            (Some(t), _) => Some(t.clone()),
            (None, Some(id)) => window::list()?
                .into_iter()
                .find(|w| w.id == id)
                .and_then(|w| w.title),
            (None, None) => None,
        };

        // Step 1: focus + resize the target window BEFORE any theme switching.
        // CGWindowIDs are stable for a window's lifetime, so once we focus and
        // resize the right window, we can resolve its ID and reuse it across
        // all 4 iterations — no risk of grabbing the wrong window because the
        // user's last-focused window happened to be different from our target.
        focus_target_window(
            &params.app,
            focus_title.as_deref(),
            params.position,
            (params.width, params.height),
        )?;
        std::thread::sleep(params.post_focus);

        // Step 2: resolve the CGWindowID once. Used for every capture below.
        let target = window::resolve(
            Some(&params.app),
            params.window_title.as_deref(),
            params.window_id,
        )?;
        eprintln!(
            "targeting window id {} ({:.0}x{:.0}) — {}",
            target.id,
            target.bounds.width,
            target.bounds.height,
            target.title.as_deref().unwrap_or("<no title>")
        );

        let tmp = tempfile::tempdir().context("creating temp dir for screenshots")?;
        let mut shots: Vec<PathBuf> = Vec::with_capacity(4);

        for (i, theme) in cfg.themes.iter().enumerate() {
            eprintln!("[{}/4] applying theme: {theme}", i + 1);
            ricekit::apply_theme(theme)?;
            std::thread::sleep(params.settle);

            // Re-focus and re-size. Some apps (Electron in particular) steal
            // focus or even resize themselves when their inject layer
            // re-applies a theme. Cheap to redo and idempotent if nothing
            // moved.
            focus_target_window(
                &params.app,
                focus_title.as_deref(),
                params.position,
                (params.width, params.height),
            )?;
            std::thread::sleep(params.post_focus);

            let shot = tmp.path().join(format!("{i}-{theme}.png"));
            screencapture(target.id, &shot)
                .with_context(|| format!("capturing window id {} for theme {theme}", target.id))?;
            shots.push(shot);
        }

        composite::run_compose(&shots, &params.output)?;
        Ok(())
    })();

    // Always restore — regardless of success/failure of the capture block.
    restore_original_theme();
    result
}

/// Verify every required theme is installed. With `auto_install`, missing
/// themes are installed via the marketplace; without it, we error out and
/// print the exact commands the user should run.
fn preflight_themes(themes: &[String], auto_install: bool) -> Result<()> {
    let missing = ricekit::missing_themes(themes)?;
    if missing.is_empty() {
        return Ok(());
    }
    if !auto_install {
        let mut msg = format!("missing required themes: {}\n\nInstall with:\n", missing.join(", "));
        for slug in &missing {
            msg.push_str(&format!("  ricekit marketplace install {slug}\n"));
        }
        msg.push_str("or re-run with --auto-install.");
        bail!("{msg}");
    }
    for slug in &missing {
        eprintln!("installing theme: {slug}");
        ricekit::install_theme(slug)
            .with_context(|| format!("installing {slug} from marketplace"))?;
    }
    // Re-verify.
    let still_missing = ricekit::missing_themes(themes)?;
    if !still_missing.is_empty() {
        bail!(
            "themes still not installed after marketplace install: {}",
            still_missing.join(", ")
        );
    }
    Ok(())
}

/// Activate the app and resize/reposition the target window via osascript.
///
/// If `title_substr` is `Some`, iterate the app's windows and `AXRaise` +
/// resize the first whose title contains it (case-insensitive). If `None`,
/// just operate on "front window" — the legacy behavior for single-window apps.
///
/// AXRaise is the accessibility API for "bring this specific window to the
/// front of its app's window stack", distinct from `activate` which only
/// brings the app itself to front. Both are needed when an app has multiple
/// windows.
fn focus_target_window(
    app: &str,
    title_substr: Option<&str>,
    position: (i32, i32),
    size: (u32, u32),
) -> Result<()> {
    let (x, y) = position;
    let (w, h) = size;
    let script = match title_substr {
        Some(needle) => {
            // Escape backslash first (so the second pass doesn't double-escape
            // the escapes), then escape double quotes for AppleScript literal
            // safety.
            let escaped = needle.replace('\\', "\\\\").replace('"', "\\\"");
            format!(
                r#"
                tell application "{app}" to activate
                delay 0.1
                tell application "System Events"
                    tell process "{app}"
                        set winList to windows
                        repeat with w in winList
                            if name of w contains "{escaped}" then
                                perform action "AXRaise" of w
                                set position of w to {{{x}, {y}}}
                                set size of w to {{{w_size}, {h_size}}}
                                exit repeat
                            end if
                        end repeat
                    end tell
                end tell
                "#,
                w_size = w,
                h_size = h,
            )
        }
        None => format!(
            r#"
            tell application "{app}" to activate
            delay 0.1
            tell application "System Events"
                tell process "{app}"
                    if (count of windows) > 0 then
                        set position of front window to {{{x}, {y}}}
                        set size of front window to {{{w}, {h}}}
                    end if
                end tell
            end tell
            "#
        ),
    };
    let out = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .context("running osascript")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.contains("not authorized") || stderr.contains("1002") {
            bail!(
                "osascript was denied — grant Accessibility permission to your terminal in System Settings → Privacy & Security → Accessibility, then re-run.\n\nosascript stderr: {}",
                stderr.trim()
            );
        }
        bail!("osascript exited {}: {}", out.status, stderr.trim());
    }
    Ok(())
}

/// Capture a single window by CGWindowID using macOS's built-in `screencapture`.
/// Flags: `-l <id>` selects the window, `-o` strips the drop shadow, `-x` mutes
/// the camera-shutter sound, `-r` skips the dpi-metadata block.
fn screencapture(window_id: u32, dest: &Path) -> Result<()> {
    let out = Command::new("screencapture")
        .args(["-l", &window_id.to_string(), "-o", "-x", "-r"])
        .arg(dest)
        .output()
        .context("running screencapture")?;
    if !out.status.success() {
        bail!(
            "screencapture exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    // screencapture occasionally writes a tiny black file if Screen Recording
    // permission is missing rather than returning non-zero — detect that here.
    let meta = std::fs::metadata(dest)
        .with_context(|| format!("checking output {}", dest.display()))?;
    if meta.len() < 1024 {
        bail!(
            "screencapture wrote a suspiciously small file ({} bytes) — Screen Recording permission is likely missing.\nGrant it in System Settings → Privacy & Security → Screen & System Audio Recording, then re-run.",
            meta.len()
        );
    }
    Ok(())
}

// ---- restore-on-exit machinery -----------------------------------------------

static RESTORE_TARGET: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static RESTORED: OnceLock<Mutex<bool>> = OnceLock::new();

fn set_restore_target(slug: String) {
    let cell = RESTORE_TARGET.get_or_init(|| Mutex::new(None));
    *cell.lock().unwrap() = Some(slug);
    let done = RESTORED.get_or_init(|| Mutex::new(false));
    *done.lock().unwrap() = false;
}

/// Apply the previously-recorded theme, if any. Idempotent — multiple calls do
/// only one apply. Best-effort: errors are logged but not propagated.
fn restore_original_theme() {
    let Some(target_cell) = RESTORE_TARGET.get() else { return };
    let Some(slug) = target_cell.lock().unwrap().clone() else { return };
    let done_cell = RESTORED.get_or_init(|| Mutex::new(false));
    let mut done = done_cell.lock().unwrap();
    if *done {
        return;
    }
    *done = true;
    eprintln!("restoring theme: {slug}");
    if let Err(e) = ricekit::apply_theme(&slug) {
        eprintln!("warning: failed to restore theme {slug}: {e:#}");
    }
}

fn install_signal_handler() {
    // ctrlc::set_handler can only be called once per process; ignore the
    // already-installed error so tests / repeated invocations don't blow up.
    let _ = ctrlc::set_handler(|| {
        eprintln!("\nrkpreview: interrupt received");
        restore_original_theme();
        std::process::exit(130);
    });
}
