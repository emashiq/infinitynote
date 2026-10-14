import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlacedFile, PreparedFile } from '../../src/main/ai/ai-context';
import { fileKindByName } from '../../src/main/ai/ai-context';
import { AiKeys, createMemoryTextProtector, safeStorageTextProtector } from '../../src/main/ai/ai-keys';
import { aiMessageInfo, parseAiMeta } from '../../src/main/ai/ai-meta';
import { AI_SYSTEM_PROMPT, cliPrompt, deliverFiles, firstQuestionText, workNameOf } from '../../src/main/ai/ai-prompt';
import { conversation, lastSession } from '../../src/main/ai/ai-service';
import { memoryLogger } from '../../src/main/services/logger';
import { questionText } from '../../src/shared/ai/actions';
import { AI_MESSAGES, MAX_AI_API_IMAGE_BYTES } from '../../src/shared/ai/limits';

const file = (name: string, kind: PreparedFile['kind'], over: Partial<PreparedFile> = {}): PreparedFile => ({
  name,
  kind,
  sizeBytes: 2048,
  mime: kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'text/plain',
  bytes: Buffer.from('x'),
  text: kind === 'text' ? 'file words' : null,
  extracted: false,
  ...over,
});

/** Files as an action gathers them: the item's in their place from 1. */
const placed = (...files: PreparedFile[]): PlacedFile[] => files.map((f, i) => ({ file: f, place: i + 1 }));
const SESSION = '2e4f1174-5130-4768-b9d0-3cfc68c03853';
const THREAD = '01a13943-3bd3-70a1-a127-313160df450c';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('what an action sends (D-190)', () => {
  it('names files in the working folder in safe characters only', () => {
    expect(workNameOf(file('Budget Q3 (final).xlsx', 'text', { extracted: true }), 1)).toBe('1-Budget_Q3_final.txt');
    expect(workNameOf(file('chart.PNG', 'image'), 2)).toBe('2-chart.png');
    expect(workNameOf(file('..\\..\\evil;rm -rf.pdf', 'pdf'), 3)).toBe('3-evil_rm_-rf.pdf');
    expect(workNameOf(file('Ünïcode', 'text'), 4)).toBe('4-n_code');
    expect(workNameOf(file('ちず.png', 'image'), 0)).toBe('0-file.png');
  });

  it('a tool reads copies in its folder; an API gets images and PDFs as blocks and text inline, large images not at all', () => {
    const files = placed(file('a.png', 'image'), file('b.pdf', 'pdf'), file('c.txt', 'text'), file('big.png', 'image', { sizeBytes: MAX_AI_API_IMAGE_BYTES + 1 }));
    expect(deliverFiles(files, 'cli').map((d) => (d.how === 'folder' ? d.workName : d.how))).toEqual(['1-a.png', '2-b.pdf', '3-c.txt', '4-big.png']);
    expect(deliverFiles(files, 'api').map((d) => d.how)).toEqual(['block', 'block', 'inline', 'skipped']);
  });

  it('a file keeps its name across a thread’s turns: its place, not its position in the turn’s list (D-195)', () => {
    // The first question had the item's file (place 1), a picked file (place 2) and the whole PDF (place 0); a follow-up
    // sends the item's file and the PDF again without the picked file, under the same names.
    const first = deliverFiles([{ file: file('notes.md', 'text'), place: 1 }, { file: file('scan.png', 'image'), place: 2 }, { file: file('Plan.pdf', 'pdf'), place: 0 }], 'cli');
    const later = deliverFiles([{ file: file('notes.md', 'text'), place: 1 }, { file: file('Plan.pdf', 'pdf'), place: 0 }], 'cli');
    const names = (ds: typeof first) => ds.map((d) => (d.how === 'folder' ? d.workName : d.how));
    expect(names(first)).toEqual(['1-notes.md', '2-scan.png', '0-Plan.pdf']);
    expect(names(later)).toEqual(['1-notes.md', '0-Plan.pdf']);
  });

  it('the first question holds the part, the whole item, the files and the task, the material tagged apart from it', () => {
    const text = firstQuestionText({
      item: 'the note “Plan”',
      place: '',
      selection: 'Pay rent',
      whole: 'Pay rent\nCall Ann',
      files: deliverFiles(placed(file('c.txt', 'text'), file('a.png', 'image')), 'api'),
      action: 'summarize',
      prompt: 'in French',
    });
    expect(text).toContain('The user selected a part of the note “Plan”.');
    expect(text).toContain('<selection>\nPay rent\n</selection>');
    expect(text).toContain('<whole_item>\nPay rent\nCall Ann\n</whole_item>');
    expect(text).toContain('- c.txt (2.0 KB): its text follows');
    expect(text).toContain('- a.png (2.0 KB): attached above');
    expect(text).toContain('<file name="c.txt">\nfile words\n</file>');
    expect(text).toMatch(/Task: Summarize the selected part briefly.*\n<user_note>\nin French\n<\/user_note>$/);

    const page = firstQuestionText({ item: 'the PDF document “Report”', place: 'Page 3', selection: '', whole: null, files: [], action: 'custom', prompt: 'What is on it?' });
    expect(page).toContain('No text is selected: the part is Page 3 of the attached document.');
    expect(page).toContain('<question>\nWhat is on it?\n</question>');
    expect(page).not.toContain('Task:');
  });

  it('the thread shows the preset, the added words, or the question', () => {
    expect(questionText('analyze', '')).toBe('Analyze');
    expect(questionText('actionItems', 'owners only')).toBe('Action items: owners only');
    expect(questionText('custom', 'Why?')).toBe('Why?');
  });
});

describe('follow-ups (D-190)', () => {
  const meta = (engine: 'claude-code' | 'codex', sessionId: string | null) => ({ engine, model: null, sessionId, costUsd: null, attachments: [] });

  it('a new session gets the instructions and the whole conversation, ending with the new question', () => {
    expect(cliPrompt([{ role: 'user', text: 'first' }])).toBe(`${AI_SYSTEM_PROMPT}\n\nfirst`);
    const turns = conversation(
      'first question',
      [
        { role: 'assistant', body: 'answer one', meta: meta('claude-code', SESSION) },
        { role: 'user', body: 'second', meta: null },
        { role: 'error', body: 'Stopped', meta: null },
        { role: 'user', body: 'second again', meta: null },
        { role: 'assistant', body: 'answer two', meta: meta('claude-code', SESSION) },
      ],
      'third',
    );
    // An error leaves out its turn; two questions in a row become one, so the roles alternate.
    expect(turns).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: 'answer one' },
      { role: 'user', text: 'second\n\nsecond again' },
      { role: 'assistant', text: 'answer two' },
      { role: 'user', text: 'third' },
    ]);
    const prompt = cliPrompt(turns);
    expect(prompt.startsWith(`${AI_SYSTEM_PROMPT}\n\nfirst question\n\nThe conversation so far:`)).toBe(true);
    expect(prompt).toContain('<assistant>\nanswer two\n</assistant>');
    expect(prompt.endsWith('New question:\n<question>\nthird\n</question>')).toBe(true);
  });

  it('a tool resumes only a session its own engine left in the last answer', () => {
    const messages = [
      { role: 'user' as const, body: 'q', meta: null },
      { role: 'assistant' as const, body: 'a', meta: meta('claude-code', SESSION) },
      { role: 'user' as const, body: 'q2', meta: null },
      { role: 'error' as const, body: 'Stopped', meta: meta('codex', null) },
    ];
    expect(lastSession(messages, 'claude-code')).toBe(SESSION);
    expect(lastSession(messages, 'codex')).toBeNull();
    expect(lastSession([...messages, { role: 'assistant', body: 'b', meta: meta('codex', THREAD) }], 'claude-code')).toBeNull();
  });

  it('stored meta reads back for the thread without its session; broken meta reads as none', () => {
    const parsed = parseAiMeta(JSON.stringify({ engine: 'codex', model: 'gpt-5.5', sessionId: THREAD, costUsd: null, attachments: [{ name: 'a.txt', sizeBytes: 3 }] }));
    expect(aiMessageInfo(parsed!)).toEqual({ engine: 'codex', model: 'gpt-5.5', costUsd: null, attachments: [{ name: 'a.txt', sizeBytes: 3 }] });
    expect(parsed!.sessionId).toBe(THREAD);
    expect(parseAiMeta('{"engine":"gemini"}')).toBeNull();
    expect(parseAiMeta('not json')).toBeNull();
    expect(parseAiMeta(null)).toBeNull();
  });

  it('a stored session that is not a session ID is read as none, so it never reaches a command line (D-195)', () => {
    for (const bad of ['--dangerously-bypass-approvals-and-sandbox', '-s', 't', 'a b', `${SESSION}x`]) {
      const parsed = parseAiMeta(JSON.stringify({ engine: 'codex', model: null, sessionId: bad, costUsd: null, attachments: [] }));
      expect(parsed, bad).toMatchObject({ engine: 'codex', sessionId: null });
      expect(lastSession([{ role: 'assistant', body: 'a', meta: parsed }], 'codex'), bad).toBeNull();
    }
  });

  it('files are offered by their kind; programs and unknown files are not', () => {
    expect(['a.png', 'b.JPG', 'c.pdf', 'd.docx', 'e.md', 'f.csv', 'g.html', 'h.exe', 'i.zip', 'j'].map(fileKindByName)).toEqual(['image', 'image', 'pdf', 'text', 'text', 'text', 'text', null, null, null]);
  });
});

describe('API keys (D-193)', () => {
  it('are stored encrypted outside the data folder, read back for a request, and removed with the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-keys-'));
    dirs.push(dir);
    const keysFile = path.join(dir, 'ai-keys.json');
    const keys = new AiKeys(keysFile, createMemoryTextProtector(), memoryLogger());
    expect(keys.has('openai')).toBe(false);
    keys.set('openai', 'sk-live-0123456789');
    expect(keys.has('openai')).toBe(true);
    expect(keys.get('openai')).toBe('sk-live-0123456789');
    expect(fs.readFileSync(keysFile, 'utf8')).not.toContain('sk-live');
    keys.set('anthropic', 'sk-ant-0123456789');
    keys.set('openai', null);
    expect([keys.has('openai'), keys.has('anthropic')]).toEqual([false, true]);
    keys.set('anthropic', null);
    expect(fs.existsSync(keysFile)).toBe(false);
    // A key another process sealed (or a damaged file) reads as no key.
    fs.writeFileSync(keysFile, JSON.stringify({ openai: Buffer.from('junk').toString('base64') }));
    expect(keys.get('openai')).toBeNull();
    fs.writeFileSync(keysFile, '{broken');
    expect(keys.has('openai')).toBe(false);
  });

  it('are never stored without OS encryption (a Linux desktop without a keyring)', () => {
    const fake = { isEncryptionAvailable: () => true, encryptString: (t: string) => Buffer.from(t), decryptString: (b: Buffer) => b.toString(), getSelectedStorageBackend: () => 'basic_text' };
    expect(safeStorageTextProtector(fake, 'linux').available()).toBe(false);
    expect(safeStorageTextProtector({ ...fake, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux').available()).toBe(true);
    expect(safeStorageTextProtector(fake, 'win32').available()).toBe(true);
    const keys = new AiKeys(path.join(os.tmpdir(), `never-${Date.now()}.json`), safeStorageTextProtector(fake, 'linux'), memoryLogger());
    expect(keys.canStore()).toBe(false);
    expect(() => keys.set('openai', 'sk-0123456789')).toThrow(AI_MESSAGES.keyStorage);
  });
});
