use image::{ImageReader, Rgba, RgbaImage};
use std::path::PathBuf;
use std::process::Command;

const W: u32 = 400;
const H: u32 = 240;

const COLORS: [[u8; 4]; 4] = [
    [255, 0, 0, 255],   // red
    [0, 255, 0, 255],   // green
    [0, 0, 255, 255],   // blue
    [255, 255, 0, 255], // yellow
];

fn solid(color: [u8; 4]) -> RgbaImage {
    RgbaImage::from_pixel(W, H, Rgba(color))
}

fn rkpreview_bin() -> PathBuf {
    // CARGO_BIN_EXE_<name> is set by cargo for integration tests of bin crates.
    PathBuf::from(env!("CARGO_BIN_EXE_rkpreview"))
}

fn run_rkpreview(inputs: &[std::path::PathBuf], out: &std::path::Path) {
    let status = Command::new(rkpreview_bin())
        .arg("compose")
        .args(inputs)
        .arg("-o")
        .arg(out)
        .status()
        .unwrap();
    assert!(status.success(), "rkpreview exited non-zero");
}

#[test]
fn midline_samples_pick_correct_band() {
    let tmp = tempfile::tempdir().unwrap();
    let mut inputs = Vec::new();
    for (i, c) in COLORS.iter().enumerate() {
        let p = tmp.path().join(format!("in{i}.png"));
        solid(*c).save(&p).unwrap();
        inputs.push(p);
    }
    let out = tmp.path().join("out.png");
    run_rkpreview(&inputs, &out);

    let img = ImageReader::open(&out).unwrap().decode().unwrap().to_rgba8();
    assert_eq!(img.dimensions(), (W, H));

    // At y = H/2 the slant contribution is zero, so cuts sit at x = 100/200/300
    // regardless of the fixed slant value. Sample well inside each band.
    let samples = [(50, H / 2, 0), (150, H / 2, 1), (250, H / 2, 2), (350, H / 2, 3)];
    for (x, y, band) in samples {
        assert_eq!(
            img.get_pixel(x, y).0,
            COLORS[band],
            "pixel at ({x}, {y}) should come from band {band}"
        );
    }
}

#[test]
fn slant_is_applied_consistently() {
    let tmp = tempfile::tempdir().unwrap();
    let mut inputs = Vec::new();
    for (i, c) in COLORS.iter().enumerate() {
        let p = tmp.path().join(format!("in{i}.png"));
        solid(*c).save(&p).unwrap();
        inputs.push(p);
    }
    let out = tmp.path().join("out.png");
    run_rkpreview(&inputs, &out);

    let img = ImageReader::open(&out).unwrap().decode().unwrap().to_rgba8();

    // With the fixed slant = H/6 = 40 (for H=240), the first cut sits at
    // x ≈ 120 at the top and x ≈ 80 at the bottom. Column x=85 is therefore
    // left of the cut at the top (band 0) but right of it at the bottom (band 1).
    assert_eq!(img.get_pixel(85, 0).0, COLORS[0], "top: left of first cut");
    assert_eq!(img.get_pixel(85, H - 1).0, COLORS[1], "bottom: right of first cut");
}
