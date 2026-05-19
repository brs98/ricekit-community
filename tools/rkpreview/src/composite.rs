use anyhow::{bail, Context, Result};
use image::{ImageReader, Rgba, RgbaImage};
use std::path::{Path, PathBuf};

/// Fixed slant for every composite: horizontal offset (px) between the top and
/// bottom of each diagonal cut, as a fraction of input height. All ricekit
/// display images use this exact value so they look like a set.
pub const SLANT_FRACTION_OF_HEIGHT: f32 = 1.0 / 6.0;

/// Load 4 inputs, verify they share dimensions, composite with the fixed
/// diagonal slant, and write to `output`. The output format is inferred from
/// the file extension.
pub fn run_compose(inputs: &[PathBuf], output: &Path) -> Result<()> {
    if inputs.len() != 4 {
        bail!("compose requires exactly 4 input images, got {}", inputs.len());
    }
    let images: Vec<RgbaImage> = inputs
        .iter()
        .map(|p| {
            ImageReader::open(p)
                .with_context(|| format!("opening {}", p.display()))?
                .with_guessed_format()
                .with_context(|| format!("sniffing format of {}", p.display()))?
                .decode()
                .with_context(|| format!("decoding {}", p.display()))
                .map(|img| img.to_rgba8())
        })
        .collect::<Result<_>>()?;

    let (w, h) = images[0].dimensions();
    for (i, img) in images.iter().enumerate().skip(1) {
        if img.dimensions() != (w, h) {
            bail!(
                "input {} is {}x{}, expected {}x{} to match input 1",
                i + 1,
                img.dimensions().0,
                img.dimensions().1,
                w,
                h
            );
        }
    }

    let slant = h as f32 * SLANT_FRACTION_OF_HEIGHT;
    let out = composite(&images, w, h, slant);

    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
    }
    out.save(output)
        .with_context(|| format!("writing {}", output.display()))?;
    Ok(())
}

/// Composite four same-size images side-by-side, separated by 3 diagonal `/` cuts.
///
/// For each output pixel (x, y) we compute a *diagonal coordinate*
///     u = x + slant * (y/H - 0.5)
/// which is `x` at the vertical midpoint and tilts left/right elsewhere.
/// Splitting [0, W) into 4 equal bands in `u` produces 4 parallelogram-shaped
/// regions whose separators are straight `/` diagonals. Pixels within 0.5 of a
/// boundary are alpha-blended for 1px anti-aliasing.
pub fn composite(images: &[RgbaImage], w: u32, h: u32, slant: f32) -> RgbaImage {
    let mut out = RgbaImage::new(w, h);
    let band_w = w as f32 / 4.0;
    let h_f = h as f32;

    for y in 0..h {
        let y_shift = slant * (y as f32 / h_f - 0.5);
        for x in 0..w {
            let u = x as f32 + y_shift;
            let band = (u / band_w).max(0.0) as usize;
            let band = band.min(3);

            let left_d = u - band as f32 * band_w;
            let right_d = (band + 1) as f32 * band_w - u;

            let pixel = if band > 0 && left_d < 0.5 {
                let t = 0.5 - left_d;
                blend(images[band - 1].get_pixel(x, y), images[band].get_pixel(x, y), t)
            } else if band < 3 && right_d < 0.5 {
                let t = 0.5 - right_d;
                blend(images[band + 1].get_pixel(x, y), images[band].get_pixel(x, y), t)
            } else {
                *images[band].get_pixel(x, y)
            };
            out.put_pixel(x, y, pixel);
        }
    }
    out
}

/// Linear blend: `t` is the weight of `a` (0.0 = pure `b`, 1.0 = pure `a`).
fn blend(a: &Rgba<u8>, b: &Rgba<u8>, t: f32) -> Rgba<u8> {
    let mix = |ca: u8, cb: u8| -> u8 {
        (ca as f32 * t + cb as f32 * (1.0 - t)).round().clamp(0.0, 255.0) as u8
    };
    Rgba([
        mix(a.0[0], b.0[0]),
        mix(a.0[1], b.0[1]),
        mix(a.0[2], b.0[2]),
        mix(a.0[3], b.0[3]),
    ])
}
