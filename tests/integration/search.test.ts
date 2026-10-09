import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SearchQueryRequestType, SearchResultType } from '../../src/shared/contracts/search';
import { SearchQueryRequest } from '../../src/shared/contracts/search';
import { toFtsQuery } from '../../src/main/services/search-service';
import { prng } from './hierarchy-helpers';
import { doc, para, setupReminders } from './reminder-helpers';

const text = (segments: SearchResultType['title']) => segments.map((s) => s.text).join('');
const hits = (segments: SearchResultType['title']) => segments.filter((s) => s.hit).map((s) => s.text);

async function setup() {
  const s = await setupReminders();
  const search = (query: string, over: Omit<SearchQueryRequestType, 'query'> = {}) => s.search.query(SearchQueryRequest.parse({ query, ...over })).results;
  const titles = (query: string, over: Omit<SearchQueryRequestType, 'query'> = {}) => search(query, over).map((r) => r.note.title);
  return { s, search, titles };
}

describe('full-text search (INF-SRCH-01..05, D-098)', () => {
  it('Bangla, prefix: titles and bodies match by word prefix, Bangla included; title hits rank first', async () => {
    const { s, search, titles } = await setup();
    s.editable('Planning review').save(doc(para(randomUUID(), 'quarterly goals')));
    s.editable('Groceries').save(doc(para(randomUUID(), 'remember the planning sheet')));
    s.editable('বাংলা নোট').save(doc(para(randomUUID(), 'আমার সোনার বাংলা আমি তোমায় ভালোবাসি')));

    expect(titles('plan')).toEqual(['Planning review', 'Groceries']);
    expect(titles('plan rev')).toEqual(['Planning review']);
    expect(titles('বাং')).toEqual(['বাংলা নোট']);
    expect(titles('ভালো')).toEqual(['বাংলা নোট']);

    const [body] = search('sheet');
    expect(text(body!.title)).toBe('Groceries');
    expect(hits(body!.snippet)).toEqual(['sheet']);
    expect(text(body!.snippet)).toBe('remember the planning sheet');
    expect(hits(search('বাংলা')[0]!.title)).toEqual(['বাংলা']);
  });

  it('index lifecycle: edits, trash, restore and moves are reflected at once', async () => {
    const { s, titles } = await setup();
    const note = s.editable('Atlas');
    note.save(doc(para(randomUUID(), 'zeppelin route')));
    expect(titles('zeppelin')).toEqual(['Atlas']);
    note.save(doc(para(randomUUID(), 'balloon route')));
    expect(titles('zeppelin')).toEqual([]);
    expect(titles('balloon')).toEqual(['Atlas']);

    const { trashBatchId } = s.trash.trashNote(note.note.id);
    expect(titles('balloon')).toEqual([]);
    s.trash.restore(trashBatchId);
    expect(titles('balloon')).toEqual(['Atlas']);

    const project = s.project('Travel');
    s.hierarchy.moveNote(note.note.id, { projectId: project.id, folderId: null });
    expect(titles('balloon', { scope: { kind: 'common' } })).toEqual([]);
    expect(titles('balloon', { scope: { kind: 'project', projectId: project.id } })).toEqual(['Atlas']);
    s.hierarchy.renameNote(note.note.id, 'Airship');
    expect(titles('airsh')).toEqual(['Airship']);
  });

  it('scope filter and tag filter narrow the results; a tag alone lists its notes', async () => {
    const { s, titles } = await setup();
    const work = s.project('Work');
    const a = s.editable('Budget common');
    a.save(doc(para(randomUUID(), 'budget numbers')));
    const b = s.hierarchy.createNote({ projectId: work.id, folderId: null }, false, 'Budget work').note;
    s.edit(b).save(doc(para(randomUUID(), 'budget numbers')));

    expect(titles('budget').sort()).toEqual(['Budget common', 'Budget work']);
    expect(titles('budget', { scope: { kind: 'common' } })).toEqual(['Budget common']);
    expect(titles('budget', { scope: { kind: 'project', projectId: work.id } })).toEqual(['Budget work']);

    s.tags.set(a.note.id, ['finance', 'q4']);
    s.tags.set(b.id, ['finance']);
    expect(titles('budget', { tags: ['q4'] })).toEqual(['Budget common']);
    expect(titles('budget', { tags: ['finance', 'q4'] })).toEqual(['Budget common']);
    expect(titles('', { tags: ['finance'] }).sort()).toEqual(['Budget common', 'Budget work']);
    expect(titles('', {})).toEqual([]);
  });

  it('short queries match titles by substring; FTS operators in the text are never interpreted', async () => {
    const { s, search, titles } = await setup();
    s.editable('AI ideas').save(doc(para(randomUUID(), 'body')));
    s.editable('Main plan').save(doc(para(randomUUID(), 'NEAR the "end" of AND it')));
    expect(titles('ai')).toEqual(['AI ideas', 'Main plan']);
    expect(hits(search('ai')[0]!.title)).toEqual(['AI']);
    for (const q of ['"end', 'NEAR(end', 'end*', 'AND OR NOT', '-end', '^end', 'col:end', '()', '"']) {
      expect(() => search(q), q).not.toThrow();
    }
    expect(titles('"end"')).toEqual(['Main plan']);
    expect(toFtsQuery('a "b" c-d')).toBe('"a"* "b"* "c-d"*');
    expect(toFtsQuery(' -- ** ')).toBeNull();
  });

  it('snippets carry markup as text: HTML in a note is returned verbatim inside plain segments', async () => {
    const { s, search } = await setup();
    s.editable('Payload').save(doc(para(randomUUID(), '<img src=x onerror=alert(1)> payload <script>alert(2)</script>')));
    const [result] = search('payload');
    expect(text(result!.snippet)).toBe('<img src=x onerror=alert(1)> payload <script>alert(2)</script>');
    expect(result!.snippet.filter((seg) => seg.hit).map((seg) => seg.text)).toEqual(['payload']);
  });

  it('p95: 10,000-note fixture returns at most 50 results per query within a generous bound', async () => {
    const { s, search } = await setup();
    const words = ['alpha', 'budget', 'meeting', 'report', 'design', 'travel', 'project', 'review', 'বাংলা', 'ভাষা', 'garden', 'invoice', 'schedule', 'team', 'launch'];
    const rand = prng(7);
    const pick = () => words[Math.floor(rand() * words.length)]!;
    const insertProject = s.t.db.prepare<[string, string]>('INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, 1, 1)');
    const insertNote = s.t.db.prepare<[string, string | null, string, string, string, number]>(
      "INSERT INTO notes(id, project_id, title, format, content_text, plain_text, created_at, updated_at) VALUES (?, ?, ?, 'plain', ?, ?, 1, ?)",
    );
    const projects = Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), name: `Project ${i}` }));
    s.t.db.transaction(() => {
      for (const p of projects) insertProject.run(p.id, p.name);
      for (let i = 0; i < 10_000; i += 1) {
        const body = Array.from({ length: 40 }, pick).join(' ');
        insertNote.run(randomUUID(), i % 3 === 0 ? null : projects[i % 100]!.id, `${pick()} ${pick()} ${i}`, body, body, i);
      }
    });

    const queries = ['budget', 'meet', 'design review', 'বাংলা', 'trav', 'launch team', 'inv', 'sched', 'garden alpha', 'report'];
    const times: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      for (const q of queries) {
        const scope = round % 2 === 0 ? undefined : { kind: 'project' as const, projectId: projects[round]!.id };
        const started = performance.now();
        const results = search(q, scope ? { scope } : {});
        times.push(performance.now() - started);
        expect(results.length).toBeLessThanOrEqual(50);
        if (!scope) expect(results).toHaveLength(50);
      }
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    console.log(`search p95 over ${times.length} queries at 10,000 notes: ${p95.toFixed(1)} ms (median ${times[times.length >> 1]!.toFixed(1)} ms)`);
    // The product target is 300 ms (measured on the release machine in Phase 09); this bound only catches regressions.
    expect(p95).toBeLessThan(1000);
  }, 60_000);
});
