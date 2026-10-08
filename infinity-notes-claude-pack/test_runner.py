"""Controller regression tests with fake CLI processes; no paid model calls."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PACK = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("infinity_controller", PACK / "run_phases.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

FAKE_CLAUDE = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
a=sys.argv[1:]
prompt=sys.stdin.read()
repo=Path.cwd()
calls=repo/'calls.jsonl'
role=next(x for x in ('planner','implementer','qa','acceptor') if ('roles/'+x) in prompt or ('You are the Opus HIGH planner' in prompt if x=='planner' else 'You are the Sonnet 5.5 implementer' in prompt if x=='implementer' else 'You are a fresh Sonnet' in prompt if x=='qa' else 'You are Opus HIGH performing' in prompt))
model=a[a.index('--model')+1]
effort=a[a.index('--effort')+1]
with calls.open('a') as f:f.write(json.dumps({'role':role,'model':model,'effort':effort,'args':a})+'\n')
mode=os.environ.get('INFINITY_TEST_MODE','happy')
e=repo/'evidence.md';e.write_text('Synthetic test evidence. Not application verification.\n')
status={'planner':'ready','implementer':'implemented','qa':'pass','acceptor':'accepted'}[role]
issues=[];blockers=[]
if mode=='qa-fail-once' and role=='qa' and not (repo/'failed.once').exists():
 (repo/'failed.once').write_text('yes');status='fail';issues=['Synthetic regression defect']
if mode=='pending' and role in ('qa','acceptor'):
 status='ready_for_os_validation';blockers=['Synthetic missing Windows host']
if mode=='wrong-model':model='claude-haiku-5-5'
print(json.dumps({'is_error':False,'modelUsage':{model:{}},'structured_output':{'status':status,'summary':'Synthetic '+role,'issues':issues,'blockers':blockers,'evidence':['evidence.md'],'checks':[]}}))
'''
FAKE_NPM = r'''#!/usr/bin/env python3
import os,sys
print('Synthetic npm gate: '+' '.join(sys.argv[1:]))
sys.exit(1 if os.environ.get('INFINITY_TEST_MODE')=='gate-fail' else 0)
'''


@unittest.skipIf(os.name == "nt", "Fake executable harness is POSIX; actual controller supports native Windows CLI.")
class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name, content in (("claude", FAKE_CLAUDE), ("npm", FAKE_NPM)):
            path = self.bin / name
            path.write_text(content, encoding="utf-8")
            path.chmod(0o700)
        self.env = os.environ.copy()
        self.env.pop("CLAUDECODE", None)
        self.env["PATH"] = str(self.bin) + os.pathsep + self.env.get("PATH", "")
        self.env["INFINITY_TEST_MODE"] = "happy"

    def tearDown(self):
        self.temp.cleanup()

    def run_controller(self, *args, mode="happy"):
        self.env["INFINITY_TEST_MODE"] = mode
        return subprocess.run([sys.executable, str(PACK / "run_phases.py"), "--repo", str(self.repo), *args], capture_output=True, text=True, env=self.env, timeout=20)

    def state(self):
        return json.loads((self.repo / ".infinity-work/status.json").read_text())

    def calls(self):
        return [json.loads(x) for x in (self.repo / "calls.jsonl").read_text().splitlines()]

    def test_happy_resume_and_model_efforts(self):
        result = self.run_controller("--through-phase", "02", "--call-budget-usd", "1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state()["result"], "paused")
        calls = self.calls()
        self.assertEqual(len(calls), 12)
        for c in calls:
            self.assertIn("--max-budget-usd", c["args"])
            self.assertNotIn("--dangerously-skip-permissions", c["args"])
            self.assertEqual(c["model"], "claude-opus-5-5" if c["role"] in {"planner", "acceptor"} else "claude-sonnet-5-5")
        self.assertEqual(calls[9]["effort"], "low")
        self.assertEqual(calls[8]["effort"], "high")
        again = self.run_controller("--through-phase", "02")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(len(self.calls()), 12)

    def test_qa_failure_repairs_then_accepts(self):
        result = self.run_controller("--through-phase", "00", mode="qa-fail-once")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c["role"] for c in self.calls()], ["planner", "implementer", "qa", "implementer", "qa", "acceptor"])
        self.assertEqual(self.calls()[3]["effort"], "medium")

    def test_failed_gate_blocks_advancement(self):
        result = self.run_controller("--through-phase", "01", "--max-fixes", "1", mode="gate-fail")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.state()["result"], "blocked")
        self.assertIn("00", self.state()["phases"])
        self.assertNotIn("01", self.state()["phases"])
        self.assertIn("Fix limit", result.stderr)

    def test_model_substitution_blocks(self):
        result = self.run_controller("--through-phase", "00", mode="wrong-model")
        self.assertEqual(result.returncode, 1)
        self.assertIn("substitution", result.stderr)
        self.assertFalse(self.state()["phases"])

    def test_pending_native_validation_never_complete(self):
        work = self.repo / ".infinity-work"
        work.mkdir()
        (work / "status.json").write_text(json.dumps({"pack_hash": module.pack_hash(), "phases": {f"{i:02}": {"status": "accepted"} for i in range(9)}, "result": "paused"}))
        result = self.run_controller("--from-phase", "09", mode="pending")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(self.state()["result"], "ready_for_os_validation")

    def test_lock_skip_and_dry_run(self):
        result = self.run_controller("--dry-run")
        self.assertEqual(result.returncode, 0)
        self.assertFalse((self.repo / ".infinity-work").exists())
        result = self.run_controller("--from-phase", "04")
        self.assertEqual(result.returncode, 1)
        self.assertIn("cannot skip", result.stderr)
        lock = self.repo / ".infinity-work/controller.lock"
        lock.write_text("Synthetic active controller")
        result = self.run_controller()
        self.assertEqual(result.returncode, 1)
        self.assertIn("lock exists", result.stderr)
        self.assertTrue(lock.exists())

    def test_restart_invalidates_downstream_acceptance(self):
        self.assertEqual(self.run_controller("--through-phase", "02").returncode, 0)
        result = self.run_controller("--restart-phase", "01", "--through-phase", "01")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(self.state()["phases"]), {"00", "01"})
        self.assertEqual(len(self.calls()), 16)

    def test_changed_pack_checkpoint_is_refused(self):
        self.assertEqual(self.run_controller("--through-phase", "00").returncode, 0)
        state = self.state()
        state["pack_hash"] = "incorrect-hash"
        (self.repo / ".infinity-work/status.json").write_text(json.dumps(state))
        result = self.run_controller()
        self.assertEqual(result.returncode, 1)
        self.assertIn("changed since checkpoint", result.stderr)

    def test_result_validation_rejects_false_success(self):
        value = {"status": "pass", "summary": "test", "issues": ["still broken"], "blockers": [], "evidence": ["evidence.md"], "checks": []}
        with self.assertRaises(module.Blocked):
            module.validate_result(value)


if __name__ == "__main__":
    unittest.main(verbosity=2)
