"""Cleanup/native-launch regression checks with synthetic fixtures; no model calls."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PACK = Path(__file__).resolve().parent
def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, PACK / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
cleanup = load_module("cleanup", "finalize_docs.py")
launcher = load_module("launcher", "launch_autonomous.py")


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        (self.repo / "infinity-notes-claude-pack/__pycache__").mkdir(parents=True)
        (self.repo / "infinity-notes-claude-pack/README.md").write_text("Synthetic archive\n")
        (self.repo / "infinity-notes-claude-pack/__pycache__/temp.pyc").write_bytes(b"cache")
        (self.repo / "docs/plans").mkdir(parents=True)
        (self.repo / "docs/progress").mkdir()
        (self.repo / ".infinity-work/logs").mkdir(parents=True)
        for name in ("FINAL_REPORT.md", "NATIVE_OS_MATRIX.md", "RELEASE_CHECKLIST.md"):
            (self.repo / "docs" / name).write_text("Synthetic test fixture; not native app evidence.\n")
        state = {"result": "complete", "phases": {f"{i:02}": {"status": "accepted", "evidence": ["docs/progress/proof.md"]} for i in range(10)}}
        (self.repo / ".infinity-work/status.json").write_text(json.dumps(state))
        (self.repo / "docs/progress/proof.md").write_text("Log: .infinity-work/logs/test.log\n")
        (self.repo / ".infinity-work/logs/test.log").write_text("Original path .infinity-work/logs/test.log\n")
        (self.repo / "README.md").write_text("Application\n")
        (self.repo / "CLAUDE.md").write_text("Read infinity-notes-claude-pack/PRODUCT_PLAN.md\n")
        (self.repo / "user-notes.db").write_bytes(b"user data")
        (self.repo / "tests").mkdir()
        (self.repo / "tests/fixture.json").write_text('{"preserve": true}')

    def tearDown(self):
        self.temp.cleanup()

    def test_organization_preserves_data_links_and_evidence(self):
        cleanup.organize(self.repo)
        self.assertFalse((self.repo / "infinity-notes-claude-pack").exists())
        self.assertFalse((self.repo / ".infinity-work").exists())
        self.assertTrue((self.repo / "docs/development/claude-pack/README.md").exists())
        self.assertFalse((self.repo / "docs/development/claude-pack/__pycache__").exists())
        self.assertEqual((self.repo / "user-notes.db").read_bytes(), b"user data")
        self.assertTrue((self.repo / "tests/fixture.json").exists())
        self.assertIn("docs/development/run-evidence/logs/test.log", (self.repo / "docs/development/progress/proof.md").read_text())
        self.assertIn("Original path .infinity-work/", (self.repo / "docs/development/run-evidence/logs/test.log").read_text())
        self.assertIn("docs/development/claude-pack/", (self.repo / "CLAUDE.md").read_text())
        self.assertIn("docs/development/run-evidence/", (self.repo / ".gitignore").read_text())
        self.assertEqual(json.loads((self.repo / "docs/development/cleanup-manifest.json").read_text())["status"], "complete")

    def test_pending_validation_prevents_cleanup(self):
        state = self.repo / ".infinity-work/status.json"
        value = json.loads(state.read_text())
        value["result"] = "ready_for_os_validation"
        state.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            cleanup.organize(self.repo)
        self.assertTrue((self.repo / "infinity-notes-claude-pack").exists())
        self.assertFalse((self.repo / "docs/development").exists())

    def test_conflict_does_not_overwrite_or_move_sources(self):
        target = self.repo / "docs/development/claude-pack"
        target.mkdir(parents=True)
        (target / "unrelated.txt").write_text("keep")
        with self.assertRaises(ValueError):
            cleanup.organize(self.repo)
        self.assertTrue((self.repo / "infinity-notes-claude-pack").exists())
        self.assertEqual((target / "unrelated.txt").read_text(), "keep")

    def test_cleanup_idempotent_and_index_preserves_existing_text(self):
        index = self.repo / "docs/INDEX.md"
        index.write_text("Unrelated documentation\n")
        cleanup.organize(self.repo)
        first = index.read_text()
        cleanup.organize(self.repo)
        self.assertEqual(first, index.read_text())
        self.assertTrue(first.startswith("Unrelated documentation"))

    def test_native_agent_models_and_efforts(self):
        defs = launcher.definitions()
        self.assertEqual(len(defs), 5)
        self.assertEqual(defs["infinity-planner"]["model"], "claude-opus-5-5")
        self.assertEqual(defs["infinity-planner"]["effort"], "high")
        self.assertEqual(defs["infinity-code-low"]["effort"], "low")
        self.assertEqual(defs["infinity-code-medium"]["model"], "claude-sonnet-5-5")
        self.assertEqual(defs["infinity-qa"]["effort"], "medium")

    @unittest.skipIf(os.name == "nt", "POSIX fake executable harness")
    def test_native_launcher_pending_result_and_lock_cleanup(self):
        self.launch_fixture("ready_for_os_validation", 2)

    @unittest.skipIf(os.name == "nt", "POSIX fake executable harness")
    def test_native_launcher_refuses_complete_without_finalization(self):
        self.launch_fixture("complete", 1)

    def launch_fixture(self, status, expected_code):
        bin_dir = self.repo / "bin"
        bin_dir.mkdir()
        command = bin_dir / "claude"
        output = {"is_error": False, "modelUsage": {"claude-opus-5-5": {}}, "structured_output": {"status": status, "summary": "synthetic launcher fixture", "evidence": [], "blockers": []}}
        command.write_text("#!/usr/bin/env python3\nimport sys\nsys.stdin.read()\nprint(" + repr(json.dumps(output)) + ")\n")
        command.chmod(0o700)
        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
        result = subprocess.run([sys.executable, str(PACK / "launch_autonomous.py")], cwd=self.repo, env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, expected_code, result.stderr)
        self.assertFalse((self.repo / ".infinity-work/controller.lock").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
