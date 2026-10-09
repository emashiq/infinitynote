#!/usr/bin/env node
// Usage: node tools/release-notes.mjs <tag> [--repo <dir>]
// Checks that a release tag (v<version>) names the app's version in package.json and APP_VERSION, then prints the
// GitHub release notes: the CHANGELOG.md section for that version followed by the unsigned-build notice.
// Exits 1 with a message on stderr when the tag does not match or the CHANGELOG has no section for the version.
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib/proc.mjs';

const UNSIGNED_NOTICE = `**Unsigned builds.** The installers are not code-signed. Windows SmartScreen may show "Windows protected your PC": choose **More info**, then **Run anyway**. Some Linux desktops warn about an unknown publisher. Check each download against \`SHA256SUMS.txt\`: \`sha256sum -c SHA256SUMS.txt --ignore-missing\` on Linux, \`Get-FileHash <file> -Algorithm SHA256\` in PowerShell.`;

const argv = process.argv.slice(2);
const repoAt = argv.indexOf('--repo');
const repo = path.resolve(repoAt >= 0 && argv[repoAt + 1] ? argv[repoAt + 1] : repoRoot);
const tag = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--repo');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function changelogSection(changelog, version) {
  const text = changelog.replace(/\r\n?/g, '\n');
  const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\n]*\n`, 'm').exec(text);
  if (!heading) return null;
  const rest = text.slice(heading.index + heading[0].length);
  const next = rest.search(/^## /m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim() || null;
}

if (!tag) fail('Usage: node tools/release-notes.mjs <tag> [--repo <dir>]');
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
if (!match) fail(`Release tag "${tag}" is not of the form v<major>.<minor>.<patch>.`);
const version = match[1];

const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
const packageVersion = JSON.parse(read('package.json')).version;
if (packageVersion !== version) fail(`Release tag ${tag} does not match package.json version ${packageVersion}.`);
const appVersion = /APP_VERSION = '([^']+)'/.exec(read('src/shared/app-identity.ts'))?.[1];
if (appVersion !== version) fail(`Release tag ${tag} does not match APP_VERSION ${appVersion ?? '(not found)'} in src/shared/app-identity.ts.`);

const section = changelogSection(read('CHANGELOG.md'), version);
if (!section) fail(`CHANGELOG.md has no "## [${version}]" section with release notes.`);
process.stdout.write(`${section}\n\n---\n\n${UNSIGNED_NOTICE}\n`);
