#!/usr/bin/env node
// A fake `claude` or `codex` for tests (D-190): never a real service. Usage: node fake-ai-tool.mjs <claude|codex> [args…]
// with the prompt on stdin. It logs each run (tool, arguments, working folder, its files, the prompt, its pid) as one
// JSON line to FAKE_AI_LOG and answers the way the real tool prints: Claude Code one JSON result, Codex JSONL events.
// FAKE_AI_MODE: answer (default) | error | garbage | hang | slow (waits FAKE_AI_DELAY_MS, default 1500, then answers).
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [tool, ...args] = process.argv.slice(2);
const mode = process.env.FAKE_AI_MODE ?? 'answer';

if (args.includes('--version')) {
  process.stdout.write(tool === 'claude' ? '2.1.293 (Claude Code)\n' : 'codex-cli 0.162.1\n');
  process.exit(0);
}

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => void run(Buffer.concat(chunks).toString('utf8')));

function valueAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

async function run(prompt) {
  const files = fs.readdirSync(process.cwd()).sort();
  if (process.env.FAKE_AI_LOG) fs.appendFileSync(process.env.FAKE_AI_LOG, `${JSON.stringify({ tool, args, cwd: process.cwd(), files, prompt, pid: process.pid })}\n`);
  if (mode === 'hang') {
    setInterval(() => undefined, 1000);
    return;
  }
  if (mode === 'slow') await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AI_DELAY_MS ?? 1500)));
  if (mode === 'garbage') {
    process.stdout.write('this is not json\n');
    process.stderr.write('fake tool exploded\n');
    process.exit(3);
  }
  if (tool === 'claude') claude(files);
  else codex(files);
}

function claude(files) {
  const resumed = valueAfter('--resume');
  if (mode === 'error') {
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Fake Claude failure', session_id: resumed })}\n`);
    process.exit(1);
  }
  const session = resumed ?? randomUUID();
  const text = `Fake Claude answer (${resumed ? `resumed ${resumed}` : 'new session'}). Files: ${files.join(', ') || 'none'}.\n\n- First point\n- **Second** point`;
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session, total_cost_usd: 0.0042, modelUsage: { 'claude-fake-model': {} } })}\n`);
}

function codex(files) {
  const resumeAt = args.indexOf('resume');
  const resumed = resumeAt >= 0 ? args[args.length - 2] : null;
  const thread = resumed ?? randomUUID();
  const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  emit({ type: 'thread.started', thread_id: thread });
  emit({ type: 'turn.started' });
  if (mode === 'error') {
    emit({ type: 'turn.failed', error: { message: 'Fake Codex failure' } });
    process.exit(1);
  }
  emit({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'thinking' } });
  emit({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: `Fake Codex answer (${resumed ? `resumed ${resumed}` : 'new thread'}). Files: ${files.join(', ') || 'none'}.` } });
  emit({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
}
