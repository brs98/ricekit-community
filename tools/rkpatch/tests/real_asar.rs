// Smoke test against the real Linear asar on disk. Skipped if the file is
// missing (so this remains a no-op on machines without Linear installed).

use rkpatch::asar;
use std::path::PathBuf;

#[test]
fn extract_repack_real_asar() {
    let real = PathBuf::from("/Applications/Linear.app/Contents/Resources/app.asar");
    if !real.exists() {
        eprintln!("skipping: {} not present", real.display());
        return;
    }

    let scratch = tempfile::tempdir().unwrap();
    let extract_dir = scratch.path().join("ext");
    asar::extract_all(&real, &extract_dir).unwrap();

    let pkg_on_disk = std::fs::read(extract_dir.join("package.json")).unwrap();

    let repacked = scratch.path().join("repacked.asar");
    asar::pack(&extract_dir, &repacked).unwrap();

    let header = asar::read_header(&repacked).unwrap();
    let pkg_from_repacked =
        asar::read_file_from_archive(&repacked, &header, "package.json").unwrap();

    assert_eq!(pkg_on_disk, pkg_from_repacked);

    // Spot-check that compute_integrity runs on a repacked archive without panicking
    // and returns deterministic values.
    let i1 = asar::compute_integrity(&repacked, &header).unwrap();
    let i2 = asar::compute_integrity(&repacked, &header).unwrap();
    assert_eq!(i1.hash, i2.hash);
    assert!(!i1.blocks.is_empty());
}
