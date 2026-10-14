import type { AnthropicEffort } from '../../../shared/ai/engines';
import { AI_MESSAGES } from '../../../shared/ai/limits';
import type { FetchLike } from '../../services/network-guard';
import { EngineError, type EngineAnswer, type EngineBlock, type EngineTurn } from './engine';

/** Room for a long answer; the stream is read to the end with finalMessage(). */
const MAX_TOKENS = 32_000;
/** The beta of server-side refusal fallbacks, typed by the pinned SDK (0.133.0; D-191). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicRequest {
  apiKey: string;
  model: string;
  effort: AnthropicEffort;
  system: string;
  /** Oldest first; the last is the new question. */
  turns: readonly EngineTurn[];
  /** Images and PDFs of the first question, sent before its text. */
  blocks: readonly EngineBlock[];
  fetch: FetchLike;
  signal: AbortSignal;
  /** Tests point the SDK at a local server; the app never sets it. */
  baseURL?: string;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title: string };

function blockOf(block: EngineBlock): ContentBlock {
  const data = block.bytes.toString('base64');
  if (block.kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: block.name };
  return { type: 'image', source: { type: 'base64', media_type: block.mime as 'image/png', data } };
}

/** The conversation as Messages API turns: the first question carries the images and PDFs before its text. */
export function anthropicMessages(turns: readonly EngineTurn[], blocks: readonly EngineBlock[]): Array<{ role: 'user' | 'assistant'; content: ContentBlock[] }> {
  return turns.map((turn, i) => ({
    role: turn.role,
    content: i === 0 ? [...blocks.map(blockOf), { type: 'text', text: turn.text }] : [{ type: 'text', text: turn.text }],
  }));
}

/**
 * Runs the conversation on the Messages API with the official SDK (D-191): adaptive thinking (no `thinking` field),
 * the effort from Settings, streaming read to the final message, server-side fallbacks for refusals. A refusal that
 * stands is an error with its reason; an answer cut at the token limit says so.
 */
export async function runAnthropic(req: AnthropicRequest): Promise<EngineAnswer> {
  const sdk = await import('@anthropic-ai/sdk');
  const client = new sdk.default({ apiKey: req.apiKey, fetch: req.fetch, maxRetries: 2, ...(req.baseURL ? { baseURL: req.baseURL } : {}) });
  try {
    const stream = client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: MAX_TOKENS,
        system: req.system,
        output_config: { effort: req.effort },
        messages: anthropicMessages(req.turns, req.blocks),
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      },
      { signal: req.signal },
    );
    const message = await stream.finalMessage();
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (message.stop_reason === 'refusal') {
      const why = message.stop_details?.explanation;
      throw new EngineError(`Claude declined to answer${why ? `: ${why}` : '.'}`);
    }
    if (text === '') throw new EngineError('Claude returned no text.');
    return { text, sessionId: null, model: message.model, costUsd: null, notice: message.stop_reason === 'max_tokens' ? AI_MESSAGES.maxTokens : null };
  } catch (err) {
    throw anthropicError(err, sdk, req.signal);
  }
}

/** Settings → AI "Test": the key is accepted and the chosen model is there (a model lookup, no prompt). */
export async function checkAnthropicKey(req: Pick<AnthropicRequest, 'apiKey' | 'model' | 'fetch' | 'signal' | 'baseURL'>): Promise<string> {
  const sdk = await import('@anthropic-ai/sdk');
  const client = new sdk.default({ apiKey: req.apiKey, fetch: req.fetch, maxRetries: 1, ...(req.baseURL ? { baseURL: req.baseURL } : {}) });
  try {
    const model = await client.models.retrieve(req.model, null, { signal: req.signal });
    return `The key works; ${model.display_name} is available.`;
  } catch (err) {
    throw anthropicError(err, sdk, req.signal);
  }
}

/** The SDK's typed errors as messages people can act on; an abort passes through as the signal's reason. */
function anthropicError(err: unknown, sdk: typeof import('@anthropic-ai/sdk'), signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason;
  if (err instanceof EngineError) return err;
  if (err instanceof sdk.AuthenticationError) return new EngineError('Anthropic refused the API key. Check it in Settings → AI.');
  if (err instanceof sdk.PermissionDeniedError) return new EngineError('This API key may not use this model.');
  if (err instanceof sdk.RateLimitError) return new EngineError("Anthropic's rate limit was reached. Try again in a moment.");
  if (err instanceof sdk.APIConnectionError) return new EngineError("Anthropic's API could not be reached.");
  if (err instanceof sdk.APIError) return new EngineError(`Anthropic's API answered with an error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
  return err;
}
