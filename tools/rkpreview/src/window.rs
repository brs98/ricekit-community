use anyhow::{bail, Result};
use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::access::ScreenCaptureAccess;
use core_graphics::window;

/// Subset of a CGWindowList entry we care about for capture targeting.
#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub id: u32,
    pub owner_name: String,
    /// `kCGWindowName` is optional — apps that don't advertise a title omit it.
    pub title: Option<String>,
    /// `kCGWindowLayer` — 0 is the normal application layer. Menu bar / dock
    /// are at higher layers; we filter those out by default.
    pub layer: i64,
    pub bounds: WindowBounds,
}

#[derive(Debug, Clone, Copy)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Returns true if this process has macOS Screen Recording permission.
///
/// Window titles (`kCGWindowName`) are only populated in CGWindowList output
/// when this returns true — without it, every window's title comes back empty,
/// regardless of how the window was actually named by its owning app.
pub fn has_screen_recording_permission() -> bool {
    ScreenCaptureAccess.preflight()
}

/// Enumerate on-screen application windows in front-to-back order.
///
/// Uses `kCGWindowListOptionOnScreenOnly` (skips minimized windows) plus
/// `kCGWindowListExcludeDesktopElements` (skips wallpaper, dock, menu bar).
/// Further filters to `layer == 0` so we only see app windows, not floating
/// HUDs or system overlays.
pub fn list() -> Result<Vec<WindowInfo>> {
    let opts =
        window::kCGWindowListOptionOnScreenOnly | window::kCGWindowListExcludeDesktopElements;
    let Some(array) = window::copy_window_info(opts, 0) else {
        bail!("CGWindowListCopyWindowInfo returned null — Screen Recording permission missing?");
    };

    let owner_key = unsafe { CFString::wrap_under_get_rule(window::kCGWindowOwnerName) };
    let name_key = unsafe { CFString::wrap_under_get_rule(window::kCGWindowName) };
    let number_key = unsafe { CFString::wrap_under_get_rule(window::kCGWindowNumber) };
    let layer_key = unsafe { CFString::wrap_under_get_rule(window::kCGWindowLayer) };
    let bounds_key = unsafe { CFString::wrap_under_get_rule(window::kCGWindowBounds) };

    let mut out = Vec::new();
    for ptr in array.iter() {
        let dict: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(*ptr as CFDictionaryRef) };

        let Some(layer) = read_i64(&dict, &layer_key) else { continue };
        if layer != 0 {
            continue;
        }
        let Some(id) = read_i64(&dict, &number_key).and_then(|n| u32::try_from(n).ok()) else {
            continue;
        };
        let Some(owner_name) = read_string(&dict, &owner_key) else { continue };
        let Some(bounds) = read_bounds(&dict, &bounds_key) else { continue };

        out.push(WindowInfo {
            id,
            owner_name,
            title: read_string(&dict, &name_key),
            layer,
            bounds,
        });
    }
    Ok(out)
}

/// Resolve a single window matching the given app key + optional disambiguators.
///
/// `app_key` matches against `owner_name` (case-sensitive). If `title_substr` is
/// `Some`, it filters the candidate set by case-insensitive substring on the
/// window title. If `explicit_id` is `Some`, it short-circuits all matching.
///
/// Returns:
///   - Ok(window)   on exactly one match
///   - Err(...)     on zero matches or multiple matches (with candidate list)
pub fn resolve(
    app_key: Option<&str>,
    title_substr: Option<&str>,
    explicit_id: Option<u32>,
) -> Result<WindowInfo> {
    let windows = list()?;

    if let Some(id) = explicit_id {
        return windows
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| anyhow::anyhow!("no on-screen window has id {id}"));
    }

    let app_key = app_key
        .ok_or_else(|| anyhow::anyhow!("internal error: no --app and no --window-id provided"))?;

    let by_app: Vec<WindowInfo> = windows
        .into_iter()
        .filter(|w| w.owner_name == app_key)
        .collect();
    if by_app.is_empty() {
        bail!(
            "no on-screen window owned by \"{app_key}\" — is the app running and visible?"
        );
    }

    let candidates: Vec<WindowInfo> = match title_substr {
        Some(needle) => {
            let n = needle.to_lowercase();
            by_app
                .into_iter()
                .filter(|w| {
                    w.title
                        .as_deref()
                        .map(|t| t.to_lowercase().contains(&n))
                        .unwrap_or(false)
                })
                .collect()
        }
        None => by_app,
    };

    match candidates.len() {
        0 => bail!(
            "no window of \"{app_key}\" matched --window-title \"{}\"",
            title_substr.unwrap_or("")
        ),
        1 => Ok(candidates.into_iter().next().unwrap()),
        _ if title_substr.is_none() => {
            // Multiple windows of the same app and no disambiguator — pick the
            // frontmost (first in the front-to-back-ordered list).
            Ok(candidates.into_iter().next().unwrap())
        }
        _ => {
            let mut msg = format!(
                "--window-title \"{}\" matched {} windows of \"{app_key}\":\n",
                title_substr.unwrap(),
                candidates.len()
            );
            for w in &candidates {
                msg.push_str(&format!(
                    "  id={} title={:?}\n",
                    w.id,
                    w.title.as_deref().unwrap_or("")
                ));
            }
            msg.push_str("Use --window-id <n> to disambiguate.");
            bail!("{msg}");
        }
    }
}

fn read_string(dict: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<String> {
    dict.find(key)?.downcast::<CFString>().map(|s| s.to_string())
}

fn read_i64(dict: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<i64> {
    dict.find(key)?.downcast::<CFNumber>().and_then(|n| n.to_i64())
}

fn read_f64(dict: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<f64> {
    let v = dict.find(key)?;
    if let Some(n) = v.downcast::<CFNumber>() {
        n.to_f64().or_else(|| n.to_i64().map(|i| i as f64))
    } else {
        None
    }
}

fn read_bounds(dict: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<WindowBounds> {
    // kCGWindowBounds is stored as a CFDictionary with X / Y / Width / Height
    // numeric keys (not a CGRect struct). Only the raw void/void form of
    // CFDictionary implements ConcreteCFType for downcasting; we then re-wrap
    // the same ref as a typed CFDictionary<CFString, CFType> for ergonomic
    // key lookups.
    let nested_raw: CFDictionary = dict.find(key)?.downcast::<CFDictionary>()?;
    let nested: CFDictionary<CFString, CFType> =
        unsafe { CFDictionary::wrap_under_get_rule(nested_raw.as_concrete_TypeRef()) };
    let x_key = CFString::from_static_string("X");
    let y_key = CFString::from_static_string("Y");
    let w_key = CFString::from_static_string("Width");
    let h_key = CFString::from_static_string("Height");
    Some(WindowBounds {
        x: read_f64(&nested, &x_key)?,
        y: read_f64(&nested, &y_key)?,
        width: read_f64(&nested, &w_key)?,
        height: read_f64(&nested, &h_key)?,
    })
}
