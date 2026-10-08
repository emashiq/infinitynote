#!/usr/bin/env node
// Usage: node tools/verify-native.mjs [--packaged|--appimage]
// Runs the SQLite self-test inside Electron main (dev build, unpacked packaged build or AppImage)
// and checks that the prebuilt better-sqlite3 binary was used (no source rebuild).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { buildApp, ensureDisplay, packagedExePath, repoRoot, run, sha256File } from './lib/proc.mjs';

const argv = process.argv.slice(2);
const mode = argv.includes('--appimage') ? 'appimage' : argv.includes('--packaged') ? 'packaged' : 'dev';
ensureDisplay([process.argv[1], ...argv]);

const fail = (message, extra = {}) => {
  console.log(JSON.stringify({ ok: false, mode, error: message, ...extra }, null, 2));
  process.exit(1);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-verify-'));
const reportFile = path.join(tmp, 'report.json');
const env = { ...process.env, INFINITY_NOTES_USER_DATA_DIR: path.join(tmp, 'ud') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;

let exe;
let args;
if (mode === 'dev') {
  const mainEntry = path.join(repoRoot, 'out', 'main', 'index.js');
  const srcNewest = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce((max, e) => {
      const p = path.join(dir, e.name);
      return Math.max(max, e.isDirectory() ? srcNewest(p) : fs.statSync(p).mtimeMs);
    }, 0);
  if (!fs.existsSync(mainEntry) || fs.statSync(mainEntry).mtimeMs < srcNewest(path.join(repoRoot, 'src'))) {
    const code = await buildApp();
    if (code !== 0) fail('build failed');
  }
  exe = createRequire(import.meta.url)('electron');
  args = [repoRoot, '--self-test', `--self-test-report=${reportFile}`];
} else if (mode === 'packaged') {
  exe = packagedExePath();
  if (!fs.existsSync(exe)) fail(`No packaged build at ${exe}; run npm run package:current first`);
  args = ['--self-test', `--self-test-report=${reportFile}`];
} else {
  if (process.platform !== 'linux') fail('--appimage is only available on Linux');
  const release = path.join(repoRoot, 'release');
  const image = fs.existsSync(release) ? fs.readdirSync(release).find((f) => f.endsWith('.AppImage')) : undefined;
  if (!image) fail('No AppImage in release/; run npm run package:linux first');
  exe = path.join(release, image);
  args = ['--self-test', `--self-test-report=${reportFile}`];
  env.APPIMAGE_EXTRACT_AND_RUN = '1';
}

const result = await run(exe, args, { env, timeoutMs: 90_000 });
if (result.code !== 0 && !fs.existsSync(reportFile)) {
  fail(`self-test process exited ${result.code} without a report`, { stderr: result.stderr.slice(-2000) });
}
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const problems = [];
if (result.code !== 0) problems.push(`exit code ${result.code}`);
if (!report.ok) problems.push('report.ok is false');
for (const [name, value] of Object.entries(report.checks)) if (value !== true) problems.push(`check ${name} is false`);
if (report.driver !== 'better-sqlite3') problems.push(`driver is ${report.driver}`);

const nmBuild = path.join(repoRoot, 'node_modules', 'better-sqlite3', 'build');
if (fs.existsSync(nmBuild)) problems.push('node_modules/better-sqlite3/build exists (source rebuild)');

const prebuild = `${process.platform}-${process.arch}.node`;
const sourceBinary = path.join(repoRoot, 'node_modules', 'better-sqlite3', 'prebuilds', prebuild);
const proof = { sourceBinary: sourceBinary, sourceSha256: fs.existsSync(sourceBinary) ? sha256File(sourceBinary) : null };
if (mode !== 'dev') {
  const loaded = report.loadedBinary ?? '';
  if (!loaded.includes('app.asar.unpacked')) problems.push(`loadedBinary is not under app.asar.unpacked: ${loaded}`);
  else if (!fs.existsSync(loaded)) {
    // The AppImage extracts to a temporary directory that is gone after exit; compare via release/linux-unpacked.
    const unpacked = path.join(repoRoot, 'release', 'linux-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', prebuild);
    if (mode === 'appimage' && fs.existsSync(unpacked)) proof.packagedSha256 = sha256File(unpacked);
    else problems.push('loaded binary path not found after exit');
  } else {
    proof.packagedSha256 = sha256File(loaded);
  }
  if (proof.packagedSha256 && proof.packagedSha256 !== proof.sourceSha256) problems.push('packaged .node SHA-256 differs from node_modules prebuild');
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

const summary = {
  ok: problems.length === 0,
  mode,
  problems,
  driver: report.driver,
  sqliteVersion: report.sqliteVersion,
  runtime: report.runtime,
  loadedBinary: report.loadedBinary,
  proof,
  checks: report.checks,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
