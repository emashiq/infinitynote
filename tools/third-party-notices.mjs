#!/usr/bin/env node
// Usage: node tools/third-party-notices.mjs [--check]
// Writes THIRD_PARTY_NOTICES.md: every third-party package the app ships, which is each package imported by src/
// (bundled into out/ or loaded from the asar) plus everything those packages depend on, resolved through
// package-lock.json, with its version, license and license text. --check fails when the committed file is stale.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { repoRoot } from './lib/proc.mjs';

const OUTPUT = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
// Electron's npm package only downloads the runtime; its own dependencies never ship. Chromium's and Node's
// licenses travel with the runtime as LICENSES.chromium.html next to the installed executable.
const LEAF_PACKAGES = new Set(['electron']);
// Optional packages that are installed for development but never bundled or packaged: pdf.js's Node canvas, which
// the renderer does not need (it draws with the browser canvas) and the PDF text worker does not use (D-129).
const UNSHIPPED_OPTIONAL = new Set(['@napi-rs/canvas']);
// Packages that a shipped package's own build already bundled into its files, so they are not in package-lock.json:
// pptx-glimpse's renderer carries @xmldom/xmldom and rtf.js's EMF/WMF readers (both MIT, D-155). Their license texts
// come from their npm packages and are kept under tools/vendored-licenses/.
const BUNDLED_INSIDE = [
  { host: 'pptx-glimpse', name: '@xmldom/xmldom', version: '0.9.12', license: 'MIT', file: 'xmldom-xmldom.txt' },
  { host: 'pptx-glimpse', name: 'rtf.js', version: '3.0.9', license: 'MIT', file: 'rtf.js.txt' },
];
// Packages published without a license file although their source repository has one: the repository's LICENSE at the
// shipped version's tag, kept under tools/vendored-licenses/ (FortuneSheet's monorepo at tag v1.0.4, MIT, D-180).
const UPSTREAM_LICENSE_FILES = { '@fortune-sheet/core': 'fortune-sheet.txt', '@fortune-sheet/react': 'fortune-sheet.txt' };
// Type declarations are erased at build time and never ship.
const isTypesOnly = (name) => name.startsWith('@types/');
const IMPORT_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

function packageName(specifier) {
  const parts = specifier.split('?')[0].split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function importedPackages() {
  const names = new Set();
  for (const file of sourceFiles(path.join(repoRoot, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      for (const [, specifier] of text.matchAll(pattern)) {
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
        const name = packageName(specifier);
        if (!builtinModules.includes(name)) names.add(name);
      }
    }
  }
  return names;
}

/** Node-style lookup of `name` as seen from the lockfile entry at `fromKey` (nearest node_modules upwards). */
function resolveKey(lock, fromKey, name) {
  let base = fromKey;
  for (;;) {
    const key = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (lock.packages[key]) return key;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut >= 0 ? base.slice(0, cut) : '';
  }
}

/** The old `licenses: [{type}]` field of a package.json (jstat), which npm does not copy into the lockfile. */
/** Packages whose package.json names no license although their license file does (checked by hand, Run 5). */
const LICENSE_IN_FILE_ONLY = { khroma: 'MIT' };

function legacyLicense(key) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, key, 'package.json'), 'utf8'));
  const types = Array.isArray(manifest.licenses) ? manifest.licenses.map((l) => l?.type).filter((t) => typeof t === 'string') : [];
  if (types.length === 0) return LICENSE_IN_FILE_ONLY[manifest.name] ?? null;
  return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
}

const vendoredLicense = (file) => fs.readFileSync(path.join(repoRoot, 'tools', 'vendored-licenses', file), 'utf8').replace(/\r\n?/g, '\n').trim();

function shippedPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const seen = new Map();
  const queue = [];
  for (const name of importedPackages()) {
    const key = resolveKey(lock, '', name);
    if (!key) throw new Error(`${name} is imported by src/ but missing from package-lock.json`);
    queue.push(key);
  }
  while (queue.length > 0) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    const entry = lock.packages[key];
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const upstream = UPSTREAM_LICENSE_FILES[name];
    seen.set(key, {
      name,
      version: entry.version,
      license: entry.license ?? legacyLicense(key) ?? 'UNKNOWN',
      dir: path.join(repoRoot, key),
      ...(upstream ? { text: vendoredLicense(upstream) } : {}),
    });
    if (LEAF_PACKAGES.has(name)) continue;
    const required = Object.keys(entry.dependencies ?? {});
    // Optional and peer dependencies ship only when they are installed.
    const optional = Object.keys({ ...entry.optionalDependencies, ...entry.peerDependencies }).filter((dep) => !UNSHIPPED_OPTIONAL.has(dep));
    for (const dep of [...required, ...optional]) {
      if (isTypesOnly(dep)) continue;
      const depKey = resolveKey(lock, key, dep);
      if (depKey) queue.push(depKey);
      else if (required.includes(dep)) throw new Error(`${dep} (a dependency of ${name}) is missing from package-lock.json`);
    }
  }
  const shippedNames = new Set([...seen.values()].map((p) => p.name));
  for (const inner of BUNDLED_INSIDE) {
    if (!shippedNames.has(inner.host)) continue;
    seen.set(`bundled:${inner.name}`, { ...inner, text: vendoredLicense(inner.file) });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function licenseText(dir) {
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).sort().find((f) => LICENSE_FILE.test(f)) : undefined;
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim() : null;
}

function render(packages) {
  const lines = [
    '# Third-party notices',
    '',
    'Infinity Notes includes the third-party software listed below. Each component remains under its own license, reproduced here; the Infinity Notes Freeware License (LICENSE) does not change those terms. The Electron runtime also ships the licenses of Chromium, Node.js and their components in `LICENSES.chromium.html` next to the installed program.',
    '',
    'Generated by `node tools/third-party-notices.mjs` from `package-lock.json`.',
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |',
    ...packages.map((p) => `| ${p.name} | ${p.version} | ${p.license}${p.host ? ` (bundled in ${p.host})` : ''} |`),
    '',
    '## License texts',
  ];
  // Identical texts (for example many copies of one project's MIT notice) are printed once.
  const byText = new Map();
  for (const p of packages) {
    const text = p.text ?? licenseText(p.dir) ?? `No license file is included in the package; its package.json declares ${p.license}.`;
    byText.set(text, [...(byText.get(text) ?? []), `${p.name}@${p.version}`]);
  }
  for (const [text, owners] of byText) {
    lines.push('', `### ${owners.join(', ')}`, '', '```text', text, '```');
  }
  return `${lines.join('\n')}\n`;
}

const notices = render(shippedPackages());
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== notices) {
    console.error('THIRD_PARTY_NOTICES.md is out of date; run node tools/third-party-notices.mjs and commit the result.');
    process.exit(1);
  }
  console.log('THIRD_PARTY_NOTICES.md is up to date.');
} else {
  fs.writeFileSync(OUTPUT, notices);
  console.log(`Wrote ${path.relative(repoRoot, OUTPUT)}.`);
}
