import { AI_MESSAGES } from '../../../shared/ai/limits';
import type { FetchLike } from '../../services/network-guard';
import { EngineError, type EngineAnswer, type EngineBlock, type EngineTurn } from './engine';

export interface OpenAiRequest {
  apiKey: string;
  model: string;
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

type InputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'auto' }
  | { type: 'input_file'; filename: string; file_data: string };

function partOf(block: EngineBlock): InputPart {
  const url = `data:${block.mime};base64,${block.bytes.toString('base64')}`;
  return block.kind === 'pdf' ? { type: 'input_file', filename: block.name, file_data: url } : { type: 'input_image', image_url: url, detail: 'auto' };
}

/** The conversation as Responses API input: the first question carries the images and PDFs before its text. */
export function openAiInput(turns: readonly EngineTurn[], blocks: readonly EngineBlock[]): Array<{ role: 'user' | 'assistant'; content: string | InputPart[] }> {
  return turns.map((turn, i) =>
    turn.role === 'assistant' ? { role: 'assistant', content: turn.text } : { role: 'user', content: [...(i === 0 ? blocks.map(partOf) : []), { type: 'input_text', text: turn.text }] },
  );
}

/**
 * Runs the conversation on the Responses API with the official SDK (D-191). The history goes with every request and
 * nothing is stored on OpenAI's side (`store: false`). A refusal is an error with its words; an answer cut at the
 * output limit says so.
 */
export async function runOpenAi(req: OpenAiRequest): Promise<EngineAnswer> {
  const sdk = await import('openai');
  const client = new sdk.default({ apiKey: req.apiKey, fetch: req.fetch, maxRetries: 2, ...(req.baseURL ? { baseURL: req.baseURL } : {}) });
  try {
    const response = await client.responses.create({ model: req.model, instructions: req.system, input: openAiInput(req.turns, req.blocks), store: false }, { signal: req.signal });
    const refusal = response.output
      .flatMap((item) => (item.type === 'message' ? item.content : []))
      .flatMap((part) => (part.type === 'refusal' ? [part.refusal] : []))
      .join(' ')
      .trim();
    const text = response.output_text.trim();
    if (text === '' && refusal !== '') throw new EngineError(`The model declined to answer: ${refusal}`);
    if (response.status === 'failed') throw new EngineError(`OpenAI could not answer${response.error?.message ? `: ${response.error.message}` : '.'}`);
    if (text === '') throw new EngineError('The model returned no text.');
    const cut = response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens';
    return { text, sessionId: null, model: response.model, costUsd: null, notice: cut ? AI_MESSAGES.maxTokens : null };
  } catch (err) {
    throw openAiError(err, sdk, req.signal);
  }
}

/** Settings → AI "Test": the key is accepted and the chosen model is there (a model lookup, no prompt). */
export async function checkOpenAiKey(req: Pick<OpenAiRequest, 'apiKey' | 'model' | 'fetch' | 'signal' | 'baseURL'>): Promise<string> {
  const sdk = await import('openai');
  const client = new sdk.default({ apiKey: req.apiKey, fetch: req.fetch, maxRetries: 1, ...(req.baseURL ? { baseURL: req.baseURL } : {}) });
  try {
    const model = await client.models.retrieve(req.model, { signal: req.signal });
    return `The key works; ${model.id} is available.`;
  } catch (err) {
    throw openAiError(err, sdk, req.signal);
  }
}

/** The SDK's typed errors as messages people can act on; an abort passes through as the signal's reason. */
function openAiError(err: unknown, sdk: typeof import('openai'), signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason;
  if (err instanceof EngineError) return err;
  if (err instanceof sdk.AuthenticationError) return new EngineError('OpenAI refused the API key. Check it in Settings → AI.');
  if (err instanceof sdk.PermissionDeniedError) return new EngineError('This API key may not use this model.');
  if (err instanceof sdk.NotFoundError) return new EngineError('OpenAI does not know this model. Check the model name in Settings → AI.');
  if (err instanceof sdk.RateLimitError) return new EngineError("OpenAI's rate limit or quota was reached. Try again later.");
  if (err instanceof sdk.APIConnectionError) return new EngineError("OpenAI's API could not be reached.");
  if (err instanceof sdk.APIError) return new EngineError(`OpenAI's API answered with an error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
  return err;
}
