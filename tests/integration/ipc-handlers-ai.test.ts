import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { AI_MESSAGES, MAX_AI_PROMPT_CHARS } from '../../src/shared/ai/limits';
import { installFakeAiTools } from '../support/fake-ai-tools';
import { setupServices } from './hierarchy-helpers';
import { mkTmp } from './helpers';
import { catalogueRouter } from './ipc-helpers';

const MAIN = 1;
const STICKY = 3;
const WIDGET = 4;
const BLOCK = randomUUID();
const FORBIDDEN = { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } };

const app: AppHandlerDeps = {
  getInfo: () => {
    throw new Error('not used');
  },
  getCapabilities: () => {
    throw new Error('not used');
  },
  shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: () => {} },
  dataDir: '/data',
  quit: () => {},
  flushed: () => false,
};

/** The catalogue over the real services with the fake tools; window 3 is the sticky window of `own`. */
async function setup() {
  const tools = installFakeAiTools(path.join(mkTmp('infinity-ai-ipc-'), 'bin'));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')), PATH: tools.dir, FAKE_AI_LOG: tools.log };
  const s = await setupServices({ ai: { env } });
  s.settings.setInternal('ai.enabled', true);
  s.settings.setInternal('ai.acknowledged', ['claude-code']);
  const own = s.note(null, null, 'Own');
  const other = s.note(null, null, 'Other');
  for (const id of [own.id, other.id]) {
    s.writer.save({
      noteId: id,
      viewId: randomUUID(),
      baseRevision: s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', id)!.revision,
      requestId: randomUUID(),
      format: 'rich',
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: BLOCK }, content: [{ type: 'text', text: 'Pay the rent' }] }] },
    });
  }
  const r = catalogueRouter(s.services, app, { stickyNoteId: own.id });
  const ask = (noteId: string, from: number, over: Record<string, unknown> = {}) =>
    r.call(
      'ai:ask',
      { target: { kind: 'note', id: noteId }, anchor: { type: 'text', blockId: BLOCK }, quote: 'rent', selection: 'Pay the rent', action: 'summarize', prompt: '', wholeItem: false, files: [], picked: null, ...over },
      from,
    );
  return { s, r, own, other, ask, tools };
}

describe('AI channels (D-190)', () => {
  it('a sticky runs actions on its own note only, and never reaches keys, programs or the test', async () => {
    const { r, own, other, ask, tools } = await setup();
    const asked = await ask(own.id, STICKY);
    expect(asked).toMatchObject({ ok: true, data: { thread: { kind: 'ai', running: true } } });
    const threadId = asked.data.thread.id as string;
    expect((await r.call('ai:wait', { threadId }, STICKY)).data.thread.comments.map((c: { role: string }) => c.role)).toEqual(['user', 'assistant']);
    expect(tools.runs()).toHaveLength(1);

    expect(await ask(other.id, STICKY)).toEqual(FORBIDDEN);
    const otherThread = (await ask(other.id, MAIN)).data.thread.id as string;
    for (const [channel, payload] of [
      ['ai:followUp', { threadId: otherThread, prompt: 'more' }],
      ['ai:wait', { threadId: otherThread }],
      ['ai:stop', { threadId: otherThread }],
      ['ai:thread', { threadId: otherThread }],
      ['ai:deleteThread', { threadId: otherThread }],
      ['ai:context', { target: { kind: 'note', id: other.id } }],
    ] as const) {
      expect(await r.call(channel, payload, STICKY), channel).toEqual(FORBIDDEN);
    }
    for (const [channel, payload] of [
      ['ai:config', {}],
      ['ai:setKey', { provider: 'openai', key: 'sk-0123456789abcdef' }],
      ['ai:cliPath', { cli: 'claude', action: 'pick' }],
      ['ai:test', { engine: 'claude-code' }],
    ] as const) {
      expect(await r.call(channel, payload, STICKY), channel).toEqual(FORBIDDEN);
    }
    for (const channel of ['ai:status', 'ai:ask', 'ai:config'] as const) expect(await r.call(channel, {}, WIDGET), channel).toEqual(FORBIDDEN);
    expect((await r.call('ai:deleteThread', { threadId }, STICKY)).ok).toBe(true);
    await r.call('ai:wait', { threadId: otherThread }, MAIN);
  });

  it('requests are validated: a question is needed for a custom action and has a limit; keys are one token', async () => {
    const { r, own, ask } = await setup();
    expect(await ask(own.id, MAIN, { action: 'custom', prompt: '   ' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await ask(own.id, MAIN, { action: 'custom', prompt: 'x'.repeat(MAX_AI_PROMPT_CHARS + 1) })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await ask(own.id, MAIN, { files: Array.from({ length: 11 }, () => ({ type: 'attachment', id: randomUUID() })) })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await r.call('ai:setKey', { provider: 'openai', key: 'has a space in it' }, MAIN)).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await r.call('ai:followUp', { threadId: randomUUID(), prompt: '' }, MAIN)).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    // A file of another note is not this note's to send.
    expect(await ask(own.id, MAIN, { files: [{ type: 'attachment', id: randomUUID() }] })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: AI_MESSAGES.fileMissing } });
  });

  it('the main window reads the keys only as stored or not, and comment channels refuse AI threads', async () => {
    const { r, own, ask } = await setup();
    const config = await r.call('ai:setKey', { provider: 'anthropic', key: 'sk-ant-abcdefghijkl' }, MAIN);
    expect(config).toEqual({ ok: true, data: { keys: { anthropic: true, openai: false }, keyStorage: true, cliPaths: { claude: null, codex: null } } });
    expect(JSON.stringify(await r.call('ai:config', {}, MAIN))).not.toContain('sk-ant');
    const threadId = (await ask(own.id, MAIN)).data.thread.id as string;
    await r.call('ai:wait', { threadId }, MAIN);
    expect(await r.call('comment:reply', { threadId, body: 'hello' }, MAIN)).toMatchObject({ ok: false, error: { message: AI_MESSAGES.aiThread } });
    expect(await r.call('comment:resolve', { threadId, resolved: true }, MAIN)).toMatchObject({ ok: false, error: { message: AI_MESSAGES.aiThread } });
    const comment = await r.call('comment:create', { target: { kind: 'note', id: own.id }, anchor: { type: 'text', blockId: BLOCK }, quote: 'rent', body: 'mine' }, MAIN);
    expect(await r.call('ai:followUp', { threadId: comment.data.thread.id, prompt: 'more' }, MAIN)).toMatchObject({ ok: false, error: { message: AI_MESSAGES.notAiThread } });
    const listed = await r.call('comment:list', { target: { kind: 'note', id: own.id } }, MAIN);
    expect(listed.data.threads.map((t: { kind: string }) => t.kind).sort()).toEqual(['ai', 'comment']);
  });
});
