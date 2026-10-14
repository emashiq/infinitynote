import fs from 'node:fs';
import path from 'node:path';

/** The fake `claude` / `codex` script (D-190): tests never run a real AI tool. */
export const FAKE_AI_TOOL = path.resolve('tests/fixtures/ai/fake-ai-tool.mjs');

/** One run of a fake tool, as it logged it. */
export interface FakeAiRun {
  tool: 'claude' | 'codex';
  args: string[];
  cwd: string;
  files: string[];
  prompt: string;
  pid: number;
}

/**
 * Puts fake `claude` and `codex` programs in `dir` (on Windows `.cmd` shims, like npm's, so the shim path of the app is
 * exercised; elsewhere executable shell scripts). They run the fake script with an absolute Node, so they work with a
 * PATH that holds nothing but `dir`. Returns the log file the fakes append their runs to.
 */
export function installFakeAiTools(dir: string, nodePath = process.execPath, platform: NodeJS.Platform = process.platform): { dir: string; log: string; runs(): FakeAiRun[] } {
  fs.mkdirSync(dir, { recursive: true });
  for (const tool of ['claude', 'codex'] as const) {
    if (platform === 'win32') {
      fs.writeFileSync(path.join(dir, `${tool}.cmd`), `@"${nodePath}" "${FAKE_AI_TOOL}" ${tool} %*\r\n`);
    } else {
      const file = path.join(dir, tool);
      fs.writeFileSync(file, `#!/bin/sh\nexec "${nodePath}" "${FAKE_AI_TOOL}" ${tool} "$@"\n`);
      fs.chmodSync(file, 0o755);
    }
  }
  const log = path.join(dir, 'runs.jsonl');
  return {
    dir,
    log,
    runs: () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as FakeAiRun)
        : [],
  };
}

/** Whether a process is still running. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
