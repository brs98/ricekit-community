#!/usr/bin/env python3
"""Validate and verify RiceKit community content releases."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tarfile
import tomllib
from pathlib import Path, PurePosixPath
from typing import Any


CONTENT_KINDS = {
    "themes": "theme.toml",
    "templates": "config.toml",
    "integrations": "integration.toml",
    "rices": "rice.toml",
}
CONTENT_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
CONTENT_TAG = re.compile(r"^content-v(\d+)\.(\d+)\.(\d+)$")
U32_MAX = (1 << 32) - 1
GITHUB_RELEASE_WINDOW = 30
PUBLICATION_BLOCKER = Path("rices/.publication-blocked")


class ContentError(Exception):
    def __init__(self, path: Path | str, message: str) -> None:
        self.path = Path(path)
        self.message = message
        super().__init__(f"{self.path}: {message}")


def slugs(root: Path, directory: str) -> list[str]:
    content_dir = root / directory
    if not content_dir.is_dir():
        return []
    return sorted(path.name for path in content_dir.iterdir() if path.is_dir())


def validate_version(version: str, schema_major: int) -> tuple[int, int, int]:
    """Match RiceKit's `Version::from_version_str` and compatible-major selection."""
    match = CONTENT_VERSION.fullmatch(version)
    if match is None:
        raise ContentError(
            "version",
            "content version must contain exactly three numeric segments "
            f"(recommended: {schema_major}.YYYYMMDD.GITHUB_RUN_NUMBER)",
        )
    segments = tuple(int(segment) for segment in match.groups())
    if any(segment > U32_MAX for segment in segments):
        raise ContentError("version", "content version segments must fit in unsigned 32-bit integers")
    if schema_major != 2:
        raise ContentError("schema_major", "current RiceKit releases require schema major 2")
    if segments[0] != schema_major:
        raise ContentError(
            "version",
            f"content version major {segments[0]} must match schema major {schema_major}",
        )
    return segments


def check_v1_release_window(releases: Any) -> int:
    """Return the public v1 index, failing before another release would hide it."""
    if not isinstance(releases, list):
        raise ContentError("releases", "GitHub releases response must be an array")

    public_tags: list[str] = []
    for release in releases:
        if not isinstance(release, dict):
            raise ContentError("releases", "each GitHub release must be an object")
        if release.get("draft") is True:
            continue
        tag = release.get("tag_name")
        if not isinstance(tag, str):
            raise ContentError("releases", "each public GitHub release must have a tag_name")
        public_tags.append(tag)

    visible_tags = public_tags[:GITHUB_RELEASE_WINDOW]
    def tag_version(tag: str) -> tuple[int, int, int] | None:
        match = CONTENT_TAG.fullmatch(tag)
        if match is None:
            return None
        segments = tuple(int(segment) for segment in match.groups())
        if any(segment > U32_MAX for segment in segments):
            return None
        return segments

    v1_index = next(
        (
            index
            for index, tag in enumerate(visible_tags)
            if (version := tag_version(tag)) is not None and version[0] == 1
        ),
        None,
    )
    if v1_index is None:
        raise ContentError(
            "releases",
            "no schema-v1 content release is visible in GitHub's first 30 public releases",
        )
    if v1_index >= GITHUB_RELEASE_WINDOW - 1:
        raise ContentError(
            "releases",
            "publishing another release would strand schema-v1 clients; prune superseded "
            "releases or publish a safe v1 keepalive first",
        )
    return v1_index


def require_publication_ready(root: Path) -> None:
    marker = root / PUBLICATION_BLOCKER
    if not marker.exists() and not marker.is_symlink():
        return
    try:
        reason = marker.read_text().strip()
    except OSError as error:
        raise ContentError(marker, f"cannot read publication blocker: {error}") from error
    detail = reason or "acceptance evidence is incomplete"
    raise ContentError(
        marker,
        f"content publication is blocked: {detail}",
    )


def load_toml(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            value = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ContentError(path, f"TOML parse failed: {error}") from error
    if not isinstance(value, dict):
        raise ContentError(path, "TOML document must be a table")
    return value


def _required_string(manifest: dict[str, Any], key: str, path: Path) -> str:
    value = manifest.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ContentError(path, f"{key!r} must be a non-empty string")
    return value


def _string_list(manifest: dict[str, Any], key: str, path: Path) -> list[str]:
    value = manifest.get(key, [])
    if not isinstance(value, list) or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        raise ContentError(path, f"{key!r} must be an array of non-empty strings")
    if len(value) != len(set(value)):
        raise ContentError(path, f"{key!r} must not contain duplicates")
    return value


def _asset_path(rice_dir: Path, reference: str, manifest_path: Path, field: str) -> Path:
    relative = PurePosixPath(reference)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
        raise ContentError(
            manifest_path,
            f"{field} reference must be a confined relative path: {reference!r}",
        )

    candidate = rice_dir.joinpath(*relative.parts)
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(rice_dir.resolve(strict=True))
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        raise ContentError(
            manifest_path,
            f"{field} asset is missing or escapes the Rice directory: {reference!r}",
        ) from error

    if not resolved.is_file() or candidate.is_symlink():
        raise ContentError(
            manifest_path,
            f"{field} asset must be a regular file inside the Rice directory: {reference!r}",
        )
    return candidate


def validate_rice(root: Path, rice_dir: Path) -> dict[str, Any]:
    manifest_path = rice_dir / "rice.toml"
    if not manifest_path.is_file():
        raise ContentError(manifest_path, "missing rice.toml")

    manifest = load_toml(manifest_path)
    slug = _required_string(manifest, "slug", manifest_path)
    _required_string(manifest, "name", manifest_path)
    theme = _required_string(manifest, "theme", manifest_path)
    configs = _string_list(manifest, "configs", manifest_path)
    screenshots = _string_list(manifest, "screenshots", manifest_path)

    description = manifest.get("description")
    if description is not None and (
        not isinstance(description, str) or not description.strip()
    ):
        raise ContentError(
            manifest_path, "'description' must be a non-empty string when set"
        )

    if slug != rice_dir.name:
        raise ContentError(
            manifest_path,
            f"slug {slug!r} must match directory name {rice_dir.name!r}",
        )
    if theme not in slugs(root, "themes"):
        raise ContentError(manifest_path, f"theme reference does not exist: {theme!r}")

    available_configs = set(slugs(root, "templates"))
    for config in configs:
        if config not in available_configs:
            raise ContentError(manifest_path, f"config reference does not exist: {config!r}")

    wallpaper = manifest.get("wallpaper")
    if wallpaper is not None:
        if not isinstance(wallpaper, str) or not wallpaper.strip():
            raise ContentError(manifest_path, "'wallpaper' must be a non-empty string when set")
        _asset_path(rice_dir, wallpaper, manifest_path, "wallpaper")
    for screenshot in screenshots:
        _asset_path(rice_dir, screenshot, manifest_path, "screenshot")

    return manifest


def validate_content(root: Path) -> list[ContentError]:
    errors: list[ContentError] = []
    for directory, manifest_name in CONTENT_KINDS.items():
        content_root = root / directory
        if content_root.is_symlink():
            errors.append(ContentError(content_root, "symlinks are not allowed in release content"))
            continue
        symlinks = [path for path in content_root.rglob("*") if path.is_symlink()]
        errors.extend(
            ContentError(path, "symlinks are not allowed in release content")
            for path in symlinks
        )
        for slug in slugs(root, directory):
            content_dir = root / directory / slug
            if any(content_dir == path or content_dir in path.parents for path in symlinks):
                continue
            manifest_path = content_dir / manifest_name
            try:
                if directory == "rices":
                    validate_rice(root, content_dir)
                elif not manifest_path.is_file():
                    raise ContentError(manifest_path, f"missing {manifest_name}")
                else:
                    load_toml(manifest_path)
            except ContentError as error:
                errors.append(error)
    return errors


def require_valid_content(root: Path) -> None:
    errors = validate_content(root)
    if errors:
        raise errors[0]


def manifest_data(
    root: Path, version: str, schema_major: int, published_at: str
) -> dict[str, Any]:
    validate_version(version, schema_major)
    return {
        "version": version,
        "schema_major": schema_major,
        "themes": slugs(root, "themes"),
        "configs": slugs(root, "templates"),
        "integrations": slugs(root, "integrations"),
        "rices": slugs(root, "rices"),
        "published_at": published_at,
    }


def _release_files(root: Path) -> list[str]:
    files: set[str] = set()
    for directory in CONTENT_KINDS:
        content_dir = root / directory
        if not content_dir.exists():
            continue
        if content_dir.is_symlink():
            raise ContentError(content_dir, "symlinks are not allowed in release content")
        for path in content_dir.rglob("*"):
            if path.is_symlink():
                raise ContentError(path, "symlinks are not allowed in release content")
            if path.is_file():
                files.add(path.relative_to(root).as_posix())
    return sorted(files)


def build_release(
    root: Path,
    output_dir: Path,
    version: str,
    schema_major: int,
    published_at: str,
) -> tuple[Path, Path, Path]:
    require_valid_content(root)
    manifest = manifest_data(root, version, schema_major, published_at)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    tarball_path = output_dir / f"ricekit-content-v{version}.tar.gz"
    with tarfile.open(tarball_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for relative in _release_files(root):
            source = root / relative
            info = archive.gettarinfo(str(source), arcname=relative)
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            with source.open("rb") as handle:
                archive.addfile(info, handle)

        manifest_info = archive.gettarinfo(str(manifest_path), arcname="manifest.json")
        manifest_info.uid = 0
        manifest_info.gid = 0
        manifest_info.uname = ""
        manifest_info.gname = ""
        manifest_info.mtime = 0
        with manifest_path.open("rb") as handle:
            archive.addfile(manifest_info, handle)

    checksum_path = Path(f"{tarball_path}.sha256")
    checksum_path.write_text(hashlib.sha256(tarball_path.read_bytes()).hexdigest() + "\n")
    verify_release(root, manifest_path, tarball_path, checksum_path)
    return manifest_path, tarball_path, checksum_path


def verify_release(
    root: Path,
    manifest_path: Path,
    tarball_path: Path,
    checksum_path: Path | None = None,
) -> None:
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ContentError(manifest_path, f"manifest JSON parse failed: {error}") from error

    version = manifest.get("version")
    schema_major = manifest.get("schema_major")
    if not isinstance(version, str) or not isinstance(schema_major, int):
        raise ContentError(manifest_path, "manifest version and schema_major are required")
    validate_version(version, schema_major)
    expected_name = f"ricekit-content-v{version}.tar.gz"
    if tarball_path.name != expected_name:
        raise ContentError(tarball_path, f"tarball name must be {expected_name!r}")

    expected_lists = {
        "themes": slugs(root, "themes"),
        "configs": slugs(root, "templates"),
        "integrations": slugs(root, "integrations"),
        "rices": slugs(root, "rices"),
    }
    for key, expected in expected_lists.items():
        actual = manifest.get(key)
        if actual != expected:
            raise ContentError(
                manifest_path,
                f"{key!r} must be the sorted release directory list; expected {expected!r}, got {actual!r}",
            )

    expected_files = {"manifest.json", *_release_files(root)}
    expected_directories: set[str] = set()
    for expected_file in expected_files:
        parent = PurePosixPath(expected_file).parent
        while parent != PurePosixPath("."):
            expected_directories.add(parent.as_posix())
            parent = parent.parent

    try:
        with tarfile.open(tarball_path, "r:gz") as archive:
            members = archive.getmembers()
            member_names = [member.name.rstrip("/") for member in members]
            file_names = [member.name.rstrip("/") for member in members if member.isfile()]
            files = set(file_names)
            directories = {
                member.name.rstrip("/") for member in members if member.isdir()
            }
            unsafe = [
                member.name
                for member in members
                if member.issym()
                or member.islnk()
                or not (member.isfile() or member.isdir())
                or PurePosixPath(member.name).is_absolute()
                or ".." in PurePosixPath(member.name).parts
            ]
            if unsafe:
                raise ContentError(tarball_path, f"unsafe archive entries: {unsafe!r}")
            if len(member_names) != len(set(member_names)):
                raise ContentError(tarball_path, "archive contains duplicate entry names")
            unexpected_directories = sorted(directories - expected_directories)
            if unexpected_directories:
                raise ContentError(
                    tarball_path,
                    f"archive contains unexpected directories: {unexpected_directories!r}",
                )
            if files != expected_files:
                missing = sorted(expected_files - files)
                unexpected = sorted(files - expected_files)
                raise ContentError(
                    tarball_path,
                    f"archive file set differs from content root; missing={missing!r}, "
                    f"unexpected={unexpected!r}",
                )

            archived_handle = archive.extractfile("manifest.json")
            if archived_handle is None:
                raise ContentError(tarball_path, "cannot read archived manifest.json")
            archived_manifest = json.load(archived_handle)
            if archived_manifest != manifest:
                raise ContentError(tarball_path, "archived manifest.json differs from release manifest")

        if checksum_path is not None:
            try:
                expected_checksum = checksum_path.read_text().strip()
            except OSError as error:
                raise ContentError(checksum_path, f"checksum read failed: {error}") from error
            actual_checksum = hashlib.sha256(tarball_path.read_bytes()).hexdigest()
            if not re.fullmatch(r"[0-9a-f]{64}", expected_checksum):
                raise ContentError(checksum_path, "checksum must contain one lowercase SHA256 digest")
            if expected_checksum != actual_checksum:
                raise ContentError(checksum_path, "checksum does not match release tarball")
    except (OSError, tarfile.TarError, KeyError, TypeError) as error:
        if isinstance(error, ContentError):
            raise
        raise ContentError(tarball_path, f"release archive verification failed: {error}") from error


def _print_errors(errors: list[ContentError]) -> None:
    for error in errors:
        message = error.message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        path = str(error.path).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error file={path}::{message}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--root", type=Path, default=Path("."))

    build_manifest = subparsers.add_parser("build-manifest")
    build_manifest.add_argument("--root", type=Path, default=Path("."))
    build_manifest.add_argument("--version", required=True)
    build_manifest.add_argument("--schema-major", type=int, required=True)
    build_manifest.add_argument("--published-at", required=True)
    build_manifest.add_argument("--output", type=Path, required=True)

    build = subparsers.add_parser("build-release")
    build.add_argument("--root", type=Path, default=Path("."))
    build.add_argument("--output-dir", type=Path, required=True)
    build.add_argument("--version", required=True)
    build.add_argument("--schema-major", type=int, required=True)
    build.add_argument("--published-at", required=True)

    verify = subparsers.add_parser("verify-release")
    verify.add_argument("--root", type=Path, default=Path("."))
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--tarball", type=Path, required=True)
    verify.add_argument("--checksum", type=Path)

    release_window = subparsers.add_parser("check-v1-release-window")
    release_window.add_argument("--releases-json", type=Path, required=True)

    publication = subparsers.add_parser("check-publication")
    publication.add_argument("--root", type=Path, default=Path("."))

    args = parser.parse_args()
    try:
        if args.command == "validate":
            errors = validate_content(args.root)
            if errors:
                _print_errors(errors)
                print(f"Aborting: {len(errors)} content validation error(s)", file=sys.stderr)
                return 1
        elif args.command == "build-manifest":
            require_valid_content(args.root)
            data = manifest_data(args.root, args.version, args.schema_major, args.published_at)
            args.output.write_text(json.dumps(data, indent=2) + "\n")
            print(json.dumps(data, indent=2))
        elif args.command == "build-release":
            manifest, tarball, checksum = build_release(
                args.root,
                args.output_dir,
                args.version,
                args.schema_major,
                args.published_at,
            )
            print(f"Manifest: {manifest}")
            print(f"Tarball: {tarball}")
            print(f"Checksum: {checksum}")
        elif args.command == "verify-release":
            verify_release(args.root, args.manifest, args.tarball, args.checksum)
        elif args.command == "check-v1-release-window":
            try:
                releases = json.loads(args.releases_json.read_text())
            except (OSError, json.JSONDecodeError) as error:
                raise ContentError(
                    args.releases_json,
                    f"GitHub releases JSON parse failed: {error}",
                ) from error
            index = check_v1_release_window(releases)
            print(f"Latest schema-v1 release is at zero-based public release index {index}.")
        elif args.command == "check-publication":
            require_publication_ready(args.root)
    except ContentError as error:
        _print_errors([error])
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
