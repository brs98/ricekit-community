// Integration test: pack → read header → extract a known file → confirm
// byte-identical content. Exercises the asar reader and writer against each
// other. Lives under `tests/` so it pulls the crate via its public surface;
// the modules under test are re-exported from `lib.rs` for this purpose.

use rkpatch::asar;
use std::fs;

#[test]
fn pack_then_read_round_trip() {
    let scratch = tempfile::tempdir().unwrap();
    let src = scratch.path().join("src");
    fs::create_dir_all(src.join("nested/deep")).unwrap();
    fs::write(src.join("package.json"), br#"{"main":"./nested/deep/main.js"}"#).unwrap();
    fs::write(src.join("nested/deep/main.js"), b"console.log('hi');\n").unwrap();
    fs::write(src.join("nested/deep/marker.txt"), b"sentinel-bytes\n").unwrap();

    let archive = scratch.path().join("out.asar");
    asar::pack(&src, &archive).unwrap();

    let header = asar::read_header(&archive).unwrap();
    let pkg = asar::read_file_from_archive(&archive, &header, "package.json").unwrap();
    assert_eq!(&pkg, br#"{"main":"./nested/deep/main.js"}"#);
    let main = asar::read_file_from_archive(&archive, &header, "nested/deep/main.js").unwrap();
    assert_eq!(&main, b"console.log('hi');\n");
    let sentinel =
        asar::read_file_from_archive(&archive, &header, "nested/deep/marker.txt").unwrap();
    assert_eq!(&sentinel, b"sentinel-bytes\n");
}

#[test]
fn replace_file_grow_shrink_and_preserves_other_entries() {
    let scratch = tempfile::tempdir().unwrap();
    let src = scratch.path().join("src");
    fs::create_dir_all(src.join("nested")).unwrap();
    fs::write(src.join("a.txt"), b"AAAA").unwrap();
    fs::write(src.join("nested/main.js"), b"old-main-body").unwrap();
    fs::write(src.join("z.txt"), b"ZZZZZZ").unwrap();

    let archive = scratch.path().join("out.asar");
    asar::pack(&src, &archive).unwrap();

    asar::replace_file(&archive, "nested/main.js", b"this-is-a-much-larger-replacement").unwrap();
    let h = asar::read_header(&archive).unwrap();
    assert_eq!(
        asar::read_file_from_archive(&archive, &h, "nested/main.js").unwrap(),
        b"this-is-a-much-larger-replacement"
    );
    assert_eq!(asar::read_file_from_archive(&archive, &h, "a.txt").unwrap(), b"AAAA");
    assert_eq!(asar::read_file_from_archive(&archive, &h, "z.txt").unwrap(), b"ZZZZZZ");

    asar::replace_file(&archive, "nested/main.js", b"tiny").unwrap();
    let h = asar::read_header(&archive).unwrap();
    assert_eq!(
        asar::read_file_from_archive(&archive, &h, "nested/main.js").unwrap(),
        b"tiny"
    );
    assert_eq!(asar::read_file_from_archive(&archive, &h, "a.txt").unwrap(), b"AAAA");
    assert_eq!(asar::read_file_from_archive(&archive, &h, "z.txt").unwrap(), b"ZZZZZZ");
}

#[test]
fn replace_file_recomputes_per_file_integrity() {
    use serde_json::json;
    use sha2::{Digest, Sha256};

    fn hex(b: &[u8]) -> String {
        let h = Sha256::digest(b);
        let mut s = String::with_capacity(h.len() * 2);
        for byte in h {
            use std::fmt::Write;
            let _ = write!(s, "{:02x}", byte);
        }
        s
    }

    let scratch = tempfile::tempdir().unwrap();
    let archive = scratch.path().join("integrity.asar");
    let stale = b"OLD";
    let mut content = Vec::new();
    let off = content.len();
    content.extend_from_slice(stale);
    let header = json!({
        "files": {
            "main.js": {
                "size": stale.len(),
                "offset": off.to_string(),
                "integrity": {
                    "algorithm": "SHA256",
                    "hash": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                    "blockSize": 4194304,
                    "blocks": [
                        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
                    ]
                }
            }
        }
    });
    asar::write_archive_for_test(&archive, &header.to_string(), &content).unwrap();

    let new_main = b"NEW-CONTENT-AFTER-PATCH";
    asar::replace_file(&archive, "main.js", new_main).unwrap();

    let h = asar::read_header(&archive).unwrap();
    let entry = h
        .root
        .get("files")
        .and_then(|v| v.get("main.js"))
        .unwrap();
    let integrity = entry.get("integrity").unwrap();
    assert_eq!(integrity.get("hash").and_then(|v| v.as_str()), Some(hex(new_main).as_str()));
    let blocks = integrity.get("blocks").and_then(|v| v.as_array()).unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].as_str(), Some(hex(new_main).as_str()));
    // algorithm + blockSize preserved
    assert_eq!(integrity.get("algorithm").and_then(|v| v.as_str()), Some("SHA256"));
    assert_eq!(integrity.get("blockSize").and_then(|v| v.as_u64()), Some(4194304));
}

#[test]
fn replace_file_preserves_unpacked_entries_in_header() {
    // Hand-craft a header that mixes in-archive and unpacked entries, so we can
    // confirm replace_file leaves `unpacked: true` markers intact (the original
    // pack bug dropped them).
    use serde_json::json;

    let scratch = tempfile::tempdir().unwrap();
    let archive = scratch.path().join("mixed.asar");

    // Build content blob: package.json, main.js, a.txt — `keymapping.node` is
    // unpacked so its bytes do NOT live inside the archive.
    let pkg = br#"{"main":"./main.js"}"#;
    let main_bytes = b"OLD-MAIN";
    let a_bytes = b"after-main-payload";
    let mut content = Vec::new();
    let pkg_off = content.len();
    content.extend_from_slice(pkg);
    let main_off = content.len();
    content.extend_from_slice(main_bytes);
    let a_off = content.len();
    content.extend_from_slice(a_bytes);

    let header = json!({
        "files": {
            "package.json": { "size": pkg.len(), "offset": pkg_off.to_string() },
            "main.js": { "size": main_bytes.len(), "offset": main_off.to_string() },
            "a.txt": { "size": a_bytes.len(), "offset": a_off.to_string() },
            "keymapping.node": { "size": 9999, "unpacked": true },
        }
    });

    asar::write_archive_for_test(&archive, &header.to_string(), &content).unwrap();

    asar::replace_file(&archive, "main.js", b"NEW-MAIN-IS-LONGER").unwrap();

    let h = asar::read_header(&archive).unwrap();
    assert_eq!(
        asar::read_file_from_archive(&archive, &h, "main.js").unwrap(),
        b"NEW-MAIN-IS-LONGER"
    );
    assert_eq!(
        asar::read_file_from_archive(&archive, &h, "package.json").unwrap(),
        pkg
    );
    assert_eq!(
        asar::read_file_from_archive(&archive, &h, "a.txt").unwrap(),
        a_bytes
    );
    let keymap = h
        .root
        .get("files")
        .and_then(|v| v.get("keymapping.node"))
        .expect("keymapping.node entry survived");
    assert_eq!(keymap.get("unpacked").and_then(|v| v.as_bool()), Some(true));
    assert!(keymap.get("offset").is_none(), "unpacked entry must not gain an offset");
}

#[test]
fn integrity_hash_is_deterministic() {
    let scratch = tempfile::tempdir().unwrap();
    let src = scratch.path().join("src");
    fs::create_dir_all(&src).unwrap();
    fs::write(src.join("a.txt"), b"hello").unwrap();
    let archive = scratch.path().join("a.asar");
    asar::pack(&src, &archive).unwrap();
    let h = asar::read_header(&archive).unwrap();
    let i1 = asar::compute_integrity(&archive, &h).unwrap();
    let i2 = asar::compute_integrity(&archive, &h).unwrap();
    assert_eq!(i1.hash, i2.hash);
    assert_eq!(i1.blocks, i2.blocks);
    assert!(!i1.hash.is_empty());
}
