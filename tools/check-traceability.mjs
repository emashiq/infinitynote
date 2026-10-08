#!/usr/bin/env node
// Documentation traceability checker for Infinity Notes (Phase 00 workflow tool).
// Dependency-free, read-only, no network. Usage:
//   node tools/check-traceability.mjs [--repo .] [--plan docs/plans/phase-00.md] [--backlog docs/BACKLOG.md] [--allow-phase-moves]
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const allowMoves = argv.includes('--allow-phase-moves');
const repo = path.resolve(opt('--repo', '.'));
const fails = [];
const warns = [];
const fail = (check, detail) => fails.push(`FAIL ${check}: ${detail}`);
const warn = (check, detail) => warns.push(`WARN ${check}: ${detail}`);
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const lines = (t) => t.split(/\r?\n/);

// Locate the plan (it moves to docs/development/plans after final organization).
let planPath = path.resolve(repo, opt('--plan', 'docs/plans/phase-00.md'));
if (!exists(planPath)) {
  const alt = path.resolve(repo, 'docs/development/plans/phase-00.md');
  if (exists(alt)) planPath = alt;
}
if (!exists(planPath)) {
  console.log(`FAIL plan: not found at ${planPath}`);
  process.exit(1);
}
const backlogPath = path.resolve(repo, opt('--backlog', 'docs/BACKLOG.md'));
const docsDir = path.resolve(repo, 'docs');
const docPaths = {
  PRODUCT_SPEC: path.join(docsDir, 'PRODUCT_SPEC.md'),
  UX_SPEC: path.join(docsDir, 'UX_SPEC.md'),
  ARCHITECTURE: path.join(docsDir, 'ARCHITECTURE.md'),
  DECISIONS: path.join(docsDir, 'DECISIONS.md'),
  BACKLOG: backlogPath,
};

// Extract rows between whole-line markers.
function tableRows(text, startMarker, endMarker, label) {
  const ls = lines(text);
  const s = ls.findIndex((l) => l.trim() === startMarker);
  const e = ls.findIndex((l) => l.trim() === endMarker);
  if (s < 0 || e < 0 || e < s) {
    fail('markers', `${label}: whole-line markers ${startMarker} / ${endMarker} not found`);
    return [];
  }
  const rows = [];
  for (const l of ls.slice(s + 1, e)) {
    if (!l.trim().startsWith('|')) continue;
    const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] === 'ID' || /^-+$/.test(cells[0])) continue;
    rows.push(cells);
  }
  return rows;
}

const ID_RE = /^INF-[A-Z0-9]+-\d{2}$/;
const TYPES = new Set(['U', 'I', 'E', 'N', 'V', 'P', 'R']);
const STATUSES = new Set(['planned', 'in_progress', 'done', 'not_run', 'outside_validation_scope', 'deferred']);

// 1. Plan Appendix A
const planRows = tableRows(read(planPath), '<!-- REQ-TABLE-START -->', '<!-- REQ-TABLE-END -->', 'plan');
const plan = new Map();
for (const c of planRows) {
  if (c.length !== 5) { fail('plan-table', `row has ${c.length} cells: ${c[0]}`); continue; }
  if (!ID_RE.test(c[0])) { fail('plan-table', `bad ID ${c[0]}`); continue; }
  if (plan.has(c[0])) { fail('plan-table', `duplicate ID ${c[0]}`); continue; }
  plan.set(c[0], { req: c[1], phase: c[2], tests: c[3], planned: c[4] });
}
if (plan.size === 0) fail('plan-table', 'no requirement IDs parsed');

// 2. BACKLOG
let backlogText = '';
if (!exists(backlogPath)) fail('backlog', `missing ${backlogPath}`);
else backlogText = read(backlogPath);
const seen = new Set();
for (const c of tableRows(backlogText, '<!-- BACKLOG-TABLE-START -->', '<!-- BACKLOG-TABLE-END -->', 'backlog')) {
  if (c.length !== 6) { fail('backlog', `row has ${c.length} cells (expected 6): ${c[0]}`); continue; }
  const [id, req, phase, tests, planned, status] = c;
  if (!ID_RE.test(id)) { fail('backlog', `bad ID ${id}`); continue; }
  if (seen.has(id)) { fail('backlog', `duplicate ID ${id}`); continue; }
  seen.add(id);
  const p = plan.get(id);
  if (!p) { fail('backlog', `extra ID not in plan: ${id}`); continue; }
  if (!/^0[1-9]$/.test(phase)) fail('backlog', `${id}: phase must be 01-09, got "${phase}"`);
  const tl = tests.split(',').map((t) => t.trim());
  if (!tests || tl.some((t) => !TYPES.has(t))) fail('backlog', `${id}: Tests must be a non-empty subset of U,I,E,N,V,P,R, got "${tests}"`);
  if (!planned) fail('backlog', `${id}: Planned tests empty`);
  if (!req) fail('backlog', `${id}: Requirement empty`);
  if (!STATUSES.has(status)) fail('backlog', `${id}: status "${status}" not in vocabulary`);
  if (phase !== p.phase) (allowMoves ? warn : fail)('backlog', `${id}: phase ${phase} differs from plan ${p.phase}`);
  if (tests.replace(/\s/g, '') !== p.tests.replace(/\s/g, '')) (allowMoves ? warn : fail)('backlog', `${id}: tests "${tests}" differ from plan "${p.tests}"`);
}
for (const id of plan.keys()) if (!seen.has(id)) fail('backlog', `missing plan ID ${id}`);

// 3. PRODUCT_SPEC contains every ID
const docText = {};
for (const [k, p] of Object.entries(docPaths)) {
  if (!exists(p)) { fail('files', `missing ${path.relative(repo, p)}`); docText[k] = ''; } else docText[k] = read(p);
}
for (const id of plan.keys()) if (!docText.PRODUCT_SPEC.includes(id)) fail('product-spec', `ID not in PRODUCT_SPEC: ${id}`);

// 4. TEST_MATRIX areas in BACKLOG cross-reference
const areas = ['Hierarchy', 'Tabs', 'Editor', 'Persistence', 'Floating stickies', 'References', 'Reminders', 'Scheduler recovery', 'Time zones', 'Parsing', 'Suggestions', 'Widget', 'Portability', 'Packaging', 'Accessibility', 'Native OS matrix'];
const xs = backlogText.search(/^##\s+3\.?\s.*cross-reference/im);
let xsec = '';
if (xs < 0) fail('xref', 'BACKLOG has no "TEST_MATRIX cross-reference" section');
else {
  const rest = backlogText.slice(xs + 3);
  const next = rest.search(/^## /m);
  xsec = next < 0 ? rest : rest.slice(0, next);
}
for (const a of areas) {
  const row = lines(xsec).find((l) => l.trim().startsWith('|') && l.split('|')[1]?.trim().toLowerCase() === a.toLowerCase());
  if (!row) fail('xref', `area "${a}" missing from cross-reference`);
  else if (!/INF-[A-Z0-9]+-\d{2}/.test(row)) fail('xref', `area "${a}" lists no IDs`);
  else for (const m of row.match(/INF-[A-Z0-9]+-\d{2}/g)) if (!plan.has(m)) fail('xref', `area "${a}" lists unknown ID ${m}`);
}

// 5. Required headings
const headingsOf = (t) => lines(t).filter((l) => /^#{1,6}\s/.test(l)).join('\n').toLowerCase();
const required = {
  PRODUCT_SPEC: ['Non-goals', 'Requirement', 'Platform promises', 'Release targets'],
  UX_SPEC: ['Layout', 'Tokens', 'Keyboard', 'Accessibility', 'Dialogs'],
  ARCHITECTURE: ['Data model', 'IPC', 'Autosave', 'Attachments', 'Reminders', 'DST', 'Backup', 'Security', 'Capabilities', 'Testing'],
};
for (const [k, words] of Object.entries(required)) {
  const h = headingsOf(docText[k]);
  for (const w of words) if (!h.includes(w.toLowerCase())) fail('headings', `${k}: no heading containing "${w}"`);
}
for (let i = 1; i <= 34; i++) {
  const id = `D-${String(i).padStart(3, '0')}`;
  if (!new RegExp(`^#{2,4}\\s+${id}\\b`, 'm').test(docText.DECISIONS)) fail('headings', `DECISIONS: missing heading ${id}`);
}

// 6. Relative links resolve
for (const [k, p] of Object.entries(docPaths)) {
  const t = docText[k];
  for (const m of t.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    const file = decodeURIComponent(target.split('#')[0]);
    if (!file) continue;
    if (!exists(path.resolve(path.dirname(p), file))) fail('links', `${k}: broken link ${target}`);
  }
}

// 7. Promise review (WARN only)
const NEG = /\b(not|never|no|stop|stops|stopped|cannot|without|nothing)\b|only while|until relaunch|only work while|only fire while/i;
for (const [k, t] of Object.entries(docText)) {
  const sentences = t.split(/(?<=[.!?])\s+|\n/);
  for (const s of sentences) {
    const clean = s.trim();
    if (!clean) continue;
    if (/(notification|reminder|alert)/i.test(clean) && /\b(quit|closed|exited|not running)\b/i.test(clean) && !NEG.test(clean)) {
      warn('promise', `${k}: ${clean.slice(0, 160)}`);
    }
    // "always-on-top" is a feature name, not a promise word.
    const noFeature = clean.replace(/always[- ]on[- ]top/gi, 'pin-feature');
    if (/\b(guarantee|guaranteed|always)\b/i.test(noFeature) && /(position|placement|on top|on-top)/i.test(noFeature) && !NEG.test(noFeature) && !/wayland/i.test(noFeature)) {
      warn('promise', `${k}: ${clean.slice(0, 160)}`);
    }
  }
}

// 8. Phase 00 boundary
const statusPath = path.join(repo, '.infinity-work', 'agent-status.json');
if (exists(statusPath)) {
  let cur = null;
  try { cur = String(JSON.parse(read(statusPath)).current_phase); } catch { warn('boundary', 'agent-status.json unreadable'); }
  if (cur === '00') {
    for (const f of ['package.json', 'package-lock.json', 'src', 'tests']) {
      if (exists(path.join(repo, f))) fail('boundary', `${f} exists while current_phase is 00`);
    }
  }
}

for (const w of warns) console.log(w);
for (const f of fails) console.log(f);
const perPhase = {};
for (const v of plan.values()) perPhase[v.phase] = (perPhase[v.phase] || 0) + 1;
const phaseSummary = Object.keys(perPhase).sort().map((k) => `${k}:${perPhase[k]}`).join(' ');
console.log(`SUMMARY ids=${plan.size} backlog_rows=${seen.size} per_phase[${phaseSummary}] fails=${fails.length} warns=${warns.length}`);
process.exit(fails.length ? 1 : 0);
