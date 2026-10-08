#!/usr/bin/env node
// Usage: node tools/package.mjs <current|win|linux> [--dir]
// Builds the renderer/main/preload bundles and runs electron-builder for the requested target.
import fs from 'node:fs';
import path from 'node:path';
import { CLI, buildApp, repoRoot, runNode, sha256File } from './lib/proc.mjs';

const args = process.argv.slice(2);
const dirOnly = args.includes('--dir');
let target = args.find((a) => !a.startsWith('--'));

const usage = 'Usage: node tools/package.mjs <current|win|linux> [--dir]';
if (!target || !['current', 'win', 'linux'].includes(target)) {
  console.error(`Unknown or missing target "${target ?? ''}". ${usage}`);
  process.exit(2);
}
if (target === 'current') {
  if (process.platform === 'win32') target = 'win';
  else if (process.platform === 'linux') target = 'linux';
  else {
    console.error(`No packaging target for platform ${process.platform}. ${usage}`);
    process.exit(2);
  }
}
if (target === 'win' && process.platform !== 'win32') {
  console.error(
    `package:win builds the Windows NSIS installer and must run on Windows (this host: ${process.platform}). Linux packages are built with package:linux in the WSL ext4 copy.`,
  );
  process.exit(2);
}
if (target === 'linux' && process.platform !== 'linux') {
  console.error(
    `package:linux must run on Linux (use the WSL copy at /home/infinity/infinity-notes; this host: ${process.platform}).`,
  );
  process.exit(2);
}

const buildCode = await buildApp();
if (buildCode !== 0) process.exit(buildCode);

const builderArgs = dirOnly
  ? ['--dir', target === 'win' ? '--win' : '--linux', '--x64', '--publish', 'never']
  : target === 'win'
    ? ['--win', 'nsis', '--x64', '--publish', 'never']
    : ['--linux', 'AppImage', 'deb', '--x64', '--publish', 'never'];
const code = await runNode(CLI.electronBuilder(), builderArgs);

const releaseDir = path.join(repoRoot, 'release');
const artifacts = fs.existsSync(releaseDir)
  ? fs
      .readdirSync(releaseDir)
      .filter((f) => /\.(exe|AppImage|deb)$/.test(f))
      .map((f) => {
        const full = path.join(releaseDir, f);
        return { file: f, bytes: fs.statSync(full).size, sha256: sha256File(full) };
      })
  : [];
if (fs.existsSync(releaseDir)) {
  fs.writeFileSync(path.join(releaseDir, 'artifacts.json'), JSON.stringify(artifacts, null, 2));
}
console.log(`artifacts.json: ${JSON.stringify(artifacts, null, 2)}`);
process.exit(code);
