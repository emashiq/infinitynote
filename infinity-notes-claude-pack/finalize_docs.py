#!/usr/bin/env python3
"""Organize workflow-owned files after verified completion; preserve user data."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys


def write_json(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def organize(repo):
    repo = repo.resolve()
    archive = repo / "docs/development"
    for path in (repo / "docs", archive):
        if path.exists() and (path.is_symlink() or not path.is_dir()):
            raise ValueError("Refusing non-directory/symlink destination: " + str(path))
        if not path.resolve().is_relative_to(repo):
            raise ValueError("Destination escaped repository")
    manifest_path = archive / "cleanup-manifest.json"
    for path in (manifest_path, repo / ".gitignore", repo / "README.md", repo / "CLAUDE.md", repo / "docs/INDEX.md"):
        if path.is_symlink():
            raise ValueError("Refusing to rewrite symlink: " + str(path))
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("workflow") != "infinity-notes":
            raise ValueError("Existing cleanup manifest belongs to another workflow")
        if manifest.get("status") == "complete":
            print("Final documentation is already organized.")
            return
    else:
        manifest = {"workflow": "infinity-notes", "status": "in_progress", "moves": [], "removed": []}
    state_path = None
    for base in (repo / ".infinity-work", archive / "run-evidence"):
        for filename in ("agent-status.json", "status.json"):
            candidate = base / filename
            if candidate.exists():
                state_path = candidate
                break
        if state_path:
            break
    if not state_path:
        raise ValueError("No workflow completion checkpoint found")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state.get("result") != "complete" or any(state.get("phases", {}).get(f"{i:02}", {}).get("status") != "accepted" for i in range(10)):
        raise ValueError("Keep active files in place: all phases/native validation must be accepted first")
    for filename in ("FINAL_REPORT.md", "NATIVE_OS_MATRIX.md", "RELEASE_CHECKLIST.md"):
        path = repo / "docs" / filename
        if not path.is_file() or not path.stat().st_size:
            raise ValueError("Required final documentation missing: " + filename)
    pairs = [("infinity-notes-claude-pack", "docs/development/claude-pack"),
             ("docs/plans", "docs/development/plans"),
             ("docs/progress", "docs/development/progress"),
             (".infinity-work", "docs/development/run-evidence")]
    moves = manifest["moves"] or [{"from": s, "to": d, "done": False} for s, d in pairs if (repo / s).exists()]
    # Preflight every move before modifying any source.
    for move in moves:
        source, target = repo / move["from"], repo / move["to"]
        for p in (source, target):
            if p.is_symlink() or not p.resolve().is_relative_to(repo):
                raise ValueError("Refusing symlink/outside-repository move: " + str(p))
        if source.exists() and target.exists():
            raise ValueError("Cleanup destination conflict; nothing overwritten: " + move["to"])
        if not source.exists() and not target.exists():
            raise ValueError("Cleanup source and destination both missing: " + move["from"])
    archive.mkdir(parents=True, exist_ok=True)
    manifest["moves"] = moves
    write_json(manifest_path, manifest)
    for move in moves:
        source, target = repo / move["from"], repo / move["to"]
        if source.exists():
            source.rename(target)
        move["done"] = True
        write_json(manifest_path, manifest)
    replacements = [(s + "/", d + "/") for s, d in pairs]
    def replace_paths(text):
        for old, new in replacements:
            text = text.replace(old, new)
        return text
    # Keep raw logs and the archived prompt pack unchanged as historical evidence.
    paths = [repo / "README.md", repo / "CLAUDE.md"]
    paths += [p for p in (repo / "docs").rglob("*.md") if not p.is_relative_to(archive / "run-evidence") and not p.is_relative_to(archive / "claude-pack")]
    for path in paths:
        if path.is_file() and not path.is_symlink():
            content = path.read_text(encoding="utf-8")
            updated = replace_paths(content)
            if updated != content:
                path.write_text(updated, encoding="utf-8")
    state_path = archive / "run-evidence" / state_path.name
    def rewrite(value):
        if isinstance(value, str):
            return replace_paths(value)
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if isinstance(value, dict):
            return {k: rewrite(v) for k, v in value.items()}
        return value
    write_json(state_path, rewrite(state))
    for relative in ("docs/development/claude-pack/__pycache__", "docs/development/run-evidence/status.json.tmp"):
        path = repo / relative
        if path.is_symlink():
            raise ValueError("Refusing symlink temporary file: " + relative)
        if path.exists():
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            manifest["removed"].append(relative)
    ignore = repo / ".gitignore"
    text = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
    if "docs/development/run-evidence/" not in text.splitlines():
        ignore.write_text(text.rstrip() + "\n\n# Private Infinity Notes development evidence\ndocs/development/run-evidence/\n", encoding="utf-8")
    start, end = "<!-- infinity-docs:start -->", "<!-- infinity-docs:end -->"
    links = [f"- [{p.name}]({p.name})" for p in sorted((repo / "docs").glob("*.md")) if p.name != "INDEX.md"]
    links += ["- [Development prompt archive](development/claude-pack/README.md)",
              "- [Cleanup manifest](development/cleanup-manifest.json)"]
    section = start + "\n# Infinity Notes documentation\n\n" + "\n".join(links) + "\n\nPhase plans and progress live under development/. Private raw evidence is preserved under development/run-evidence/ and excluded from git. Original paths in raw logs are historical; the cleanup manifest maps them to current locations.\n" + end
    index = repo / "docs/INDEX.md"
    original = index.read_text(encoding="utf-8") if index.exists() else ""
    if start in original and end in original:
        before, rest = original.split(start, 1)
        _, after = rest.split(end, 1)
        original = before + section + after
    else:
        original = original.rstrip() + ("\n\n" if original else "") + section + "\n"
    index.write_text(original, encoding="utf-8")
    readme = repo / "README.md"
    if readme.exists() and "docs/INDEX.md" not in readme.read_text(encoding="utf-8"):
        with readme.open("a", encoding="utf-8") as f:
            f.write("\nDocumentation: [docs/INDEX.md](docs/INDEX.md).\n")
    manifest["status"] = "complete"
    manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    write_json(manifest_path, manifest)
    print("Final prompts, plans and evidence organized under docs/development/. Temporary workflow files cleaned.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        organize(args.repo)
        return 0
    except (ValueError, OSError, KeyError) as exc:
        print("Cleanup blocked: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
