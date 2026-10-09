import { randomUUID } from 'node:crypto';

/** Mulberry32 seeded PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words of the synthetic notebook; Bangla words exercise the FTS tokenizer. */
export const FIXTURE_WORDS = ['alpha', 'budget', 'meeting', 'report', 'design', 'travel', 'project', 'review', 'বাংলা', 'ভাষা', 'garden', 'invoice', 'schedule', 'team', 'launch'] as const;

/** Queries over the fixture words: whole words, prefixes, two-word queries and Bangla. */
export const FIXTURE_QUERIES = ['budget', 'meet', 'design review', 'বাংলা', 'trav', 'launch team', 'inv', 'sched', 'garden alpha', 'report'] as const;

/** What the fixture needs from a database: better-sqlite3 in E2E tests, the app's driver in integration tests. */
export interface FixtureDb {
  exec(sql: string): unknown;
  prepare(sql: string): { run(...params: unknown[]): unknown };
}

export interface LargeNotebook {
  projects: Array<{ id: string; name: string }>;
  noteIds: string[];
}

/**
 * The performance fixture (INF-PERF-01): `projects` projects and `notes` plain notes of 40 words each, a third of them
 * in Common, written in one transaction straight into a closed (or test-owned) database; the FTS index follows through
 * the schema's triggers. Synthetic text only.
 */
export function seedLargeNotebook(db: FixtureDb, opts: { projects: number; notes: number; seed?: number }): LargeNotebook {
  const rand = prng(opts.seed ?? 7);
  const pick = () => FIXTURE_WORDS[Math.floor(rand() * FIXTURE_WORDS.length)]!;
  const insertProject = db.prepare('INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, 1, 1)');
  const insertNote = db.prepare("INSERT INTO notes(id, project_id, title, format, content_text, plain_text, created_at, updated_at) VALUES (?, ?, ?, 'plain', ?, ?, 1, ?)");
  const projects = Array.from({ length: opts.projects }, (_, i) => ({ id: randomUUID(), name: `Project ${i}` }));
  const noteIds: string[] = [];
  db.exec('BEGIN');
  try {
    for (const p of projects) insertProject.run(p.id, p.name);
    for (let i = 0; i < opts.notes; i += 1) {
      const body = Array.from({ length: 40 }, pick).join(' ');
      const id = randomUUID();
      noteIds.push(id);
      insertNote.run(id, i % 3 === 0 || projects.length === 0 ? null : projects[i % projects.length]!.id, `${pick()} ${pick()} ${i}`, body, body, i);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { projects, noteIds };
}

/** The 95th percentile (nearest rank) of a sample in milliseconds. */
export function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((x, y) => x - y);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

export function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((x, y) => x - y);
  return sorted[sorted.length >> 1]!;
}
