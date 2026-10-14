/** A turn of an AI conversation as the engines receive it (D-190). */
export interface EngineTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** An image or PDF the API engines send as a content block with the first question. */
export interface EngineBlock {
  kind: 'image' | 'pdf';
  name: string;
  mime: string;
  bytes: Buffer;
}

/** What an engine answered. */
export interface EngineAnswer {
  text: string;
  /** The session a command-line tool resumes for a follow-up; null for the API engines. */
  sessionId: string | null;
  model: string | null;
  /** The cost the engine reported (Claude Code does), else null. */
  costUsd: number | null;
  /** Something to tell about the answer (it was cut at the length limit), or null. */
  notice: string | null;
}

/** A failure the thread shows as the answer: the engine's own words, or what went wrong reaching it. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** The tail of a command-line tool's error output, for a message (the last non-empty lines, at most 300 characters). */
export function outputTail(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tail = lines.slice(-3).join(' ');
  return tail.length > 300 ? `…${tail.slice(-300)}` : tail;
}

/** Claude Code's session IDs and Codex's thread IDs are UUIDs; nothing else is taken as a session (D-195). */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

/** The session to resume as an argument: a stored value that is not a session ID never reaches a command line. */
export function sessionArg(sessionId: string): string {
  if (!isSessionId(sessionId)) throw new EngineError('The conversation to continue is not valid. Ask the question in a new thread.');
  return sessionId;
}

/** A value that follows a flag (a model, an image): refused when the tool could read it as a flag of its own. */
export function optionValue(value: string): string {
  if (value.startsWith('-')) throw new EngineError('An argument for the tool is not allowed');
  return value;
}
