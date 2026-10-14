import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeArgs, parseClaudeOutput } from '../../src/main/ai/engines/claude-code';
import { locateCli } from '../../src/main/ai/engines/cli-locate';
import { CliStartError, cliInvocation, runCli } from '../../src/main/ai/engines/cli-process';
import { codexArgs, parseCodexOutput } from '../../src/main/ai/engines/codex';
import { EngineError } from '../../src/main/ai/engines/engine';import { anthropicMessages } from '../../src/main/ai/engines/anthropic-api';
import { openAiInput } from '../../src/main/ai/engines/openai-api';
import { aiRequestFetch } from '../../src/main/services/network-guard';
import { memoryLogger } from '../../src/main/services/logger';

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-ai-unit-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const SESSION = '2e4f1174-5130-4768-b9d0-3cfc68c03853';
const THREAD = '01a13943-3bd3-70a1-a127-313160df450c';
/** Values that must never reach a command line where a session or a value is expected. */
const NOT_SESSIONS = ['--dangerously-bypass-approvals-and-sandbox', '-s', 'abc', 't-1', `${SESSION} x`];
const events = (...e: unknown[]) => e.map((x) => JSON.stringify(x)).join('\n');
const out = (stdout: string, stderr = '', code: number | null = 0) => ({ code, stdout, stderr });
const result = (over: Record<string, unknown> = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Hi', session_id: SESSION, total_cost_usd: 0.01, modelUsage: { 'claude-opus-5-5': {} }, ...over });

describe('Claude Code headless (D-192)', () => {
  it('offers only the read tools confined to the working folder, refuses anything else without asking, and resumes a session', () => {
    // --restricted confines Read, Glob and Grep to the working folder and ignores settings files; no allow rule widens
    // them (a blanket --allowedTools Read let a real run read a file outside the folder; D-195).
    expect(claudeArgs({ model: '', sessionId: null })).toEqual(['-p', '--output-format', 'json', '--restricted', '--tools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--strict-mcp-config']);
    expect(claudeArgs({ model: 'opus', sessionId: SESSION }).slice(-4)).toEqual(['--model', 'opus', '--resume', SESSION]);
    for (const arg of claudeArgs({ model: 'opus', sessionId: SESSION })) expect(arg).not.toMatch(/allowedTools|Bash|Edit|Write|Web|bypass|dangerously/i);
  });

  it('never passes a stored session that is not a session ID, or a value that reads as a flag', () => {
    for (const bad of NOT_SESSIONS) {
      expect(() => claudeArgs({ model: '', sessionId: bad }), bad).toThrow(EngineError);
      expect(() => codexArgs({ model: '', sessionId: bad, images: [] }), bad).toThrow(EngineError);
    }
    expect(() => claudeArgs({ model: '--dangerously-skip-permissions', sessionId: null })).toThrow(EngineError);
    expect(() => codexArgs({ model: '-s', sessionId: null, images: [] })).toThrow(EngineError);
    expect(() => codexArgs({ model: '', sessionId: null, images: ['--dangerously-bypass-approvals-and-sandbox'] })).toThrow(EngineError);
    // A tool's output naming another kind of session is not kept as one.
    expect(parseClaudeOutput(out(result({ session_id: '--resume' }))).sessionId).toBeNull();
    expect(parseCodexOutput(out(events({ type: 'thread.started', thread_id: '-x' }, { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })), '').sessionId).toBeNull();
  });

  it('reads the result, its session, cost and model, also after warnings', () => {
    expect(parseClaudeOutput(out(result()))).toEqual({ text: 'Hi', sessionId: SESSION, model: 'claude-opus-5-5', costUsd: 0.01, notice: null });
    expect(parseClaudeOutput(out(`warning: something\n${result({ total_cost_usd: -1, modelUsage: undefined })}\n`))).toMatchObject({ costUsd: null, model: null });
    // Claude Code's own small model is listed too; the one that cost the most answered (as a real 2.1.293 run reports).
    const usage = { 'claude-haiku-5-5': { outputTokens: 20, costUSD: 0.0001 }, 'claude-opus-5-5': { outputTokens: 4, costUSD: 0.03 } };
    expect(parseClaudeOutput(out(result({ modelUsage: usage }))).model).toBe('claude-opus-5-5');
  });

  it('turns its failures into the thread’s words', () => {
    expect(() => parseClaudeOutput(out(result({ is_error: true, result: 'Credit balance is too low' }), '', 1))).toThrow(new EngineError('Claude Code: Credit balance is too low'));
    expect(() => parseClaudeOutput(out(result({ is_error: true, result: null, subtype: 'error_max_turns' })))).toThrow('Claude Code: it stopped (error_max_turns)');
    expect(() => parseClaudeOutput(out('', 'Invalid API key · Please run /login\n', 1))).toThrow('Claude Code ended without an answer (exit code 1): Invalid API key · Please run /login');
    expect(() => parseClaudeOutput(out('{"type":"system"}', ''))).toThrow('Claude Code ended without an answer (exit code 0)');
  });
});

describe('Codex headless (D-192)', () => {
  it('runs exec read-only with images first, and resumes with the sandbox as a config override', () => {
    expect(codexArgs({ model: '', sessionId: null, images: [] })).toEqual(['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=read-only', '-s', 'read-only', '-']);
    expect(codexArgs({ model: 'gpt-5.5', sessionId: THREAD, images: ['1-a.png'] })).toEqual(['exec', 'resume', '-i', '1-a.png', '--json', '--skip-git-repo-check', '-m', 'gpt-5.5', '-c', 'sandbox_mode=read-only', THREAD, '-']);
  });

  it('takes the last agent message and the thread, and reports turn failures and errors', () => {
    const ok = events(
      { type: 'thread.started', thread_id: THREAD },
      { type: 'item.completed', item: { type: 'agent_message', text: 'draft' } },
      'not json',
      { type: 'item.completed', item: { item_type: 'agent_message', text: 'final' } },
      { type: 'turn.completed', usage: {} },
    );
    expect(parseCodexOutput(out(ok), 'gpt-5.5')).toEqual({ text: 'final', sessionId: THREAD, model: 'gpt-5.5', costUsd: null, notice: null });
    expect(() => parseCodexOutput(out(events({ type: 'thread.started', thread_id: 't' }, { type: 'turn.failed', error: { message: 'usage limit reached' } }), '', 1), '')).toThrow(
      'Codex ended without an answer (exit code 1): usage limit reached',
    );
    expect(() => parseCodexOutput(out(events({ type: 'error', message: 'stream disconnected' })), '')).toThrow('Codex ended without an answer: stream disconnected');
    expect(() => parseCodexOutput(out('', 'Not logged in\n', 2), '')).toThrow('Codex ended without an answer (exit code 2): Not logged in');
  });
});

describe('starting a tool (D-192)', () => {
  it('runs an npm .cmd shim through cmd.exe with the checked arguments, and anything else without a shell', () => {
    expect(cliInvocation('/usr/local/bin/claude', ['-p', '--resume', 'a-b'], 'linux')).toEqual({ command: '/usr/local/bin/claude', args: ['-p', '--resume', 'a-b'], verbatim: false });
    expect(cliInvocation('C:\\Program Files\\nodejs\\claude.cmd', ['-p', '--tools', 'Read,Glob,Grep'], 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', '""C:\\Program Files\\nodejs\\claude.cmd" -p --tools Read,Glob,Grep"'],
      verbatim: true,
    });
    expect(cliInvocation('C:\\tools\\claude.exe', ['-p'], 'win32')).toMatchObject({ command: 'C:\\tools\\claude.exe', verbatim: false });
    // No shell syntax ever reaches a command line: arguments are plain tokens, a shim path has no quote or %.
    for (const bad of ['a b', 'x&calc', '"q"', '%PATH%', 'a|b', 'a\nb', '']) expect(() => cliInvocation('/bin/claude', [bad], 'linux'), JSON.stringify(bad)).toThrow();
    for (const bad of ['C:\\a%PATH%\\claude.cmd', 'C:\\a"b\\claude.cmd', 'C:\\a!PATH!\\claude.cmd', 'C:\\a^b\\claude.cmd', 'C:\\a\tb\\claude.cmd', 'C:\\a\nb\\claude.cmd']) {
      expect(() => cliInvocation(bad, [], 'win32'), JSON.stringify(bad)).toThrow('The program path cannot be run');
    }
    expect(cliInvocation('C:\\Program Files (x86)\\A & B\\claude.cmd', ['-p'], 'win32').args[4]).toBe('""C:\\Program Files (x86)\\A & B\\claude.cmd" -p"');
  });

  it('writes the prompt to stdin and collects the output', async () => {
    const script = path.join(tmp(), 'echo.mjs');
    fs.writeFileSync(script, "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{process.stdout.write(s.toUpperCase());process.stderr.write('note');process.exit(4)})");
    const res = await runCli({ file: process.execPath, args: ['echo.mjs'], cwd: path.dirname(script), stdin: 'héllo world', signal: new AbortController().signal });
    expect(res).toEqual({ code: 4, stdout: 'HÉLLO WORLD', stderr: 'note' });
  });

  it('Stop ends the tool at once and rejects with the reason; a missing program cannot start', async () => {
    const script = path.join(tmp(), 'hang.mjs');
    fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const run = runCli({ file: process.execPath, args: ['hang.mjs'], cwd: path.dirname(script), stdin: '', signal: controller.signal });
    setTimeout(() => controller.abort(new Error('stopped by test')), 200);
    await expect(run).rejects.toThrow('stopped by test');
    await expect(runCli({ file: path.join(tmp(), 'missing-tool'), args: [], cwd: tmp(), stdin: '', signal: new AbortController().signal })).rejects.toBeInstanceOf(CliStartError);
  });

  it('finds a tool on PATH (absolute entries only) or uses the chosen program while it exists', async () => {
    const bin = tmp();
    const name = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const file = path.join(bin, name);
    fs.writeFileSync(file, process.platform === 'win32' ? '@echo 1\r\n' : '#!/bin/sh\necho 1\n');
    fs.chmodSync(file, 0o755);
    const pathVar = ['relative/dir', bin].join(path.delimiter);
    expect(await locateCli('claude', null, { PATH: pathVar, PATHEXT: '.COM;.EXE;.BAT;.CMD;.JS' })).toBe(file);
    expect(await locateCli('codex', null, { PATH: pathVar })).toBeNull();
    expect(await locateCli('claude', null, { PATH: 'relative' })).toBeNull();
    expect(await locateCli('codex', file, { PATH: '' })).toBe(file);
    expect(await locateCli('codex', path.join(bin, 'gone'), { PATH: pathVar })).toBeNull();
  });
});

describe('API requests (D-191)', () => {
  it('reach only their API host over https, and only while the action runs', async () => {
    const seen: string[] = [];
    const logger = memoryLogger();
    const guard = aiRequestFetch('api.anthropic.com', logger, async (input) => {
      seen.push(String(input));
      return new Response('{}');
    });
    await guard.fetch('https://api.anthropic.com/v1/messages');
    for (const url of ['https://evil.example/v1', 'http://api.anthropic.com/v1/messages', 'https://api.anthropic.com:8443/x', 'https://api.anthropic.com.evil.example/', 'not a url']) {
      await expect(guard.fetch(url), url).rejects.toThrow(/network: blocked/);
    }
    guard.close();
    await expect(guard.fetch('https://api.anthropic.com/v1/messages')).rejects.toThrow(/blocked/);
    expect(seen).toEqual(['https://api.anthropic.com/v1/messages']);
    expect(logger.lines.some((l) => l.includes('blocked https://evil.example'))).toBe(true);
  });

  it('refuse redirects instead of following them past the host check', async () => {
    const inits: Array<RequestInit | undefined> = [];
    const guard = aiRequestFetch('api.openai.com', memoryLogger(), async (_input, init) => {
      inits.push(init);
      return new Response('{}');
    });
    await guard.fetch('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'follow' });
    expect(inits[0]).toMatchObject({ method: 'POST', redirect: 'error' });
  });

  it('send images and PDFs before the first question’s text, then the turns as they are', () => {
    const blocks = [
      { kind: 'image' as const, name: 'a.png', mime: 'image/png', bytes: Buffer.from('png') },
      { kind: 'pdf' as const, name: 'b.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF') },
    ];
    const turns = [
      { role: 'user' as const, text: 'first' },
      { role: 'assistant' as const, text: 'answer' },
      { role: 'user' as const, text: 'again' },
    ];
    expect(anthropicMessages(turns, blocks)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('png').toString('base64') } },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF').toString('base64') }, title: 'b.pdf' },
          { type: 'text', text: 'first' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'again' }] },
    ]);
    expect(openAiInput(turns, blocks)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/png;base64,${Buffer.from('png').toString('base64')}`, detail: 'auto' },
          { type: 'input_file', filename: 'b.pdf', file_data: `data:application/pdf;base64,${Buffer.from('%PDF').toString('base64')}` },
          { type: 'input_text', text: 'first' },
        ],
      },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: [{ type: 'input_text', text: 'again' }] },
    ]);
  });
});
