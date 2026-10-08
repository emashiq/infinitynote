#!/usr/bin/env python3
"""Launch one autonomous Claude Code coordinator with explicitly configured agents."""
import argparse
import atexit
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

PACK = Path(__file__).resolve().parent


def definitions():
    agents = {}
    for name, role, model, effort in [
        ("infinity-planner", "planner", "claude-opus-5-5", "high"),
        ("infinity-code-low", "implementer", "claude-sonnet-5-5", "low"),
        ("infinity-code-medium", "implementer", "claude-sonnet-5-5", "medium"),
        ("infinity-qa", "qa", "claude-sonnet-5-5", "medium"),
        ("infinity-acceptor", "acceptor", "claude-opus-5-5", "high")
    ]:
        agents[name] = {"description": "Infinity Notes " + role + " at " + effort + " effort",
                        "prompt": (PACK / "roles" / (role + ".md")).read_text(encoding="utf-8"),
                        "model": model, "effort": effort, "permissionMode": "acceptEdits",
                        "maxTurns": 100, "tools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch"]}
    return agents


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-turns", type=int, default=200)
    parser.add_argument("--call-budget-usd", type=float)
    args = parser.parse_args()
    if args.max_turns < 1 or (args.call_budget_usd is not None and args.call_budget_usd <= 0):
        parser.error("Turns/budget must be positive.")
    if args.dry_run:
        print(json.dumps({name: {"model": a["model"], "effort": a["effort"]} for name, a in definitions().items()}, indent=2))
        print("No model calls or file changes.")
        return 0
    if os.environ.get("CLAUDECODE"):
        print("Run this launcher from a normal terminal, outside an existing Claude session.", file=sys.stderr)
        return 1
    claude = shutil.which("claude")
    if not claude:
        print("Install/sign in to Claude Code and establish project trust first.", file=sys.stderr)
        return 1
    if os.name == "nt" and Path(claude).suffix.lower() in {".cmd", ".bat"}:
        print("Use the native Claude Code Windows executable.", file=sys.stderr)
        return 1
    work = Path.cwd() / ".infinity-work"
    work.mkdir(exist_ok=True)
    lock = work / "controller.lock"
    token = str(uuid.uuid4())
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        print("A controller lock exists. Do not run both workflows concurrently; verify no process is active before removing a stale lock.", file=sys.stderr)
        return 1
    with os.fdopen(fd, "w") as f:
        f.write(token)
    def release_lock():
        for path in (lock, Path.cwd() / "docs/development/run-evidence/controller.lock"):
            try:
                if path.is_file() and path.read_text() == token:
                    path.unlink()
            except OSError:
                pass
    atexit.register(release_lock)
    schema = {"type": "object", "additionalProperties": False, "properties": {
        "status": {"type": "string", "enum": ["complete", "ready_for_os_validation", "blocked"]},
        "summary": {"type": "string"}, "evidence": {"type": "array", "items": {"type": "string"}},
        "blockers": {"type": "array", "items": {"type": "string"}}}, "required": ["status", "summary", "evidence", "blockers"]}
    allowed = ["Read", "Write", "Edit", "Glob", "Grep", "Agent", "Bash(npm install)", "Bash(npm ci)", "Bash(npm run *)",
               "Bash(node --version)", "Bash(npm --version)", "Bash(git status *)", "Bash(git diff *)",
               "Bash(python infinity-notes-claude-pack/finalize_docs.py --repo .)",
               "Bash(py -3 infinity-notes-claude-pack/finalize_docs.py --repo .)", "WebFetch"]
    command = [claude, "-p", "--model", "claude-opus-5-5", "--effort", "high", "--agents", json.dumps(definitions()),
               "--permission-mode", "acceptEdits", "--output-format", "json", "--json-schema", json.dumps(schema),
               "--max-turns", str(args.max_turns), "--allowedTools", *allowed]
    if args.call_budget_usd is not None:
        command += ["--max-budget-usd", str(args.call_budget_usd)]
    env = os.environ.copy()
    for key in ("CLAUDE_CODE_EFFORT_LEVEL", "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"):
        env.pop(key, None)
    print("Autonomous Opus coordinator running; Sonnet agents implement/test. Check .infinity-work/agent-status.json for progress.", flush=True)
    prompt = (PACK / "AUTONOMOUS_AGENT_PROMPT.md").read_text(encoding="utf-8")
    try:
        run = subprocess.run(command, input=prompt, text=True, encoding="utf-8", errors="replace", capture_output=True, env=env)
    except KeyboardInterrupt:
        print("Interrupted; on-disk phase progress remains available for resume.", file=sys.stderr)
        return 130
    # The finalizer may already have moved the active evidence directory.
    destination = Path.cwd() / "docs/development/run-evidence" if (Path.cwd() / "docs/development/run-evidence").is_dir() else work
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "autonomous-result.json").write_text(run.stdout, encoding="utf-8")
    (destination / "autonomous-stderr.log").write_text(run.stderr, encoding="utf-8")
    if run.returncode:
        print("Claude stopped; inspect saved output and resume after resolving the reported prerequisite.", file=sys.stderr)
        return 1
    try:
        result = json.loads(run.stdout)
        if result.get("is_error"):
            raise ValueError("Claude execution error")
        usage = result.get("modelUsage", {})
        if not usage or any(not (m.startswith("claude-opus-5-5") or m.startswith("claude-sonnet-5-5")) for m in usage):
            raise ValueError("Unexpected/missing model usage; inspect model access/substitution")
        output = result["structured_output"]
        print(json.dumps(output, indent=2))
        if output["status"] == "complete":
            manifest = json.loads((Path.cwd() / "docs/development/cleanup-manifest.json").read_text())
            if manifest.get("status") != "complete":
                raise ValueError("Final organization did not complete")
            return 0
        return 2 if output["status"] == "ready_for_os_validation" else 1
    except (ValueError, KeyError, OSError) as exc:
        print("Cannot verify completion: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
