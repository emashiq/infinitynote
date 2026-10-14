import { z } from 'zod';

/**
 * The engines AI actions run on (D-190): the Claude Code and Codex command-line tools installed on this computer
 * (headless, signed in as the user is there), or the Anthropic and OpenAI APIs with a key the user entered.
 */
export const AI_ENGINES = ['claude-code', 'codex', 'anthropic-api', 'openai-api'] as const;
export const AiEngineSchema = z.enum(AI_ENGINES);
export type AiEngine = z.infer<typeof AiEngineSchema>;

/** The command-line tools, by the name they have on PATH. */
export const AI_CLIS = ['claude', 'codex'] as const;
export const AiCliSchema = z.enum(AI_CLIS);
export type AiCli = z.infer<typeof AiCliSchema>;

/** The API providers whose keys the app stores (encrypted by the OS, never in the database). */
export const AI_PROVIDERS = ['anthropic', 'openai'] as const;
export const AiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export type AiEngineInfo =
  | {
      label: string;
      kind: 'cli';
      cli: AiCli;
      destination: string;
      /** What the tool may read on this computer (D-195), as measured with the installed tool. */
      access: string;
      /** Where the tool keeps its own record of each conversation, out of the app's reach. */
      transcripts: string;
    }
  | { label: string; kind: 'api'; provider: AiProvider; destination: string };

export const AI_ENGINE_INFO: Readonly<Record<AiEngine, AiEngineInfo>> = {
  'claude-code': {
    label: 'Claude Code (headless)',
    kind: 'cli',
    cli: 'claude',
    destination: 'Claude Code on this computer, which sends them to Anthropic',
    access: 'Claude Code may read only the copies of the attached files in its private working folder.',
    transcripts: '~/.claude',
  },
  codex: {
    label: 'OpenAI Codex (headless)',
    kind: 'cli',
    cli: 'codex',
    destination: 'Codex on this computer, which sends them to OpenAI',
    access: "Codex's read-only sandbox stops it from changing files, but it can read other files your account can read.",
    transcripts: '~/.codex',
  },
  'anthropic-api': { label: 'Anthropic API', kind: 'api', provider: 'anthropic', destination: "Anthropic's API (api.anthropic.com) with your API key" },
  'openai-api': { label: 'OpenAI API', kind: 'api', provider: 'openai', destination: "OpenAI's API (api.openai.com) with your API key" },
};

export const AI_CLI_LABEL: Readonly<Record<AiCli, string>> = { claude: 'Claude Code', codex: 'Codex' };
export const AI_PROVIDER_LABEL: Readonly<Record<AiProvider, string>> = { anthropic: 'Anthropic', openai: 'OpenAI' };

/** The engine that runs a command-line tool, and the engine of an API provider. */
export const CLI_ENGINE: Readonly<Record<AiCli, AiEngine>> = { claude: 'claude-code', codex: 'codex' };
export const PROVIDER_ENGINE: Readonly<Record<AiProvider, AiEngine>> = { anthropic: 'anthropic-api', openai: 'openai-api' };

/**
 * The one-time notice before the first action on an engine: what is sent where, and for a command-line tool what it may
 * read and that it keeps its own conversation record, which locking a note later cannot remove.
 */
export function aiNotice(engine: AiEngine): string {
  const info = AI_ENGINE_INFO[engine];
  const sent = `The selected part and the files you attach are sent to ${info.destination}. Nothing is sent until you run an action, and locked notes and documents are never sent.`;
  if (info.kind === 'api') return sent;
  return `${sent} ${info.access} ${AI_CLI_LABEL[info.cli]} keeps its own record of the conversation in ${info.transcripts}, which Infinity Notes cannot remove if you lock the note later.`;
}

/** Anthropic API models and effort levels (adaptive thinking is the models' default; D-191). */
export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export const AnthropicModelSchema = z.enum(ANTHROPIC_MODELS);
export const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AnthropicEffortSchema = z.enum(ANTHROPIC_EFFORTS);
export type AnthropicEffort = z.infer<typeof AnthropicEffortSchema>;

/** The OpenAI model the installed `openai` SDK's README uses (D-191); any model name can be set instead. */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.5';

/**
 * A model name as one plain token (letters, digits, dot, dash, colon, underscore). Model names reach a command line as
 * an argument, so nothing else is allowed in them.
 */
export const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const ModelNameSchema = z.string().regex(MODEL_NAME_RE, 'Use a model name such as gpt-5.5 (letters, digits, dots and dashes)');
/** A command-line tool's model: '' uses the tool's own default. */
export const CliModelSchema = z.union([z.literal(''), ModelNameSchema]);

/** How long one action may run before it is stopped, in minutes. */
export const AI_TIMEOUT_MINUTES = { min: 1, max: 30, default: 5 } as const;
