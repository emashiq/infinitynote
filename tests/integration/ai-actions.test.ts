import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiEngine } from '../../src/shared/ai/engines';
import { AI_MESSAGES } from '../../src/shared/ai/limits';
import type { CommentThreadDtoType } from '../../src/shared/contracts/comments';
import type { RichDocLike } from '../../src/shared/editor/doc-schema';
import { AI_SNIPPET_PREFIX } from '../../src/main/services/search-service';
import type { FetchLike } from '../../src/main/services/network-guard';
import { installFakeAiTools, processAlive } from '../support/fake-ai-tools';
import { makePng } from '../support/png';
import { COMMON, CTX, fixtureBytes } from './document-helpers';
import { setupServices, type Services } from './hierarchy-helpers';
import { openBetterSqlite } from '../../src/main/db/better-sqlite3-driver';
import { migrateDatabase } from '../../src/main/db/migrate';
import { MIGRATIONS } from '../../src/main/db/migrations';
import { mkTmp, trackDb } from './helpers';
import { tmpFile } from './portability-helpers';

const PASSWORD = 'correct horse battery';
const BLOCK = randomUUID();
const ALL_ENGINES: AiEngine[] = ['claude-code', 'codex', 'anthropic-api', 'openai-api'];

const withoutPath = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== 'PATH'));

function save(s: Services, noteId: string, content: RichDocLike) {
  const revision = s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', noteId)!.revision;
  return s.writer.save({ noteId, viewId: randomUUID(), baseRevision: revision, requestId: randomUUID(), format: 'rich', content });
}

const paragraph = (text: string, threadId?: string) => ({
  type: 'paragraph',
  attrs: { id: BLOCK },
  content: threadId
    ? [{ type: 'text', text: 'Note: ' }, { type: 'text', text, marks: [{ type: 'comment', attrs: { threadId } }] }]
    : [{ type: 'text', text: `Note: ${text}` }],
});

/** An API answer the fake transport gives the next request. */
type Reply = (url: string) => Response;

/**
 * The production services with AI actions on and confirmed, fake `claude` and `codex` the only tools on PATH, and a
 * fake API transport that records each request and answers from a queue (an unexpected request fails the test).
 */
async function setupAi(opts: { engine?: AiEngine; minuteMs?: number } = {}) {
  const tools = installFakeAiTools(path.join(mkTmp('infinity-ai-tools-'), 'bin'));
  const env: NodeJS.ProcessEnv = { ...withoutPath(process.env), PATH: tools.dir, FAKE_AI_LOG: tools.log };
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const replies: Reply[] = [];
  const apiFetch: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, headers: new Headers(init?.headers), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request ${url}`);
    return reply(url);
  };
  const s = await setupServices({ ai: { env, apiFetch, minuteMs: opts.minuteMs } });
  s.settings.setInternal('ai.enabled', true);
  s.settings.setInternal('ai.engine', opts.engine ?? 'claude-code');
  s.settings.setInternal('ai.acknowledged', ALL_ENGINES);
  const note = s.note(null, null, 'Plan');
  save(s, note.id, { type: 'doc', content: [paragraph('The budget is due in March.')] });
  const target = { kind: 'note' as const, id: note.id };
  const ask = (over: Partial<Parameters<typeof s.ai.ask>[0]> = {}) =>
    s.ai.ask({ target, anchor: { type: 'text', blockId: BLOCK }, quote: 'budget is due', selection: 'The budget is due in March.', action: 'analyze', prompt: '', wholeItem: false, files: [], picked: null, ...over }, CTX);
  /** Saves the thread's mark on the text, as the editor does after the thread is made. */
  const mark = (threadId: string) => save(s, note.id, { type: 'doc', content: [paragraph('The budget is due in March.', threadId)] });
  const answered = async (thread: CommentThreadDtoType) => (await s.ai.wait(thread.id)).thread;
  return { s, tools, env, note, target, ask, mark, answered, requests, replies };
}

/** A Messages API stream ending with the stop reason. */
function anthropicStream(text: string, stop: { stop_reason: string; stop_details?: unknown } = { stop_reason: 'end_turn' }): Reply {
  const events = [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_sequence: null, stop_details: null, ...stop }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A JSON answer; an error status asks the SDK to retry at once, as a real API's retry header can. */
const jsonReply =
  (status: number, body: unknown): Reply =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } });

const openAiResponse = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'resp_1',
  object: 'response',
  created_at: 1,
  status: 'completed',
  model: 'gpt-5.5',
  error: null,
  incomplete_details: null,
  output: [{ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
  ...extra,
});

describe('migration 016 AI threads (D-190)', () => {
  it('upgrading from 015 keeps every comment and its search; threads become comment threads, comments the user’s', () => {
    const db = trackDb(openBetterSqlite(path.join(mkTmp(), 'v15.sqlite3')));
    db.pragma('foreign_keys = ON');
    migrateDatabase(db, MIGRATIONS.filter((m) => m.version <= 15));
    const noteId = randomUUID();
    const threadId = randomUUID();
    db.prepare("INSERT INTO notes(id, title, format, content_json, plain_text, created_at, updated_at) VALUES (?, 'Plan', 'rich', '{\"type\":\"doc\"}', '', 1, 1)").run(noteId);
    db.prepare("INSERT INTO comment_threads(id, target_kind, target_id, anchor_json, quote, created_at, updated_at) VALUES (?, 'note', ?, '{\"type\":\"text\",\"blockId\":null}', 'q', 1, 1)").run(threadId, noteId);
    db.prepare("INSERT INTO comments(id, thread_id, body, created_at, updated_at) VALUES (?, ?, 'kiwifruit check', 1, 1)").run(randomUUID(), threadId);

    expect(migrateDatabase(db, MIGRATIONS)).toEqual({ from: 15, to: 16 });
    expect(db.prepare('SELECT kind FROM comment_threads').get()).toEqual({ kind: 'comment' });
    expect(db.prepare('SELECT role, body, meta, sealed_meta FROM comments').get()).toEqual({ role: 'user', body: 'kiwifruit check', meta: null, sealed_meta: null });
    expect(db.prepare("SELECT rowid FROM comments_fts WHERE comments_fts MATCH 'kiwifruit'").all()).toHaveLength(1);

    const insert = (role: string, body: string, meta: string | null) =>
      db.prepare('INSERT INTO comments(id, thread_id, role, body, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)').run(randomUUID(), threadId, role, body, meta);
    insert('assistant', 'x'.repeat(100_000), '{"engine":"codex"}');
    expect(() => insert('assistant', 'x'.repeat(100_001), null)).toThrow(/CHECK/);
    expect(() => insert('robot', 'hi', null)).toThrow(/CHECK/);
    expect(() => insert('error', 'hi', 'not json')).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO comment_threads(id, kind, target_kind, target_id, anchor_json, quote, created_at, updated_at) VALUES (?, 'bot', 'note', ?, '{}', 'q', 1, 1)").run(randomUUID(), noteId)).toThrow(/CHECK/);
    // The comments still go with their thread, and their search entries with them.
    db.prepare('DELETE FROM comment_threads WHERE id = ?').run(threadId);
    expect(db.prepare('SELECT count(*) AS n FROM comments').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT rowid FROM comments_fts WHERE comments_fts MATCH 'kiwifruit'").all()).toHaveLength(0);
  });
});

describe('AI actions with Claude Code (headless, D-190..D-192)', () => {
  it('runs the action read-only in a fresh folder, keeps the answer with its session and cost, and removes the folder', async () => {
    const { s, ask, mark, answered, tools, target } = await setupAi();
    const { thread } = await ask({ prompt: 'focus on dates' });
    expect(thread).toMatchObject({ kind: 'ai', running: true, quote: 'budget is due' });
    expect(thread.comments).toEqual([expect.objectContaining({ role: 'user', body: 'Analyze: focus on dates', ai: expect.objectContaining({ engine: 'claude-code', attachments: [] }) })]);
    mark(thread.id);
    const done = await answered(thread);
    expect(done.running).toBe(false);
    const answer = done.comments[1]!;
    expect(answer).toMatchObject({ role: 'assistant', ai: { engine: 'claude-code', model: 'claude-fake-model', costUsd: 0.0042, attachments: [] } });
    expect(answer.body).toContain('Fake Claude answer (new session)');

    const [run] = tools.runs();
    expect(run!.tool).toBe('claude');
    expect(run!.args).toEqual(['-p', '--output-format', 'json', '--restricted', '--tools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--strict-mcp-config']);
    expect(path.basename(run!.cwd)).toBe(thread.id);
    expect(path.dirname(run!.cwd)).toBe(s.paths.aiWorkDir);
    expect(run!.files).toEqual([]);
    // The user's text reaches the tool only on stdin.
    expect(run!.prompt).toContain('<selection>\nThe budget is due in March.\n</selection>');
    expect(run!.prompt).toContain('focus on dates');
    expect(run!.prompt).toContain('the note “Plan”');
    expect(fs.existsSync(run!.cwd)).toBe(false);
    // The session stays in main: renderers see the engine, model, files and cost only.
    const stored = s.row<{ meta: string }>("SELECT meta FROM comments WHERE thread_id = ? AND role = 'assistant'", thread.id)!;
    expect(JSON.parse(stored.meta)).toMatchObject({ sessionId: expect.any(String) });
    expect(JSON.stringify(s.comments.list(target))).not.toContain(JSON.parse(stored.meta).sessionId);
    // AI threads are listed with the comments and found by search with their own label.
    expect(s.comments.list(target).threads.map((t) => t.kind)).toEqual(['ai']);
    expect(s.search.query({ query: 'second point' }).results[0]!.snippet.map((x) => x.text).join('')).toContain(AI_SNIPPET_PREFIX);
  });

  it('a follow-up resumes the session in the same folder with only the new question; another engine gets the whole conversation', async () => {
    const { s, ask, mark, answered, tools } = await setupAi();
    const { thread } = await ask();
    mark(thread.id);
    await answered(thread);
    const session = (JSON.parse(s.row<{ meta: string }>("SELECT meta FROM comments WHERE role = 'assistant'")!.meta) as { sessionId: string }).sessionId;

    const followed = (await s.ai.followUp({ threadId: thread.id, prompt: 'And the vendors?' })).thread;
    expect(followed.running).toBe(true);
    const second = await answered(followed);
    const run = tools.runs()[1]!;
    expect(run.args.slice(-2)).toEqual(['--resume', session]);
    expect(run.prompt).toBe('And the vendors?');
    expect(path.basename(run.cwd)).toBe(thread.id);
    expect(second.comments.map((c) => c.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(second.comments[3]!.body).toContain(`resumed ${session}`);

    // Codex never resumes Claude Code's session: it gets the part and the conversation so far.
    s.settings.setInternal('ai.engine', 'codex');
    await answered((await s.ai.followUp({ threadId: thread.id, prompt: 'Summarize all that' })).thread);
    const codex = tools.runs()[2]!;
    expect(codex.tool).toBe('codex');
    expect(codex.args).not.toContain('resume');
    expect(codex.prompt).toContain('<selection>\nThe budget is due in March.\n</selection>');
    expect(codex.prompt).toContain('And the vendors?');
    expect(codex.prompt).toContain('<question>\nSummarize all that\n</question>');
  });

  it('a second follow-up sent before the first has started is refused, so one run owns the thread and its folder (D-195)', async () => {
    const { s, ask, mark, answered, tools } = await setupAi();
    const { thread } = await ask();
    mark(thread.id);
    await answered(thread);
    // Both are sent at once (the main window and the sticky, or a double submit): the second is refused at once.
    const first = s.ai.followUp({ threadId: thread.id, prompt: 'And the vendors?' });
    const second = s.ai.followUp({ threadId: thread.id, prompt: 'And the dates?' });
    await expect(second).rejects.toMatchObject({ code: 'CONFLICT', message: AI_MESSAGES.running });
    const done = await answered((await first).thread);
    expect(done.comments.map((c) => c.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(tools.runs()).toHaveLength(2);
    // Once it has ended, the next follow-up runs.
    await answered((await s.ai.followUp({ threadId: thread.id, prompt: 'And the dates?' })).thread);
    expect(tools.runs()).toHaveLength(3);
  });

  it('a resumed session finds the item’s files under the names it was told, also when one is gone since (D-195)', async () => {
    const { s, ask, note, answered, tools } = await setupAi();
    const minutes = (await s.attachments.importBytes({ kind: 'document', originalName: 'minutes.txt', bytes: new TextEncoder().encode('Vendor list: Acme') })).attachment;
    const plan = (await s.attachments.importBytes({ kind: 'document', originalName: 'plan.txt', bytes: new TextEncoder().encode('Due in March') })).attachment;
    const node = (a: typeof minutes, name: string) => ({ type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: a.id, name, sizeBytes: a.sizeBytes, mime: a.mime } });
    save(s, note.id, { type: 'doc', content: [paragraph('The budget is due in March.'), node(minutes, 'minutes.txt'), node(plan, 'plan.txt')] });
    const { thread } = await ask({ files: [{ type: 'attachment', id: minutes.id }, { type: 'attachment', id: plan.id }] });
    await answered(thread);
    expect(tools.runs()[0]!.files).toEqual(['1-minutes.txt', '2-plan.txt']);

    // The minutes leave the note; the plan keeps its number in the resumed session's folder.
    save(s, note.id, { type: 'doc', content: [paragraph('The budget is due in March.', thread.id), node(plan, 'plan.txt')] });
    await answered((await s.ai.followUp({ threadId: thread.id, prompt: 'What is due?' })).thread);
    const resumed = tools.runs()[1]!;
    expect(resumed.args).toContain('--resume');
    expect(resumed.files).toEqual(['2-plan.txt']);
  });

  it('copies the chosen files into the folder and names them in the prompt; images, PDFs and documents keep their kind', async () => {
    const { s, ask, note, tools } = await setupAi();
    const text = (await s.attachments.importBytes({ kind: 'document', originalName: 'minutes.txt', bytes: new TextEncoder().encode('Vendor list: Acme') })).attachment;
    const image = (await s.attachments.importBytes({ kind: 'document', originalName: 'chart 1.png', bytes: makePng(2, 2) })).attachment;
    const docx = (await s.attachments.importBytes({ kind: 'document', originalName: 'Brief.docx', bytes: fixtureBytes('sample.docx') })).attachment;
    const node = (a: typeof text, name: string) => ({ type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: a.id, name, sizeBytes: a.sizeBytes, mime: a.mime } });
    save(s, note.id, { type: 'doc', content: [paragraph('The budget is due in March.'), node(text, 'minutes.txt'), node(image, 'chart 1.png'), node(docx, 'Brief.docx')] });

    const options = (await s.ai.fileOptions({ kind: 'note', id: note.id })).files;
    expect(options.map((o) => [o.name, o.kind, o.problem])).toEqual(
      expect.arrayContaining([
        ['minutes.txt', 'text', null],
        ['chart 1.png', 'image', null],
        ['Brief.docx', 'text', null],
      ]),
    );
    const { thread } = await ask({ wholeItem: true, files: options.map((o) => o.ref) });
    expect(thread.comments[0]!.ai!.attachments.map((a) => a.name).sort()).toEqual(['Brief.docx', 'chart 1.png', 'minutes.txt']);
    await s.ai.wait(thread.id);
    const run = tools.runs()[0]!;
    expect(run.files).toEqual(expect.arrayContaining([expect.stringMatching(/^\d-minutes\.txt$/), expect.stringMatching(/^\d-chart_1\.png$/), expect.stringMatching(/^\d-Brief\.txt$/)]));
    expect(run.prompt).toContain('<whole_item>');
    expect(run.prompt).toMatch(/Brief\.docx \(.+\): in the current folder as \d-Brief\.txt \(its text\)/);
  });

  it('files picked from disk are sent once and named, never kept; too large files are refused before anything runs', async () => {
    const { s, ask, tools } = await setupAi();
    const dir = mkTmp('infinity-ai-picked-');
    const small = path.join(dir, 'notes.md');
    fs.writeFileSync(small, '# Notes\nhello');
    s.dialogQueue.push([small]);
    const pick = await s.ai.pickFiles(CTX);
    const { thread } = await ask({ picked: { pickId: pick.pickId!, indexes: [0] } });
    await s.ai.wait(thread.id);
    expect(tools.runs()[0]!.files).toEqual(['1-notes.md']);
    expect(s.row<{ meta: string }>("SELECT meta FROM comments WHERE role = 'user'")!.meta).not.toContain(dir.replace(/\\/g, '\\\\'));
    // A pick is used once.
    await expect(ask({ picked: { pickId: pick.pickId!, indexes: [0] } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const big = path.join(dir, 'big.txt');
    fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024, 'a'));
    s.dialogQueue.push([big]);
    const bigPick = await s.ai.pickFiles(CTX);
    await expect(ask({ picked: { pickId: bigPick.pickId!, indexes: [0] } })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: AI_MESSAGES.fileTooLarge });
    expect(s.rows("SELECT id FROM comment_threads WHERE kind = 'ai'")).toHaveLength(1);
  });

  it('a failed run is the thread’s error message: the tool’s own words, a broken output, a missing tool', async () => {
    const { s, ask, answered, env } = await setupAi();
    env.FAKE_AI_MODE = 'error';
    const failed = await answered((await ask()).thread);
    expect(failed.comments[1]).toMatchObject({ role: 'error', body: 'Claude Code: Fake Claude failure' });

    env.FAKE_AI_MODE = 'garbage';
    const broken = await answered((await ask()).thread);
    expect(broken.comments[1]!.body).toBe('Claude Code ended without an answer (exit code 3): fake tool exploded');

    env.PATH = mkTmp('infinity-empty-path-');
    await expect(ask()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: AI_MESSAGES.noCli('Claude Code') });
    expect(await s.ai.status()).toMatchObject({ enabled: true, problem: AI_MESSAGES.noCli('Claude Code') });
  });

  it('Stop and the timeout end the whole process tree and say so in the thread; the folder is removed', async () => {
    const { s, ask, env, tools } = await setupAi({ minuteMs: 1500 });
    env.FAKE_AI_MODE = 'hang';
    const { thread } = await ask();
    await expect.poll(() => tools.runs().length, { timeout: 10_000 }).toBe(1);
    const pid = tools.runs()[0]!.pid;
    expect(processAlive(pid)).toBe(true);
    expect(s.ai.stop(thread.id)).toEqual({ stopped: true });
    const stopped = (await s.ai.wait(thread.id)).thread;
    expect(stopped.comments[1]).toMatchObject({ role: 'error', body: AI_MESSAGES.stopped });
    await expect.poll(() => processAlive(pid), { timeout: 10_000 }).toBe(false);
    expect(fs.existsSync(tools.runs()[0]!.cwd)).toBe(false);
    expect(s.ai.stop(thread.id)).toEqual({ stopped: false });

    s.settings.setInternal('ai.timeoutMinutes', 1);
    const timed = (await s.ai.wait((await ask()).thread.id)).thread;
    expect(timed.comments[1]).toMatchObject({ role: 'error', body: AI_MESSAGES.timedOut(1) });
    await expect.poll(() => processAlive(tools.runs()[1]!.pid), { timeout: 10_000 }).toBe(false);
  }, 30_000);

  it('Settings → AI Test reports the tool’s version, and a chosen program replaces PATH', async () => {
    const { s, env, tools } = await setupAi();
    expect(await s.ai.test('claude-code')).toEqual({ ok: true, message: 'Claude Code 2.1.293 (Claude Code)' });
    expect(await s.ai.test('codex')).toEqual({ ok: true, message: 'Codex codex-cli 0.162.1' });
    env.PATH = '';
    expect(await s.ai.test('codex')).toEqual({ ok: false, message: AI_MESSAGES.noCli('Codex') });
    s.pathQueue.push(fs.readdirSync(tools.dir).map((f) => path.join(tools.dir, f)).find((f) => /codex(\.cmd)?$/.test(f))!);
    const config = await s.ai.cliPath('codex', 'pick', CTX);
    expect(config.cliPaths.codex).toMatch(/codex(\.cmd)?$/);
    expect(await s.ai.test('codex')).toMatchObject({ ok: true });
    expect((await s.ai.cliPath('codex', 'clear', CTX)).cliPaths.codex).toBeNull();
  });
});

describe('the tools’ working folders (D-195)', () => {
  it('folders a quit or crash left during a run are removed when the services start', async () => {
    const root = path.join(mkTmp('infinity-ai-leftover-'), 'ai-work');
    fs.mkdirSync(path.join(root, randomUUID()), { recursive: true });
    fs.writeFileSync(path.join(root, fs.readdirSync(root)[0]!, '1-Report.pdf'), 'plaintext copy');
    const s = await setupServices({ ai: { workRoot: root } });
    expect(fs.existsSync(root)).toBe(false);
    expect(s.logger.lines.some((l) => l.includes('ai: removed 1 leftover working folder(s)'))).toBe(true);
  });

  it('quitting during a run removes its folder at once; the run then ends as stopped', async () => {
    const { s, ask, env, tools } = await setupAi();
    env.FAKE_AI_MODE = 'hang';
    const { thread } = await ask();
    await expect.poll(() => tools.runs().length, { timeout: 10_000 }).toBe(1);
    const { cwd, pid } = tools.runs()[0]!;
    expect(fs.existsSync(cwd)).toBe(true);
    s.ai.stopAll();
    // Windows keeps a folder that a running process has as its working folder until the tree is gone; elsewhere it goes now.
    if (process.platform !== 'win32') expect(fs.existsSync(cwd)).toBe(false);
    const stopped = (await s.ai.wait(thread.id)).thread;
    expect(stopped.comments[1]).toMatchObject({ role: 'error', body: AI_MESSAGES.stopped });
    await expect.poll(() => processAlive(pid), { timeout: 10_000 }).toBe(false);
    expect(fs.existsSync(cwd)).toBe(false);
  }, 30_000);
});

describe('AI actions with Codex (headless)', () => {
  it('runs exec in the read-only sandbox with images first, and resumes its thread for a follow-up', async () => {
    const { s, ask, note, answered, tools } = await setupAi({ engine: 'codex' });
    const image = (await s.attachments.importBytes({ kind: 'document', originalName: 'chart.png', bytes: makePng(2, 2) })).attachment;
    save(s, note.id, { type: 'doc', content: [paragraph('The budget is due in March.'), { type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: image.id, name: 'chart.png', sizeBytes: image.sizeBytes, mime: image.mime } }] });
    const { thread } = await ask({ files: [{ type: 'attachment', id: image.id }] });
    const first = await answered(thread);
    expect(first.comments[1]).toMatchObject({ role: 'assistant', ai: { engine: 'codex', costUsd: null } });
    expect(first.comments[1]!.body).toContain('Fake Codex answer (new thread). Files: 1-chart.png.');
    const run = tools.runs()[0]!;
    expect(run.args).toEqual(['exec', '-i', '1-chart.png', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=read-only', '-s', 'read-only', '-']);
    const codexThread = (JSON.parse(s.row<{ meta: string }>("SELECT meta FROM comments WHERE role = 'assistant'")!.meta) as { sessionId: string }).sessionId;

    s.settings.setInternal('ai.codexModel', 'gpt-5.5');
    await answered((await s.ai.followUp({ threadId: thread.id, prompt: 'Why?' })).thread);
    const resumed = tools.runs()[1]!;
    expect(resumed.args).toEqual(['exec', 'resume', '--json', '--skip-git-repo-check', '-m', 'gpt-5.5', '-c', 'sandbox_mode=read-only', codexThread, '-']);
    expect(resumed.prompt).toBe('Why?');
  });
});

describe('AI actions on the APIs (official SDKs, fake transport)', () => {
  it('Anthropic: adaptive thinking, the effort, server-side fallbacks, files as blocks, the history on a follow-up', async () => {
    const { s, ask, answered, requests, replies, note } = await setupAi({ engine: 'anthropic-api' });
    s.ai.setKey('anthropic', 'sk-ant-test-key-123');
    s.settings.setInternal('ai.anthropicEffort', 'high');
    const pdf = (await s.attachments.importBytes({ kind: 'document', originalName: 'report.pdf', bytes: fixtureBytes('sample.pdf') })).attachment;
    save(s, note.id, { type: 'doc', content: [paragraph('The budget is due in March.'), { type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: pdf.id, name: 'report.pdf', sizeBytes: pdf.sizeBytes, mime: pdf.mime } }] });
    replies.push(anthropicStream('Claude says hi'));
    const first = await answered((await ask({ files: [{ type: 'attachment', id: pdf.id }] })).thread);
    expect(first.comments[1]).toMatchObject({ role: 'assistant', body: 'Claude says hi', ai: { engine: 'anthropic-api', model: 'claude-opus-5-5' } });
    const req = requests[0]!;
    expect(req.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(req.headers.get('x-api-key')).toBe('sk-ant-test-key-123');
    expect(req.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, output_config: { effort: 'high' }, fallbacks: 'default' });
    expect(req.body).not.toHaveProperty('thinking');
    const content = (req.body.messages as Array<{ content: Array<{ type: string }> }>)[0]!.content;
    expect(content.map((b) => b.type)).toEqual(['document', 'text']);

    replies.push(anthropicStream('Second'));
    await answered((await s.ai.followUp({ threadId: first.id, prompt: 'More?' })).thread);
    const messages = requests[1]!.body.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0]!.content.map((b) => b.type)).toEqual(['document', 'text']);
    expect(messages[1]!.content[0]!.text).toBe('Claude says hi');
    expect(messages[2]!.content[0]!.text).toBe('More?');
  });

  it('Anthropic: a refusal, a cut answer and a refused key read clearly; the key file never holds the key in the clear', async () => {
    const { s, ask, answered, replies } = await setupAi({ engine: 'anthropic-api' });
    expect(await s.ai.status()).toMatchObject({ problem: AI_MESSAGES.noKey('Anthropic') });
    await expect(ask()).rejects.toMatchObject({ message: AI_MESSAGES.noKey('Anthropic') });
    s.ai.setKey('anthropic', 'sk-ant-secret-value-999');
    const keyFile = path.join(s.t.dir, 'ai-keys.json');
    expect(fs.readFileSync(keyFile, 'utf8')).not.toContain('sk-ant-secret-value-999');
    expect(s.ai.config().keys).toEqual({ anthropic: true, openai: false });

    replies.push(anthropicStream('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'Not with this.' } }));
    expect((await answered((await ask()).thread)).comments[1]).toMatchObject({ role: 'error', body: 'Claude declined to answer: Not with this.' });
    replies.push(anthropicStream('Partial', { stop_reason: 'max_tokens' }));
    expect((await answered((await ask()).thread)).comments[1]!.body).toBe(`Partial\n\n_${AI_MESSAGES.maxTokens}_`);
    replies.push(jsonReply(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    expect((await answered((await ask()).thread)).comments[1]).toMatchObject({ role: 'error', body: 'Anthropic refused the API key. Check it in Settings → AI.' });

    s.ai.setKey('anthropic', null);
    expect(fs.existsSync(keyFile)).toBe(false);
  });

  it('OpenAI: the Responses API with the history and store off; a model check for Test', async () => {
    const { s, ask, answered, requests, replies } = await setupAi({ engine: 'openai-api' });
    s.ai.setKey('openai', 'sk-openai-test-key');
    replies.push(jsonReply(200, openAiResponse('OpenAI answer')));
    const first = await answered((await ask({ action: 'custom', prompt: 'What is due?' })).thread);
    expect(first.comments.map((c) => [c.role, c.body])).toEqual([
      ['user', 'What is due?'],
      ['assistant', 'OpenAI answer'],
    ]);
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/responses');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer sk-openai-test-key');
    expect(requests[0]!.body).toMatchObject({ model: 'gpt-5.5', store: false });
    expect(JSON.stringify(requests[0]!.body.input)).toContain('What is due?');

    replies.push(jsonReply(200, { id: 'gpt-5.5', object: 'model', created: 1, owned_by: 'openai' }));
    expect(await s.ai.test('openai-api')).toEqual({ ok: true, message: 'The key works; gpt-5.5 is available.' });
    // The SDK tries a rate-limited request three times.
    for (let i = 0; i < 3; i += 1) replies.push(jsonReply(429, { error: { message: 'quota', type: 'insufficient_quota' } }));
    expect((await answered((await ask()).thread)).comments[1]!.body).toBe("OpenAI's rate limit or quota was reached. Try again later.");
  });
});

describe('what may be sent (D-190)', () => {
  it('nothing runs while AI actions are off or the notice was not confirmed', async () => {
    const { s, ask, tools } = await setupAi();
    s.settings.setInternal('ai.acknowledged', []);
    await expect(ask()).rejects.toMatchObject({ code: 'FORBIDDEN', message: AI_MESSAGES.notice });
    expect((await s.ai.acknowledge('claude-code')).acknowledged).toBe(true);
    s.settings.setInternal('ai.enabled', false);
    await expect(ask()).rejects.toMatchObject({ code: 'FORBIDDEN', message: AI_MESSAGES.off });
    expect(tools.runs()).toEqual([]);
    expect(s.rows('SELECT id FROM comment_threads')).toEqual([]);
  });

  it('a locked note is never sent, even while unlocked; locking seals its AI threads, which still open with the key', async () => {
    const { s, ask, mark, answered, note, target, tools } = await setupAi();
    const { thread } = await ask();
    mark(thread.id);
    await answered(thread);
    await s.locks.lock({ noteId: note.id, password: PASSWORD, hello: false });
    expect(s.rows('SELECT id FROM comments WHERE body IS NOT NULL OR meta IS NOT NULL')).toEqual([]);
    await s.locks.unlock({ noteId: note.id, password: PASSWORD });
    expect(s.rows('SELECT id FROM comments WHERE sealed_meta IS NULL')).toEqual([]);
    for (const r of s.rows<{ sealed_meta: Buffer }>('SELECT sealed_meta FROM comments')) expect(r.sealed_meta.toString('latin1')).not.toContain('claude-code');

    // Unlocked for this session: the thread reads as it was, but nothing more is sent.
    const listed = s.comments.list(target).threads[0]!;
    expect(listed.comments.map((c) => c.role)).toEqual(['user', 'assistant']);
    expect(listed.comments[1]!.ai).toMatchObject({ engine: 'claude-code', costUsd: 0.0042 });
    await expect(ask()).rejects.toMatchObject({ code: 'FORBIDDEN', message: AI_MESSAGES.locked });
    await expect(s.ai.followUp({ threadId: thread.id, prompt: 'more' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: AI_MESSAGES.locked });
    await expect(s.ai.fileOptions(target)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tools.runs()).toHaveLength(1);

    await s.locks.remove({ noteId: note.id, password: PASSWORD });
    expect(s.rows('SELECT id FROM comments WHERE meta IS NULL')).toEqual([]);
  });

  it('AI on documents: PDFs and web pages only; a PDF page without text is sent as the PDF; a locked document never', async () => {
    const { s, tools } = await setupAi();
    s.dialogQueue.push([path.resolve('tests/fixtures/documents/sample.pdf')]);
    const pick = await s.documents.pickFiles(CTX);
    const { document } = await s.documents.addPicked({ pickId: pick.pickId!, index: 0, action: 'copy', location: COMMON }, CTX);
    const target = { kind: 'document' as const, id: document.id };
    const { thread } = await s.ai.ask({ target, anchor: { type: 'pdf', page: 1, rect: null }, quote: '', selection: '', action: 'summarize', prompt: '', wholeItem: false, files: [], picked: null }, CTX);
    const done = (await s.ai.wait(thread.id)).thread;
    expect(done.comments[0]!.ai!.attachments).toEqual([{ name: `${document.title}.pdf`, sizeBytes: expect.any(Number) }]);
    expect(tools.runs()[0]!.files).toHaveLength(1);
    expect(tools.runs()[0]!.prompt).toContain('No text is selected: the part is Page 1 of the attached document.');

    const { document: sheet } = await s.documents.createBlank('xlsx', COMMON, 'Budget');
    await expect(
      s.ai.ask({ target: { kind: 'document', id: sheet.id }, anchor: { type: 'cell', sheet: 'Sheet1', row: 0, col: 0 }, quote: '', selection: 'x', action: 'explain', prompt: '', wholeItem: false, files: [], picked: null }, CTX),
    ).rejects.toMatchObject({ message: AI_MESSAGES.documentKind });

    await s.documentLocks.lock({ documentId: document.id, password: PASSWORD, hello: false, copyIn: false });
    await expect(s.ai.followUp({ threadId: thread.id, prompt: 'more' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: AI_MESSAGES.locked });
    expect(s.rows("SELECT id FROM comments WHERE body IS NOT NULL OR meta IS NOT NULL")).toEqual([]);
  });

  it('deleting a running thread stops it; trash and restore keep the thread with its note', async () => {
    const { s, ask, mark, env, tools, note, target } = await setupAi();
    env.FAKE_AI_MODE = 'hang';
    const { thread } = await ask();
    mark(thread.id);
    await expect.poll(() => tools.runs().length, { timeout: 10_000 }).toBe(1);
    expect(await s.ai.deleteThread(thread.id)).toEqual({ deleted: true });
    await expect.poll(() => processAlive(tools.runs()[0]!.pid), { timeout: 10_000 }).toBe(false);
    expect(s.rows('SELECT id FROM comment_threads')).toEqual([]);

    env.FAKE_AI_MODE = 'answer';
    const kept = await ask();
    await s.ai.wait(kept.thread.id);
    const { trashBatchId } = s.trash.trashNote(note.id);
    await expect(ask()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    s.trash.restore(trashBatchId);
    expect(s.comments.list(target).threads.map((t) => t.id)).toEqual([kept.thread.id]);
  }, 30_000);

  it('portable exports carry AI threads with their details but never a session; imports resume nothing', async () => {
    const { s, ask, mark, answered } = await setupAi();
    const { thread } = await ask();
    mark(thread.id);
    await answered(thread);
    const file = tmpFile('ai.infinityexport');
    s.pathQueue.push(file);
    await s.portability.exportPortable(CTX);
    const b = await setupAi();
    b.s.pathQueue.push(file);
    await b.s.portability.importPortable(CTX);
    const imported = b.s.hierarchy.list().notes.find((n) => n.title === 'Plan' && n.id !== b.note.id)!;
    const [t] = b.s.comments.list({ kind: 'note', id: imported.id }).threads;
    // The quote follows the marked text, as a comment's does.
    expect(t).toMatchObject({ kind: 'ai', quote: 'The budget is due in March.' });
    expect(t!.comments.map((c) => [c.role, c.ai?.engine])).toEqual([
      ['user', 'claude-code'],
      ['assistant', 'claude-code'],
    ]);
    expect(b.s.rows<{ meta: string }>('SELECT meta FROM comments').every((r) => JSON.parse(r.meta).sessionId === null)).toBe(true);
    // A follow-up on the imported thread starts a new session with the conversation.
    await b.answered((await b.s.ai.followUp({ threadId: t!.id, prompt: 'Again?' })).thread);
    expect(b.tools.runs()[0]!.args).not.toContain('--resume');
    expect(b.tools.runs()[0]!.prompt).toContain('Fake Claude answer');
  });
});
