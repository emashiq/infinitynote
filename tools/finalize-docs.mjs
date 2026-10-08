#!/usr/bin/env node
// Node port of infinity-notes-claude-pack/finalize_docs.py so the final organization
// needs no Python. Behavior mirrors the Python finalizer: it organizes workflow-owned
// files after verified completion and preserves user data.
// Usage: node tools/finalize-docs.mjs [--repo .]
import fs from 'node:fs';
import path from 'node:path';

const isSymlink = (p) => {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
};
const exists = (p) => fs.existsSync(p);
const resolveReal = (p) => {
  // Like Path.resolve(): resolve existing prefix through symlinks, keep the rest.
  let current = path.resolve(p);
  const rest = [];
  while (!exists(current)) {
    rest.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(fs.realpathSync.native(current), ...rest);
};
const isRelativeTo = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const writeJson = (p, data) => {
  const temp = p + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, p);
};
const walkMarkdown = (dir) => {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
};

function organize(repoArg) {
  const repo = resolveReal(repoArg);
  const archive = path.join(repo, 'docs/development');
  for (const p of [path.join(repo, 'docs'), archive]) {
    if (exists(p) && (isSymlink(p) || !fs.statSync(p).isDirectory())) {
      throw new Error('Refusing non-directory/symlink destination: ' + p);
    }
    if (!isRelativeTo(resolveReal(p), repo)) throw new Error('Destination escaped repository');
  }
  const manifestPath = path.join(archive, 'cleanup-manifest.json');
  for (const p of [manifestPath, path.join(repo, '.gitignore'), path.join(repo, 'README.md'),
    path.join(repo, 'CLAUDE.md'), path.join(repo, 'docs/INDEX.md')]) {
    if (isSymlink(p)) throw new Error('Refusing to rewrite symlink: ' + p);
  }
  let manifest;
  if (exists(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.workflow !== 'infinity-notes') throw new Error('Existing cleanup manifest belongs to another workflow');
    if (manifest.status === 'complete') {
      console.log('Final documentation is already organized.');
      return;
    }
  } else {
    manifest = { workflow: 'infinity-notes', status: 'in_progress', moves: [], removed: [] };
  }
  let statePath = null;
  for (const base of [path.join(repo, '.infinity-work'), path.join(archive, 'run-evidence')]) {
    for (const filename of ['agent-status.json', 'status.json']) {
      const candidate = path.join(base, filename);
      if (exists(candidate)) { statePath = candidate; break; }
    }
    if (statePath) break;
  }
  if (!statePath) throw new Error('No workflow completion checkpoint found');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const phases = state.phases || {};
  const allAccepted = Array.from({ length: 10 }, (_, i) => String(i).padStart(2, '0'))
    .every((id) => (phases[id] || {}).status === 'accepted');
  if (state.result !== 'complete' || !allAccepted) {
    throw new Error('Keep active files in place: all phases/native validation must be accepted first');
  }
  for (const filename of ['FINAL_REPORT.md', 'NATIVE_OS_MATRIX.md', 'RELEASE_CHECKLIST.md']) {
    const p = path.join(repo, 'docs', filename);
    if (!exists(p) || !fs.statSync(p).isFile() || !fs.statSync(p).size) {
      throw new Error('Required final documentation missing: ' + filename);
    }
  }
  const pairs = [
    ['infinity-notes-claude-pack', 'docs/development/claude-pack'],
    ['docs/plans', 'docs/development/plans'],
    ['docs/progress', 'docs/development/progress'],
    ['.infinity-work', 'docs/development/run-evidence'],
  ];
  const moves = manifest.moves.length
    ? manifest.moves
    : pairs.filter(([s]) => exists(path.join(repo, s))).map(([s, d]) => ({ from: s, to: d, done: false }));
  // Preflight every move before modifying any source.
  for (const move of moves) {
    const source = path.join(repo, move.from);
    const target = path.join(repo, move.to);
    for (const p of [source, target]) {
      if (isSymlink(p) || !isRelativeTo(resolveReal(p), repo)) {
        throw new Error('Refusing symlink/outside-repository move: ' + p);
      }
    }
    if (exists(source) && exists(target)) throw new Error('Cleanup destination conflict; nothing overwritten: ' + move.to);
    if (!exists(source) && !exists(target)) throw new Error('Cleanup source and destination both missing: ' + move.from);
  }
  fs.mkdirSync(archive, { recursive: true });
  manifest.moves = moves;
  writeJson(manifestPath, manifest);
  for (const move of moves) {
    const source = path.join(repo, move.from);
    const target = path.join(repo, move.to);
    if (exists(source)) fs.renameSync(source, target);
    move.done = true;
    writeJson(manifestPath, manifest);
  }
  const replacements = pairs.map(([s, d]) => [s + '/', d + '/']);
  const replacePaths = (text) => replacements.reduce((t, [o, n]) => t.split(o).join(n), text);
  // Keep raw logs and the archived prompt pack unchanged as historical evidence.
  const mdPaths = [path.join(repo, 'README.md'), path.join(repo, 'CLAUDE.md'),
    ...walkMarkdown(path.join(repo, 'docs')).filter((p) =>
      !isRelativeTo(p, path.join(archive, 'run-evidence')) && !isRelativeTo(p, path.join(archive, 'claude-pack')))];
  for (const p of mdPaths) {
    if (exists(p) && fs.statSync(p).isFile() && !isSymlink(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const updated = replacePaths(content);
      if (updated !== content) fs.writeFileSync(p, updated, 'utf8');
    }
  }
  const newStatePath = path.join(archive, 'run-evidence', path.basename(statePath));
  const rewrite = (value) => {
    if (typeof value === 'string') return replacePaths(value);
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
    return value;
  };
  writeJson(newStatePath, rewrite(state));
  for (const relative of ['docs/development/claude-pack/__pycache__', 'docs/development/run-evidence/status.json.tmp']) {
    const p = path.join(repo, relative);
    if (isSymlink(p)) throw new Error('Refusing symlink temporary file: ' + relative);
    if (exists(p)) {
      fs.rmSync(p, { recursive: fs.statSync(p).isDirectory() });
      manifest.removed.push(relative);
    }
  }
  const ignore = path.join(repo, '.gitignore');
  const ignoreText = exists(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  if (!ignoreText.split(/\r?\n/).includes('docs/development/run-evidence/')) {
    fs.writeFileSync(ignore, ignoreText.trimEnd() + '\n\n# Private Infinity Notes development evidence\ndocs/development/run-evidence/\n', 'utf8');
  }
  const start = '<!-- infinity-docs:start -->';
  const end = '<!-- infinity-docs:end -->';
  const links = fs.readdirSync(path.join(repo, 'docs'))
    .filter((n) => n.endsWith('.md') && n !== 'INDEX.md' && fs.statSync(path.join(repo, 'docs', n)).isFile())
    .sort()
    .map((n) => `- [${n}](${n})`);
  links.push('- [Development prompt archive](development/claude-pack/README.md)',
    '- [Cleanup manifest](development/cleanup-manifest.json)');
  const section = start + '\n# Infinity Notes documentation\n\n' + links.join('\n') +
    '\n\nPhase plans and progress live under development/. Private raw evidence is preserved under development/run-evidence/ and excluded from git. Original paths in raw logs are historical; the cleanup manifest maps them to current locations.\n' + end;
  const index = path.join(repo, 'docs/INDEX.md');
  let original = exists(index) ? fs.readFileSync(index, 'utf8') : '';
  if (original.includes(start) && original.includes(end)) {
    const [before, rest] = [original.slice(0, original.indexOf(start)), original.slice(original.indexOf(start) + start.length)];
    const after = rest.slice(rest.indexOf(end) + end.length);
    original = before + section + after;
  } else {
    original = original.trimEnd() + (original ? '\n\n' : '') + section + '\n';
  }
  fs.writeFileSync(index, original, 'utf8');
  const readme = path.join(repo, 'README.md');
  if (exists(readme) && !fs.readFileSync(readme, 'utf8').includes('docs/INDEX.md')) {
    fs.appendFileSync(readme, '\nDocumentation: [docs/INDEX.md](docs/INDEX.md).\n', 'utf8');
  }
  manifest.status = 'complete';
  manifest.completed_at = new Date().toISOString();
  writeJson(manifestPath, manifest);
  console.log('Final prompts, plans and evidence organized under docs/development/. Temporary workflow files cleaned.');
}

const args = process.argv.slice(2);
const repoIndex = args.indexOf('--repo');
const repoArg = repoIndex >= 0 && args[repoIndex + 1] ? args[repoIndex + 1] : process.cwd();
try {
  organize(repoArg);
  process.exit(0);
} catch (error) {
  console.error('Cleanup blocked: ' + error.message);
  process.exit(1);
}
