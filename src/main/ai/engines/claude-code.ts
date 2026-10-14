import { EngineError, isSessionId, optionValue, outputTail, sessionArg, type EngineAnswer } from './engine';

/** The built-in tools Claude Code may use: reading files only (no shell, edits or web; D-192). */
export const CLAUDE_READ_TOOLS = 'Read,Glob,Grep';

/**
 * The arguments of a headless Claude Code run (`claude --help`, 2.1.293): print mode with one JSON result, the prompt
 * on stdin and only the read tools offered. `--restricted` confines the file tools to the working folder and ignores
 * the user's, project and local settings files (so no hooks or allow rules from them); `dontAsk` refuses without a
 * prompt whatever needs approval, which is every read outside the working folder (no allow rule is passed for them);
 * no MCP servers. A follow-up resumes the session.
 */
export function claudeArgs(opts: { model: string; sessionId: string | null }): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--restricted',
    '--tools',
    CLAUDE_READ_TOOLS,
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    ...(opts.model ? ['--model', optionValue(opts.model)] : []),
    ...(opts.sessionId ? ['--resume', sessionArg(opts.sessionId)] : []),
  ];
}

interface ClaudeResult {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  session_id?: unknown;
  total_cost_usd?: unknown;
  modelUsage?: unknown;
}

/** The result object: the whole output, or its last line that is a JSON result (warnings may come first). */
function resultOf(stdout: string): ClaudeResult | null {
  const candidates = [stdout.trim(), ...stdout.split(/\r?\n/).reverse()];
  for (const text of candidates) {
    if (!text.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(text) as ClaudeResult;
      if (parsed && typeof parsed === 'object' && parsed.type === 'result') return parsed;
    } catch {
      // not this one
    }
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The model that answered: Claude Code also uses a small model for its own housekeeping, so `modelUsage` names several;
 * the one that cost the most did the work.
 */
function answeringModel(usage: unknown): string | null {
  if (!usage || typeof usage !== 'object') return null;
  const cost = (entry: unknown) => (entry && typeof entry === 'object' && typeof (entry as { costUSD?: unknown }).costUSD === 'number' ? (entry as { costUSD: number }).costUSD : 0);
  const ranked = Object.entries(usage).sort(([, a], [, b]) => cost(b) - cost(a));
  return ranked[0]?.[0] ?? null;
}

/** Reads Claude Code's JSON result: the answer, the session to resume, the cost and the model; its errors as EngineError. */
export function parseClaudeOutput(out: { code: number | null; stdout: string; stderr: string }): EngineAnswer {
  const result = resultOf(out.stdout);
  if (!result) {
    const detail = outputTail(out.stderr) || outputTail(out.stdout);
    throw new EngineError(`Claude Code ended without an answer${out.code !== null ? ` (exit code ${out.code})` : ''}${detail ? `: ${detail}` : ''}`);
  }
  const text = str(result.result);
  if (result.is_error === true || text === null) {
    const reason = text ?? (str(result.subtype) ? `it stopped (${String(result.subtype)})` : 'no answer');
    throw new EngineError(`Claude Code: ${reason}`);
  }
  const cost = typeof result.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd) && result.total_cost_usd >= 0 ? result.total_cost_usd : null;
  return { text, sessionId: isSessionId(result.session_id) ? result.session_id : null, model: answeringModel(result.modelUsage), costUsd: cost, notice: null };
}
