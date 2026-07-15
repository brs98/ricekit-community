#!/usr/bin/env python3

import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("release_content.py")
SPEC = importlib.util.spec_from_file_location("release_content", MODULE_PATH)
release_content = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(release_content)


class ReleaseContentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self._write("themes/zulu/theme.toml", "[metadata]\nname = 'Zulu'\n")
        self._write("themes/alpha/theme.toml", "[metadata]\nname = 'Alpha'\n")
        self._write("templates/terminal/config.toml", "[metadata]\nname = 'Terminal'\n")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write(self, relative: str, content: str | bytes) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content)

    def _add_tracer(self, *, screenshot: str = "screenshots/desktop.png") -> None:
        self._write(
            "rices/tracer/rice.toml",
            "\n".join(
                [
                    "slug = 'tracer'",
                    "name = 'Tracer Rice'",
                    "theme = 'alpha'",
                    "wallpaper = 'wallpapers/desktop.jpg'",
                    "configs = ['terminal']",
                    f"screenshots = ['{screenshot}']",
                    "",
                ]
            ),
        )
        self._write("rices/tracer/wallpapers/desktop.jpg", b"wallpaper")
        if ".." not in screenshot:
            self._write(f"rices/tracer/{screenshot}", b"screenshot")

    def test_manifest_lists_all_item_kinds_in_sorted_order(self) -> None:
        self._add_tracer()
        data = release_content.manifest_data(
            self.root, "2.20260714.42", 2, "2026-07-14T00:00:00Z"
        )
        self.assertEqual(data["themes"], ["alpha", "zulu"])
        self.assertEqual(data["configs"], ["terminal"])
        self.assertEqual(data["integrations"], [])
        self.assertEqual(data["rices"], ["tracer"])

    def test_manifest_without_rices_keeps_existing_item_arrays(self) -> None:
        data = release_content.manifest_data(
            self.root, "2.20260714.42", 2, "2026-07-14T00:00:00Z"
        )
        self.assertEqual(data["themes"], ["alpha", "zulu"])
        self.assertEqual(data["configs"], ["terminal"])
        self.assertEqual(data["integrations"], [])
        self.assertEqual(data["rices"], [])

    def test_missing_rice_manifest_reports_actionable_path(self) -> None:
        (self.root / "rices" / "broken").mkdir(parents=True)
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].path, self.root / "rices/broken/rice.toml")
        self.assertEqual(errors[0].message, "missing rice.toml")

    def test_invalid_rice_toml_reports_actionable_path(self) -> None:
        self._write("rices/broken/rice.toml", "this = [")
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].path, self.root / "rices/broken/rice.toml")
        self.assertIn("TOML parse failed", errors[0].message)

    def test_missing_reference_fails_validation(self) -> None:
        self._add_tracer()
        (self.root / "rices/tracer/screenshots/desktop.png").unlink()
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("screenshot asset is missing", errors[0].message)

    def test_missing_theme_and_config_references_fail_validation(self) -> None:
        self._add_tracer()
        manifest = self.root / "rices/tracer/rice.toml"
        manifest.write_text(
            manifest.read_text()
            .replace("theme = 'alpha'", "theme = 'missing-theme'")
            .replace("configs = ['terminal']", "configs = ['missing-config']")
        )
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("theme reference does not exist", errors[0].message)

        manifest.write_text(manifest.read_text().replace("missing-theme", "alpha"))
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("config reference does not exist", errors[0].message)

    def test_traversing_asset_reference_fails_validation(self) -> None:
        self._add_tracer(screenshot="../outside.png")
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("confined relative path", errors[0].message)

    def test_symlink_in_rice_content_fails_validation(self) -> None:
        self._add_tracer()
        target = self.root / "rices/tracer/screenshots/desktop.png"
        target.unlink()
        target.symlink_to(self.root / "themes/alpha/theme.toml")
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("symlinks are not allowed", errors[0].message)

    def test_symlink_in_non_rice_content_fails_validation(self) -> None:
        target = self.root / "templates/terminal/templates/theme.conf"
        target.parent.mkdir(parents=True)
        target.symlink_to(self.root / "themes/alpha/theme.toml")
        errors = release_content.validate_content(self.root)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].path, target)
        self.assertIn("symlinks are not allowed", errors[0].message)

    def test_build_release_packages_manifest_content_and_checksum(self) -> None:
        self._add_tracer()
        output = self.root / "dist"
        manifest, tarball, checksum = release_content.build_release(
            self.root,
            output,
            "2.20260714.42",
            2,
            "2026-07-14T00:00:00Z",
        )
        self.assertEqual(tarball.name, "ricekit-content-v2.20260714.42.tar.gz")
        self.assertEqual(checksum.name, f"{tarball.name}.sha256")
        release_content.verify_release(self.root, manifest, tarball, checksum)

        checksum.write_text("0" * 64 + "\n")
        with self.assertRaises(release_content.ContentError) as error:
            release_content.verify_release(self.root, manifest, tarball, checksum)
        self.assertIn("checksum does not match", error.exception.message)

        checksum.write_text(hashlib.sha256(tarball.read_bytes()).hexdigest().upper())
        with self.assertRaises(release_content.ContentError) as error:
            release_content.verify_release(self.root, manifest, tarball, checksum)
        self.assertIn("lowercase SHA256", error.exception.message)

    def test_verify_release_rejects_unsafe_archive_member(self) -> None:
        self._add_tracer()
        output = self.root / "dist"
        manifest, tarball, checksum = release_content.build_release(
            self.root,
            output,
            "2.20260714.42",
            2,
            "2026-07-14T00:00:00Z",
        )
        with tarfile.open(tarball, "w:gz") as archive:
            info = tarfile.TarInfo("../escape")
            info.size = 1
            archive.addfile(info, io.BytesIO(b"x"))
        checksum.write_text("0" * 64 + "\n")
        with self.assertRaises(release_content.ContentError) as error:
            release_content.verify_release(self.root, manifest, tarball, checksum)
        self.assertIn("unsafe archive entries", error.exception.message)

    def test_verify_release_rejects_special_archive_member(self) -> None:
        self._add_tracer()
        output = self.root / "dist"
        manifest, tarball, checksum = release_content.build_release(
            self.root,
            output,
            "2.20260714.42",
            2,
            "2026-07-14T00:00:00Z",
        )
        with tarfile.open(tarball, "w:gz") as archive:
            info = tarfile.TarInfo("named-pipe")
            info.type = tarfile.FIFOTYPE
            archive.addfile(info)
        with self.assertRaises(release_content.ContentError) as error:
            release_content.verify_release(self.root, manifest, tarball, checksum)
        self.assertIn("unsafe archive entries", error.exception.message)

    def test_verify_release_rejects_duplicate_directory_entries(self) -> None:
        self._add_tracer()
        output = self.root / "dist"
        manifest, tarball, checksum = release_content.build_release(
            self.root,
            output,
            "2.20260714.42",
            2,
            "2026-07-14T00:00:00Z",
        )
        with tarfile.open(tarball, "w:gz") as archive:
            for _ in range(2):
                info = tarfile.TarInfo("themes/")
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
        with self.assertRaises(release_content.ContentError) as error:
            release_content.verify_release(self.root, manifest, tarball, checksum)
        self.assertIn("duplicate entry names", error.exception.message)

    def test_verify_release_rejects_unexpected_directory(self) -> None:
        self._add_tracer()
        output = self.root / "dist"
        manifest, tarball, checksum = release_content.build_release(
            self.root,
            output,
            "2.20260714.42",
            2,
            "2026-07-14T00:00:00Z",
        )
        with tarfile.open(tarball, "w:gz") as archive:
            info = tarfile.TarInfo("private/")
            info.type = tarfile.DIRTYPE
            archive.addfile(info)
        with self.assertRaises(release_content.ContentError) as error:
            release_content.verify_release(self.root, manifest, tarball, checksum)
        self.assertIn("unexpected directories", error.exception.message)

    def test_build_release_remains_compatible_without_rices_directory(self) -> None:
        output = self.root / "dist"
        manifest, tarball, checksum = release_content.build_release(
            self.root,
            output,
            "2.20260714.42",
            2,
            "2026-07-14T00:00:00Z",
        )
        self.assertIn('"rices": []', manifest.read_text())
        release_content.verify_release(self.root, manifest, tarball, checksum)

    def test_version_matches_ricekit_three_segment_selection_contract(self) -> None:
        self.assertEqual(
            release_content.validate_version("2.20260714.42", 2),
            (2, 20260714, 42),
        )
        for version in (
            "2026.07.14.0000",
            "2.20260714",
            "2.20260714.42.1",
            "content-v2.20260714.42",
            "2.20260714.run",
        ):
            with self.subTest(version=version):
                with self.assertRaises(release_content.ContentError):
                    release_content.validate_version(version, 2)

        with self.assertRaises(release_content.ContentError):
            release_content.validate_version("1.20260714.42", 2)
        with self.assertRaises(release_content.ContentError):
            release_content.validate_version("2.20260714.42", 1)

    def test_v1_release_window_ignores_drafts(self) -> None:
        releases = [
            {"tag_name": "draft-v9.0.0", "draft": True},
            {"tag_name": "content-v2.0.0", "draft": False},
            {"tag_name": "content-v1.9.9", "draft": False},
        ]
        self.assertEqual(release_content.check_v1_release_window(releases), 1)

    def test_v1_release_window_accepts_public_index_28(self) -> None:
        releases = [
            {"tag_name": f"content-v2.0.{index}", "draft": False}
            for index in range(28)
        ]
        releases.append({"tag_name": "content-v1.9.9", "draft": False})
        self.assertEqual(release_content.check_v1_release_window(releases), 28)

    def test_v1_release_window_rejects_public_index_29(self) -> None:
        releases = [
            {"tag_name": f"content-v2.0.{index}", "draft": False}
            for index in range(29)
        ]
        releases.append({"tag_name": "content-v1.9.9", "draft": False})
        with self.assertRaises(release_content.ContentError) as error:
            release_content.check_v1_release_window(releases)
        self.assertIn("would strand schema-v1 clients", error.exception.message)

    def test_v1_release_window_rejects_missing_v1(self) -> None:
        releases = [
            {"tag_name": f"content-v2.0.{index}", "draft": False}
            for index in range(30)
        ]
        with self.assertRaises(release_content.ContentError) as error:
            release_content.check_v1_release_window(releases)
        self.assertIn("no schema-v1 content release", error.exception.message)


class ProductionTracerTests(unittest.TestCase):
    def test_kanagawa_wave_native_contract_is_release_ready(self) -> None:
        root = MODULE_PATH.parent.parent
        errors = release_content.validate_content(root)
        self.assertEqual(errors, [])

        rice_dir = root / "rices/kanagawa-wave"
        rice = release_content.load_toml(rice_dir / "rice.toml")
        self.assertEqual(rice["slug"], "kanagawa-wave")
        self.assertEqual(rice["theme"], "kanagawa")
        self.assertEqual(
            rice["configs"],
            ["macos-appearance", "terminal-profile", "ghostty-colors"],
        )
        self.assertEqual(rice["screenshots"], ["screenshots/desktop.png"])
        screenshot = rice_dir / rice["screenshots"][0]
        self.assertTrue(screenshot.is_file())
        self.assertFalse(screenshot.is_symlink())
        self.assertTrue((root / "themes/kanagawa/wallpapers/1-kanagawa.jpg").is_file())

        appearance = release_content.load_toml(
            root / "templates/macos-appearance/config.toml"
        )
        self.assertNotIn("target", appearance)
        self.assertEqual(
            appearance["native_target"]["macos"],
            {
                "backend": "appearance",
                "sync_light_dark": True,
                "sync_accent_color": True,
                "sync_highlight_color": False,
            },
        )

        terminal = release_content.load_toml(
            root / "templates/terminal-profile/config.toml"
        )
        self.assertNotIn("target", terminal)
        self.assertEqual(
            terminal["native_target"]["macos"],
            {"backend": "terminal_profile"},
        )

        manifest = release_content.manifest_data(
            root, "2.19700101.1", 2, "1970-01-01T00:00:00Z"
        )
        self.assertIn("kanagawa-wave", manifest["rices"])
        self.assertIn("macos-appearance", manifest["configs"])
        self.assertIn("terminal-profile", manifest["configs"])


if __name__ == "__main__":
    unittest.main()
