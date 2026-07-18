#!/usr/bin/env python3

import hashlib
import importlib.util
import io
import os
import subprocess
import tarfile
import tempfile
import time
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

    def test_v1_release_window_ignores_malformed_v1_tags(self) -> None:
        releases = [
            {"tag_name": "content-v1.backup", "draft": False},
            {"tag_name": "content-v1.2.3.4", "draft": False},
            {"tag_name": "content-v1.9.9", "draft": False},
        ]
        self.assertEqual(release_content.check_v1_release_window(releases), 2)

        with self.assertRaises(release_content.ContentError):
            release_content.check_v1_release_window(releases[:2])

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

    def test_publication_marker_blocks_release(self) -> None:
        marker = self.root / "rices/.publication-blocked"
        marker.parent.mkdir()
        marker.write_text("screenshots are provisional")
        with self.assertRaises(release_content.ContentError) as error:
            release_content.require_publication_ready(self.root)
        self.assertIn("screenshots are provisional", error.exception.message)

        marker.unlink()
        release_content.require_publication_ready(self.root)


class ProductionRiceTests(unittest.TestCase):
    def test_first_party_launch_set_contract(self) -> None:
        root = MODULE_PATH.parent.parent
        errors = release_content.validate_content(root)
        self.assertEqual(errors, [])

        expected = {
            "flexoki-paper": {
                "theme": "flexoki-light",
                "wallpaper": "wallpapers/desktop.png",
                "theme_wallpaper": "themes/flexoki-light/wallpapers/1-flexoki-light-orb.png",
                "configs": ["macos-appearance", "terminal-profile"],
            },
            "kanagawa-wave": {
                "theme": "kanagawa",
                "wallpaper": "wallpapers/desktop.jpg",
                "theme_wallpaper": "themes/kanagawa/wallpapers/1-kanagawa.jpg",
                "configs": [
                    "macos-appearance",
                    "terminal-profile",
                    "ghostty-colors",
                ],
            },
            "osaka-jade-night": {
                "theme": "osaka-jade",
                "wallpaper": "wallpapers/desktop.jpg",
                "theme_wallpaper": "themes/osaka-jade/wallpapers/1-osaka-jade-bg.jpg",
                "configs": ["macos-appearance", "terminal-profile"],
            },
            "osaka-jade-desktop": {
                "theme": "osaka-jade",
                "wallpaper": "wallpapers/desktop.jpg",
                "theme_wallpaper": "themes/osaka-jade/wallpapers/1-osaka-jade-bg.jpg",
                "configs": [
                    "macos-appearance",
                    "terminal-profile",
                    "sketchybar-colors",
                    "jankyborders-colors",
                ],
            },
        }

        for slug, contract in expected.items():
            rice_dir = root / "rices" / slug
            rice = release_content.load_toml(rice_dir / "rice.toml")
            self.assertEqual(rice["slug"], slug)
            self.assertEqual(rice["theme"], contract["theme"])
            self.assertEqual(rice["wallpaper"], contract["wallpaper"])
            self.assertEqual(rice["configs"], contract["configs"])
            self.assertEqual(
                rice["configs"][:2], ["macos-appearance", "terminal-profile"]
            )
            self.assertGreaterEqual(len(rice["screenshots"]), 1)

            wallpaper = rice_dir / rice["wallpaper"]
            theme_wallpaper = root / contract["theme_wallpaper"]
            self.assertTrue(wallpaper.is_file())
            self.assertFalse(wallpaper.is_symlink())
            self.assertEqual(
                hashlib.sha256(wallpaper.read_bytes()).digest(),
                hashlib.sha256(theme_wallpaper.read_bytes()).digest(),
            )
            for screenshot_path in rice["screenshots"]:
                screenshot = rice_dir / screenshot_path
                self.assertTrue(screenshot.is_file())
                self.assertFalse(screenshot.is_symlink())

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
        self.assertEqual(manifest["rices"], sorted(expected))
        self.assertIn("macos-appearance", manifest["configs"])
        self.assertIn("terminal-profile", manifest["configs"])


class DesktopToolTemplateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.bin_dir = self.root / "bin"
        self.state_dir = self.root / "state"
        self.home = self.root / "home"
        self.bin_dir.mkdir()
        self.state_dir.mkdir()
        self.home.mkdir()
        self._write_executable(
            self.bin_dir / "pgrep",
            "#!/bin/sh\ntest -f \"$FAKE_TOOL_STATE/ready\"\n",
        )
        self._write_executable(
            self.bin_dir / "launchctl",
            "#!/bin/sh\ntest -f \"$FAKE_TOOL_STATE/service\" || exit 1\nprintf '\\t\"git.felix.borders\" = {\\n'\n",
        )

    def tearDown(self) -> None:
        daemon_pid = self.state_dir / "daemon-pid"
        if daemon_pid.is_file():
            try:
                pid = int(daemon_pid.read_text())
                os.kill(pid, 15)
                for _ in range(20):
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.01)
                else:
                    os.kill(pid, 9)
            except (ProcessLookupError, ValueError):
                pass
        self.temp.cleanup()

    def _write_executable(self, path: Path, content: str) -> None:
        path.write_text(content)
        path.chmod(0o755)

    def _environment(self, override: str, binary: Path) -> dict[str, str]:
        return {
            **os.environ,
            "HOME": str(self.home),
            "PATH": f"{self.bin_dir}:/usr/bin:/bin",
            "FAKE_TOOL_STATE": str(self.state_dir),
            override: str(binary),
        }

    def _run(self, script: Path, environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/bin/sh", str(script)],
            env=environment,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

    def test_sketchybar_starter_uses_an_honest_static_status_label(self) -> None:
        manifest = release_content.load_toml(
            MODULE_PATH.parent.parent / "templates/sketchybar-colors/config.toml"
        )
        starter = manifest["setup"]["actions"][0]["content"]

        self.assertIn('label="Theme active"', starter)
        self.assertNotIn("$(date", starter)

    def test_sketchybar_starts_then_verifies_and_reloads(self) -> None:
        fake = self.bin_dir / "sketchybar"
        self._write_executable(
            fake,
            """#!/bin/sh
case "${1:-}" in
  --query)
    test -f "$FAKE_TOOL_STATE/ready" || exit 1
    printf '{"name":"%s"}\n' "${2:-bar}"
    ;;
  --reload)
    printf '%s\n' "${2:-}" > "$FAKE_TOOL_STATE/reload-path"
    touch "$FAKE_TOOL_STATE/reloaded"
    ;;
  *)
    touch "$FAKE_TOOL_STATE/ready"
    printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
    exec sleep 30
    ;;
esac
""",
        )
        script = MODULE_PATH.parent.parent / "templates/sketchybar-colors/templates/ricekit-start.sh"
        environment = self._environment("RICEKIT_SKETCHYBAR_BIN", fake)
        config_dir = self.home / ".config/sketchybar"
        config_dir.mkdir(parents=True)
        (config_dir / "sketchybarrc").write_text(
            '"$SKETCHYBAR_BIN" --add item ricekit.brand left\n'
        )

        started = self._run(script, environment)
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertTrue((self.state_dir / "ready").is_file())

        reloaded = self._run(script, environment)
        self.assertEqual(reloaded.returncode, 0, reloaded.stderr)
        self.assertTrue((self.state_dir / "reloaded").is_file())
        self.assertEqual(
            (self.state_dir / "reload-path").read_text().strip(),
            str(config_dir / "sketchybarrc"),
        )

    def test_sketchybar_custom_config_requires_only_a_responsive_bar(self) -> None:
        fake = self.bin_dir / "sketchybar"
        self._write_executable(
            fake,
            """#!/bin/sh
case "${1:-}" in
  --query)
    printf '%s\n' "${2:-bar}" >> "$FAKE_TOOL_STATE/queries"
    test "${2:-}" = "bar" || exit 1
    test -f "$FAKE_TOOL_STATE/ready" || exit 1
    printf '{"name":"bar"}\n'
    ;;
  *)
    touch "$FAKE_TOOL_STATE/ready"
    printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
    exec sleep 30
    ;;
esac
""",
        )
        config_dir = self.home / ".config/sketchybar"
        config_dir.mkdir(parents=True)
        (config_dir / "sketchybarrc").write_text("#!/usr/bin/env lua\n")
        script = MODULE_PATH.parent.parent / "templates/sketchybar-colors/templates/ricekit-start.sh"
        environment = self._environment("RICEKIT_SKETCHYBAR_BIN", fake)

        result = self._run(script, environment)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("ricekit.brand", (self.state_dir / "queries").read_text())

    def test_sketchybar_running_custom_config_keeps_its_current_reload_path(self) -> None:
        fake = self.bin_dir / "sketchybar"
        self._write_executable(
            fake,
            """#!/bin/sh
case "${1:-}" in
  --query)
    test "${2:-}" = "bar" || exit 1
    printf '{"name":"bar"}\n'
    ;;
  --reload) printf '%s\n' "${2:-}" > "$FAKE_TOOL_STATE/reload-path" ;;
  *) exit 1 ;;
esac
""",
        )
        (self.state_dir / "ready").touch()
        config_dir = self.home / ".config/sketchybar"
        config_dir.mkdir(parents=True)
        (config_dir / "sketchybarrc").write_text("#!/usr/bin/env lua\n")
        script = MODULE_PATH.parent.parent / "templates/sketchybar-colors/templates/ricekit-start.sh"
        environment = self._environment("RICEKIT_SKETCHYBAR_BIN", fake)

        result = self._run(script, environment)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.state_dir / "reload-path").read_text(), "\n")

    def test_sketchybar_starter_requires_its_brand_item(self) -> None:
        fake = self.bin_dir / "sketchybar"
        self._write_executable(
            fake,
            """#!/bin/sh
case "${1:-}" in
  --query)
    test -f "$FAKE_TOOL_STATE/ready" || exit 1
    test "${2:-}" = "bar" || exit 0
    printf '{"name":"bar"}\n'
    ;;
  *)
    touch "$FAKE_TOOL_STATE/ready"
    printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
    exec sleep 30
    ;;
esac
""",
        )
        config_dir = self.home / ".config/sketchybar"
        config_dir.mkdir(parents=True)
        (config_dir / "sketchybarrc").write_text(
            '"$SKETCHYBAR_BIN" --add item ricekit.brand left\n'
        )
        script = MODULE_PATH.parent.parent / "templates/sketchybar-colors/templates/ricekit-start.sh"
        environment = self._environment("RICEKIT_SKETCHYBAR_BIN", fake)

        result = self._run(script, environment)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("did not become queryable", result.stderr)

    def test_sketchybar_does_not_accept_an_empty_successful_query(self) -> None:
        fake = self.bin_dir / "sketchybar"
        self._write_executable(
            fake,
            """#!/bin/sh
case "${1:-}" in
  --query|--reload) exit 0 ;;
  *) touch "$FAKE_TOOL_STATE/started"; touch "$FAKE_TOOL_STATE/ready" ;;
esac
""",
        )
        script = MODULE_PATH.parent.parent / "templates/sketchybar-colors/templates/ricekit-start.sh"
        environment = self._environment("RICEKIT_SKETCHYBAR_BIN", fake)

        result = self._run(script, environment)

        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.state_dir / "started").is_file())
        self.assertIn("exited before its bar became queryable", result.stderr)

    def test_sketchybar_bounds_a_hung_query(self) -> None:
        fake = self.bin_dir / "sketchybar"
        self._write_executable(
            fake,
            """#!/bin/sh
if [ "${1:-}" = "--query" ]; then
  exec sleep 30
fi
  touch "$FAKE_TOOL_STATE/ready"
  printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
  exec sleep 30
""",
        )
        script = MODULE_PATH.parent.parent / "templates/sketchybar-colors/templates/ricekit-start.sh"
        environment = self._environment("RICEKIT_SKETCHYBAR_BIN", fake)

        result = self._run(script, environment)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("did not become queryable", result.stderr)

    def test_sketchybar_rejects_an_unavailable_explicit_binary(self) -> None:
        script = MODULE_PATH.parent.parent / "templates/sketchybar-colors/templates/ricekit-start.sh"
        environment = self._environment(
            "RICEKIT_SKETCHYBAR_BIN", self.bin_dir / "missing-sketchybar"
        )

        result = self._run(script, environment)

        self.assertEqual(result.returncode, 127)
        self.assertIn("SketchyBar is unavailable", result.stderr)

    def test_jankyborders_starts_then_updates_without_killing(self) -> None:
        fake = self.bin_dir / "borders"
        self._write_executable(
            fake,
            """#!/bin/sh
if [ ! -f "$FAKE_TOOL_STATE/ready" ]; then
  touch "$FAKE_TOOL_STATE/ready"
  touch "$FAKE_TOOL_STATE/service"
  printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
  exec sleep 30
fi
touch "$FAKE_TOOL_STATE/invoked"
""",
        )
        script = MODULE_PATH.parent.parent / "templates/jankyborders-colors/templates/borders.sh"
        environment = self._environment("RICEKIT_BORDERS_BIN", fake)

        started = self._run(script, environment)
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertTrue((self.state_dir / "ready").is_file())

        updated = self._run(script, environment)
        self.assertEqual(updated.returncode, 0, updated.stderr)
        self.assertTrue((self.state_dir / "invoked").is_file())
        self.assertNotIn("pkill", script.read_text())

    def test_jankyborders_rejects_a_process_without_a_responsive_server(self) -> None:
        fake = self.bin_dir / "borders"
        self._write_executable(
            fake,
            """#!/bin/sh
touch "$FAKE_TOOL_STATE/ready"
printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
exec sleep 30
""",
        )
        script = MODULE_PATH.parent.parent / "templates/jankyborders-colors/templates/borders.sh"
        environment = self._environment("RICEKIT_BORDERS_BIN", fake)

        result = self._run(script, environment)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("did not register its update endpoint", result.stderr)

    def test_jankyborders_waits_for_delayed_endpoint_registration(self) -> None:
        fake = self.bin_dir / "borders"
        self._write_executable(
            fake,
            """#!/bin/sh
if [ ! -f "$FAKE_TOOL_STATE/ready" ]; then
  touch "$FAKE_TOOL_STATE/ready"
  printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
  (sleep 0.6; touch "$FAKE_TOOL_STATE/service") &
  exec sleep 30
fi
touch "$FAKE_TOOL_STATE/invoked"
""",
        )
        script = MODULE_PATH.parent.parent / "templates/jankyborders-colors/templates/borders.sh"
        environment = self._environment("RICEKIT_BORDERS_BIN", fake)

        result = self._run(script, environment)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.state_dir / "invoked").is_file())

    def test_jankyborders_bounds_a_hung_update_after_endpoint_registration(self) -> None:
        fake = self.bin_dir / "borders"
        self._write_executable(
            fake,
            """#!/bin/sh
if [ ! -f "$FAKE_TOOL_STATE/ready" ]; then
  touch "$FAKE_TOOL_STATE/ready"
  touch "$FAKE_TOOL_STATE/service"
  printf '%s\n' "$$" > "$FAKE_TOOL_STATE/daemon-pid"
  exec sleep 30
fi
exec sleep 30
""",
        )
        script = MODULE_PATH.parent.parent / "templates/jankyborders-colors/templates/borders.sh"
        environment = self._environment("RICEKIT_BORDERS_BIN", fake)

        started_at = time.monotonic()
        result = self._run(script, environment)
        elapsed = time.monotonic() - started_at

        self.assertNotEqual(result.returncode, 0)
        self.assertLess(elapsed, 5)
        self.assertIn("did not accept the color update", result.stderr)

    def test_jankyborders_rejects_an_unavailable_explicit_binary(self) -> None:
        script = MODULE_PATH.parent.parent / "templates/jankyborders-colors/templates/borders.sh"
        environment = self._environment(
            "RICEKIT_BORDERS_BIN", self.bin_dir / "missing-borders"
        )

        result = self._run(script, environment)

        self.assertEqual(result.returncode, 127)
        self.assertIn("JankyBorders is unavailable", result.stderr)


if __name__ == "__main__":
    unittest.main()
