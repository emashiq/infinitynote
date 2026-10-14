import { EngineError, isSessionId, optionValue, outputTail, sessionArg, type EngineAnswer } from './engine';

/**
 * The arguments of a headless Codex run (`codex exec --help`, 0.162.1): JSONL events, the read-only sandbox (also as
 * a config override, since `exec resume` has no `--sandbox`), no Git repository needed, the prompt on stdin (`-`).
 * Images go first, so the variadic `-i` never takes another argument as an image. A follow-up resumes the thread.
 */
export function codexArgs(opts: { model: string; sessionId: string | null; images: readonly string[] }): string[] {
  const shared = [
    ...opts.images.flatMap((image) => ['-i', optionValue(image)]),
    '--json',
    '--skip-git-repo-check',
    ...(opts.model ? ['-m', optionValue(opts.model)] : []),
    '-c',
    'sandbox_mode=read-only',
  ];
  return opts.sessionId ? ['exec', 'resume', ...shared, sessionArg(opts.sessionId), '-'] : ['exec', ...shared, '-s', 'read-only', '-'];
}

interface CodexEvent {
  type?: unknown;
  thread_id?: unknown;
  message?: unknown;
  error?: { message?: unknown } | null;
  item?: { type?: unknown; item_type?: unknown; text?: unknown } | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Reads Codex's JSONL events: `thread.started` names the thread to resume, the last completed `agent_message` is the
 * answer, and `turn.failed` or `error` is what went wrong. Lines that are not events are ignored.
 */
export function parseCodexOutput(out: { code: number | null; stdout: string; stderr: string }, model: string): EngineAnswer {
  let threadId: string | null = null;
  let answer: string | null = null;
  let failure: string | null = null;
  for (const line of out.stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    if (event.type === 'thread.started') threadId = isSessionId(event.thread_id) ? event.thread_id : threadId;
    else if (event.type === 'item.completed' && (event.item?.type ?? event.item?.item_type) === 'agent_message') answer = str(event.item?.text) ?? answer;
    else if (event.type === 'turn.failed') failure = str(event.error?.message) ?? 'the turn failed';
    else if (event.type === 'error') failure = str(event.message) ?? failure ?? 'an error occurred';
  }
  if (answer === null) {
    const detail = failure ?? (outputTail(out.stderr) || null);
    throw new EngineError(`Codex ended without an answer${out.code !== null && out.code !== 0 ? ` (exit code ${out.code})` : ''}${detail ? `: ${detail}` : ''}`);
  }
  return { text: answer, sessionId: threadId, model: model || null, costUsd: null, notice: null };
}
