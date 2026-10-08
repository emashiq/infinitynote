#!/usr/bin/env python3
"""Sequential Claude Code phase controller. Python 3.10+, stdlib only."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

PACK = Path(__file__).resolve().parent
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "status": {"type": "string", "enum": ["ready", "implemented", "pass", "accepted", "fail", "blocked", "ready_for_os_validation"]},
        "summary": {"type": "string"},
        "issues": {"type": "array", "items": {"type": "string"}},
        "blockers": {"type": "array", "items": {"type": "string"}},
        "evidence": {"type": "array", "items": {"type": "string"}},
        "checks": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"command": {"type": "string"}, "status": {"type": "string", "enum": ["pass", "fail", "not_run"]}, "evidence": {"type": "string"}},
            "required": ["command", "status", "evidence"]
        }}
    },
    "required": ["status", "summary", "issues", "blockers", "evidence", "checks"]
}
ALLOW = [
    "Read", "Write", "Edit", "Glob", "Grep",
    "Bash(npm install)", "Bash(npm ci)", "Bash(npm run *)",
    "Bash(node --version)", "Bash(npm --version)",
    "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
    "WebFetch(domain:code.claude.com)", "WebFetch(domain:electronjs.org)",
    "WebFetch(domain:tiptap.dev)", "WebFetch(domain:github.com)",
    "WebFetch(domain:npmjs.com)"
]


class Blocked(Exception):
    pass


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def stamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def pack_hash():
    digest = hashlib.sha256()
    for p in sorted(PACK.rglob("*")):
        if p.is_file() and p.suffix in {".md", ".json", ".py"} and "__pycache__" not in p.parts:
            digest.update(str(p.relative_to(PACK)).encode())
            digest.update(p.read_bytes())
    return digest.hexdigest()


def validate_result(value):
    if not isinstance(value, dict) or set(value) != set(SCHEMA["required"]):
        raise Blocked("Missing or malformed structured role result; see saved Claude output.")
    if value["status"] not in SCHEMA["properties"]["status"]["enum"] or not isinstance(value["summary"], str):
        raise Blocked("Invalid status/summary from role.")
    for key in ("issues", "blockers", "evidence"):
        if not isinstance(value[key], list) or any(not isinstance(x, str) for x in value[key]):
            raise Blocked("Malformed " + key + " from role.")
    if not isinstance(value["checks"], list):
        raise Blocked("Malformed checks from role.")
    for item in value["checks"]:
        if not isinstance(item, dict) or set(item) != {"command", "status", "evidence"}:
            raise Blocked("Malformed check object from role.")
        if item["status"] not in {"pass", "fail", "not_run"} or not all(isinstance(item[k], str) for k in item):
            raise Blocked("Malformed check values from role.")
    if value["status"] in {"pass", "accepted", "ready_for_os_validation"} and (value["issues"] or any(c["status"] == "fail" for c in value["checks"])):
        raise Blocked("Role claimed success while reporting unresolved issues/failed checks.")
    if value["status"] in {"ready", "implemented", "pass", "accepted"} and value["blockers"]:
        raise Blocked("Role claimed success while reporting blockers.")
    return value


class Controller:
    def __init__(self, args, phases):
        self.args, self.phases = args, phases
        self.repo = args.repo.resolve()
        self.work = self.repo / ".infinity-work"
        self.state_path = self.work / "status.json"
        self.state = {"pack_hash": pack_hash(), "phases": {}, "result": "in_progress"}
        self.claude = None
        self.npm = None

    def evidence(self, value):
        evidence_paths = list(value["evidence"])
        evidence_paths.extend(c["evidence"] for c in value["checks"] if c["status"] != "not_run")
        if not evidence_paths:
            raise Blocked("Role returned no evidence paths.")
        for rel in evidence_paths:
            p = (self.repo / rel).resolve()
            try:
                p.relative_to(self.repo)
            except ValueError:
                raise Blocked("Evidence escaped repository: " + rel)
            if not p.is_file() or p.stat().st_size == 0:
                raise Blocked("Missing/empty evidence file: " + rel)

    def prompt(self, phase, role, feedback=""):
        relpack = os.path.relpath(PACK, self.repo)
        base = (PACK / "roles" / (role + ".md")).read_text(encoding="utf-8")
        spec = (PACK / phase["file"]).read_text(encoding="utf-8")
        return (base + "\n\n" + spec +
                f"\nWorking directory is the project root. Pack is {relpack}. "
                "Read PRODUCT_PLAN.md, ARCHITECTURE.md, TEST_MATRIX.md, existing CLAUDE.md, actual code and relevant prior progress from disk. "
                "Do not edit the supplied pack, controller, or checkpoint. Keep all application work in this repository. "
                "Use the selected model; do not spawn other agents. Return the requested structured JSON. "
                "Every evidence path is relative to the project root and must exist and be nonempty. "
                "Do not put credentials into reports.\n" + feedback)

    def call(self, phase, role, feedback="", fix=False):
        model = self.args.opus_model if role in {"planner", "acceptor"} else self.args.sonnet_model
        effort = "high" if role in {"planner", "acceptor"} else (phase["effort"] if role == "implementer" and not fix else "medium")
        label = phase["id"] + "-" + role + "-" + stamp()
        logs = self.work / "logs"
        tools_available = "Read,Glob,Grep,Write,Edit,WebFetch" if role == "planner" else "Read,Glob,Grep,Write,Edit,Bash,WebFetch"
        cmd = [self.claude, "-p", "--model", model, "--effort", effort,
               "--output-format", "json", "--json-schema", json.dumps(SCHEMA),
               "--max-turns", str(self.args.max_turns), "--permission-mode", "acceptEdits",
               "--tools", tools_available, "--allowedTools", *ALLOW]
        if self.args.call_budget_usd is not None:
            cmd.extend(["--max-budget-usd", str(self.args.call_budget_usd)])
        print(f"Phase {phase['id']}: {role} — {model} / {effort}", flush=True)
        env = os.environ.copy()
        # Prevent an inherited effort override from changing these explicit roles.
        env.pop("CLAUDE_CODE_EFFORT_LEVEL", None)
        prompt_path = logs / (label + ".prompt.txt")
        prompt_path.write_text(self.prompt(phase, role, feedback), encoding="utf-8")
        try:
            process = subprocess.run(cmd, input=prompt_path.read_text(encoding="utf-8"), cwd=self.repo,
                                     env=env, text=True, encoding="utf-8", errors="replace",
                                     capture_output=True, timeout=self.args.timeout)
        except subprocess.TimeoutExpired as exc:
            for kind, output in (("stdout", exc.stdout), ("stderr", exc.stderr)):
                if isinstance(output, bytes):
                    output = output.decode("utf-8", "replace")
                (logs / (label + "." + kind + ".log")).write_text(output or "Timed out.\n", encoding="utf-8")
            raise Blocked("Claude call timed out; evidence saved. Resume after inspecting it.")
        (logs / (label + ".json")).write_text(process.stdout, encoding="utf-8")
        (logs / (label + ".stderr.log")).write_text(process.stderr, encoding="utf-8")
        if process.returncode != 0:
            raise Blocked(f"Claude call exited {process.returncode}; inspect {label} logs (access, permissions, budget or turn limit).")
        try:
            envelope = json.loads(process.stdout)
        except json.JSONDecodeError:
            raise Blocked("Claude did not return JSON; inspect " + label)
        if not isinstance(envelope, dict) or envelope.get("is_error"):
            raise Blocked("Claude reported an execution error; inspect " + label)
        usage = envelope.get("modelUsage")
        if not isinstance(usage, dict) or not usage:
            raise Blocked("No actual model usage reported; cannot verify model assignment.")
        unexpected = [actual for actual in usage if actual != model and not actual.startswith(model + "-")]
        if unexpected:
            raise Blocked("Model substitution detected: requested " + model + ", used " + ", ".join(unexpected))
        result = validate_result(envelope.get("structured_output"))
        self.evidence(result)
        atomic_json(logs / (label + ".result.json"), result)
        return result

    def checks(self, phase):
        if phase["id"] == "00":
            return []
        scripts = ["check", "build"]
        if phase["id"] == "09":
            scripts += ["test:e2e", "package:current"]
        results = []
        for script in scripts:
            label = phase["id"] + "-" + script.replace(":", "-") + "-" + stamp()
            log = self.work / "logs" / (label + ".log")
            command = [self.npm, "run", script]
            print("Independent gate: npm run " + script, flush=True)
            try:
                completed = subprocess.run(command, cwd=self.repo, capture_output=True, text=True,
                                           encoding="utf-8", errors="replace", timeout=self.args.timeout)
                log.write_text(f"Command: npm run {script}\nExit: {completed.returncode}\n" + completed.stdout + "\nSTDERR\n" + completed.stderr, encoding="utf-8")
                passed = completed.returncode == 0
            except subprocess.TimeoutExpired:
                log.write_text(f"Command: npm run {script}\nTimed out\n", encoding="utf-8")
                passed = False
            results.append({"command": "npm run " + script, "status": "pass" if passed else "fail", "evidence": str(log.relative_to(self.repo))})
            if not passed:
                break
        return results

    def phase(self, phase):
        self.state["current_phase"] = phase["id"]
        atomic_json(self.state_path, self.state)
        plan = self.call(phase, "planner")
        if plan["status"] != "ready":
            raise Blocked(plan["summary"] + " " + "; ".join(plan["blockers"]))
        response = self.call(phase, "implementer")
        for attempt in range(self.args.max_fixes + 1):
            if response["status"] == "blocked":
                raise Blocked(response["summary"] + " " + "; ".join(response["blockers"]))
            if response["status"] != "implemented":
                raise Blocked("Implementer returned unexpected status: " + response["status"])
            checks = self.checks(phase)
            if any(c["status"] == "fail" for c in checks):
                feedback = "Fix the failing independent gates. Read their logs.\n" + json.dumps(checks, indent=2)
            else:
                qa = self.call(phase, "qa", "Independent gates already run; review these evidence logs:\n" + json.dumps(checks, indent=2))
                if qa["status"] == "blocked":
                    raise Blocked(qa["summary"] + " " + "; ".join(qa["blockers"]))
                if qa["status"] in {"pass", "ready_for_os_validation"}:
                    if qa["status"] == "ready_for_os_validation" and phase["id"] != "09":
                        raise Blocked("Pending OS validation status is reserved for the final phase.")
                    acceptance = self.call(phase, "acceptor", "QA and independent gates:\n" + json.dumps({"qa": qa, "gates": checks}, indent=2))
                    if acceptance["status"] == "blocked":
                        raise Blocked(acceptance["summary"] + " " + "; ".join(acceptance["blockers"]))
                    if acceptance["status"] in {"accepted", "ready_for_os_validation"}:
                        if acceptance["status"] == "ready_for_os_validation" and phase["id"] != "09":
                            raise Blocked("Pending OS validation status is reserved for the final phase.")
                        if qa["status"] == "ready_for_os_validation" and acceptance["status"] == "accepted":
                            raise Blocked("QA has pending native validation; cannot promote it to complete.")
                        self.state["phases"][phase["id"]] = {"status": acceptance["status"], "summary": acceptance["summary"], "evidence": acceptance["evidence"], "updated": stamp()}
                        atomic_json(self.state_path, self.state)
                        return acceptance["status"]
                    if acceptance["status"] != "fail":
                        raise Blocked("Unexpected acceptance status: " + acceptance["status"])
                    feedback = "Fix acceptance defects without weakening gates:\n" + json.dumps(acceptance, indent=2)
                elif qa["status"] == "fail":
                    feedback = "Fix QA defects and run their regression tests:\n" + json.dumps(qa, indent=2)
                else:
                    raise Blocked("Unexpected QA status: " + qa["status"])
            if attempt == self.args.max_fixes:
                raise Blocked("Fix limit reached at phase " + phase["id"] + "; latest defects remain in logs.")
            response = self.call(phase, "implementer", feedback, fix=True)
        raise Blocked("Unreachable phase state.")

    def run(self):
        if self.args.dry_run:
            for phase in self.phases:
                if self.args.from_phase <= phase["id"] <= self.args.through_phase:
                    print(f"{phase['id']} {phase['title']}: Opus high -> Sonnet {phase['effort']} -> gates -> Sonnet medium QA -> Opus high acceptance")
            print("Dry run: no files changed, no Claude calls, no application tests executed.")
            return 0
        if os.environ.get("CLAUDECODE"):
            raise Blocked("Run this controller from a normal terminal, outside an existing Claude Code session.")
        self.claude = shutil.which(self.args.claude_bin)
        self.npm = shutil.which("npm")
        if not self.claude or not self.npm:
            raise Blocked("Claude Code and npm must be installed and on PATH.")
        if os.name == "nt" and Path(self.claude).suffix.lower() in {".cmd", ".bat"}:
            raise Blocked("Use the native Claude Code executable on Windows; this runner avoids shell batch wrapping.")
        self.work.mkdir(parents=True, exist_ok=True)
        (self.work / "logs").mkdir(exist_ok=True)
        lock = self.work / "controller.lock"
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            raise Blocked("Controller lock exists. Ensure no controller is running before removing a stale .infinity-work/controller.lock.")
        with os.fdopen(descriptor, "w") as f:
            f.write(json.dumps({"pid": os.getpid(), "started": stamp()}))
        try:
            if self.state_path.exists():
                self.state = json.loads(self.state_path.read_text(encoding="utf-8"))
                if self.state.get("pack_hash") != pack_hash():
                    raise Blocked("Prompt pack changed since checkpoint; preserve the old checkpoint and start a new review rather than silently reusing acceptance.")
            if self.args.restart_phase:
                atomic_json(self.work / ("status-before-restart-" + stamp() + ".json"), self.state)
                self.state["phases"] = {key: value for key, value in self.state["phases"].items() if key < self.args.restart_phase}
                self.args.from_phase = self.args.restart_phase
                atomic_json(self.state_path, self.state)
            for phase in self.phases:
                if phase["id"] < self.args.from_phase and self.state["phases"].get(phase["id"], {}).get("status") != "accepted":
                    raise Blocked("Preceding phase " + phase["id"] + " is not accepted; cannot skip it.")
            self.state.pop("blocker", None)
            self.state["result"] = "in_progress"
            for phase in self.phases:
                if not self.args.from_phase <= phase["id"] <= self.args.through_phase:
                    continue
                if self.state["phases"].get(phase["id"], {}).get("status") == "accepted":
                    print("Resume: phase " + phase["id"] + " already accepted.", flush=True)
                    continue
                result = self.phase(phase)
                if result == "ready_for_os_validation":
                    self.state["result"] = result
                    atomic_json(self.state_path, self.state)
                    print("Core development ready. Native Windows/Linux validation remains pending; see final report.")
                    return 2
            self.state["result"] = "complete" if all(self.state["phases"].get(p["id"], {}).get("status") == "accepted" for p in self.phases) else "paused"
            atomic_json(self.state_path, self.state)
            print("Result: " + self.state["result"])
            return 0
        except (Blocked, OSError, ValueError) as exc:
            self.state["result"] = "blocked"
            self.state["blocker"] = str(exc)
            atomic_json(self.state_path, self.state)
            raise Blocked(str(exc))
        finally:
            lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--opus-model", default="claude-opus-5-5")
    parser.add_argument("--sonnet-model", default="claude-sonnet-5-5")
    parser.add_argument("--claude-bin", default="claude")
    parser.add_argument("--from-phase", default="00", choices=[f"{i:02}" for i in range(10)])
    parser.add_argument("--through-phase", default="09", choices=[f"{i:02}" for i in range(10)])
    parser.add_argument("--restart-phase", choices=[f"{i:02}" for i in range(10)])
    parser.add_argument("--max-fixes", type=int, default=3)
    parser.add_argument("--max-turns", type=int, default=100)
    parser.add_argument("--timeout", type=int, default=3600, help="Seconds per Claude call or build gate")
    parser.add_argument("--call-budget-usd", type=float)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.max_fixes < 0 or args.max_turns < 1 or args.timeout < 1:
        parser.error("Fix count must be nonnegative and turns/timeout positive.")
    if args.call_budget_usd is not None and args.call_budget_usd <= 0:
        parser.error("Budget must be positive.")
    start = args.restart_phase or args.from_phase
    if start > args.through_phase:
        parser.error("Starting phase must not follow through-phase.")
    if not args.repo.is_dir():
        parser.error("Repository directory does not exist.")
    phases = json.loads((PACK / "phases.json").read_text(encoding="utf-8"))
    try:
        controller = Controller(args, phases)
        result = controller.run()
        if not args.dry_run and result == 0 and controller.state.get("result") == "complete":
            finalize = subprocess.run([sys.executable, str(PACK / "finalize_docs.py"), "--repo", str(args.repo.resolve())])
            if finalize.returncode:
                print("Implementation accepted, but final documentation organization remains blocked.", file=sys.stderr)
                return 1
        return result
    except Blocked as exc:
        print("Blocked: " + str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted. Progress/logs remain available for resume.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
