#!/usr/bin/env node
// Usage: node tools/run-e2e.mjs [--packaged] [playwright args...]
import fs from 'node:fs';
import { CLI, buildApp, ensureDisplay, packagedExePath, run } from './lib/proc.mjs';

const argv = process.argv.slice(2);
const packaged = argv.includes('--packaged');
const extra = argv.filter((a) => a !== '--packaged');

ensureDisplay([process.argv[1], ...argv]);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;

if (packaged) {
  const exe = packagedExePath();
  if (!fs.existsSync(exe)) {
    console.error(`No packaged build at ${exe}; run npm run package:current first`);
    process.exit(1);
  }
  env.INFINITY_NOTES_PACKAGED_EXE = exe;
} else {
  const code = await buildApp();
  if (code !== 0) process.exit(code);
}

const grep = packaged ? ['--grep', '@packaged'] : ['--grep-invert', '@packaged'];
// Windows Node 24.15 intermittently (~10%) kills the Playwright worker (0xC0000409) while it connects to Electron's
// CDP socket; Node 24.21 showed 0/30 (see docs/progress/phase-01.md, Repair 2). INFINITY_E2E_NODE selects the node
// binary that runs the Playwright CLI and workers (the global Node is never modified).
const nodeBin = process.env.INFINITY_E2E_NODE || process.execPath;
if (process.platform === 'win32' && !process.env.INFINITY_E2E_NODE) {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj === 24 && min < 21) {
    console.warn(
      `warning: Node ${process.versions.node} on Windows has a known intermittent Playwright worker crash (exit 3221226505); set INFINITY_E2E_NODE to a Node >= 24.21 binary to avoid it`,
    );
  }
}
const { code } = await run(nodeBin, [CLI.playwright(), 'test', ...grep, ...extra], { env, inherit: true });
process.exit(code);
