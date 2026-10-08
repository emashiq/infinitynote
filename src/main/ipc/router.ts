import type { z } from 'zod';
import { INVOKE_CHANNELS, type InvokeChannel } from '../../shared/contracts/channel-names';
import { CHANNEL_SCHEMAS, type ChannelRequest, type ChannelResponse } from '../../shared/contracts/channels';
import { fail, ok, type Result } from '../../shared/contracts/envelope';
import { AppError, errorDetail } from '../services/app-error';
import type { Logger } from '../services/logger';
import type { IpcEventLike, SenderPolicy } from './sender-policy';

export const DEFAULT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, payload: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

export interface HandlerContext {
  webContentsId: number;
}

export type Handler<C extends InvokeChannel> = (
  request: ChannelRequest<C>,
  ctx: HandlerContext,
) => ChannelResponse<C> | Promise<ChannelResponse<C>>;

export interface RegisterOptions {
  /** Upper bound for the measured request size; defaults to 5 MB. */
  maxPayloadBytes?: number;
  /** Size of a request in bytes; defaults to its JSON length. Channels with binary fields measure them directly. */
  measurePayload?: (payload: unknown) => number;
  /** The message of the LIMIT_EXCEEDED answer for an oversized request; defaults to a generic one. */
  tooLargeMessage?: string;
}

/** The JSON length of a request, the default size measure. Throws for values JSON cannot encode. */
export function jsonByteLength(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload ?? null));
}

export interface IpcRouter {
  /** Registers the handler for a catalogue channel; the request and response schemas come from CHANNEL_SCHEMAS. */
  register<C extends InvokeChannel>(channel: C, handler: Handler<C>, options?: RegisterOptions): void;
  dispose(): void;
}

function firstIssuePath(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? issue.path.map(String).join('.') : '';
}

/**
 * Wraps every handler with the sender policy, a payload size limit, Zod request validation, optional
 * response validation (development builds) and the `{ok, data} | {ok:false, error}` envelope.
 */
export function createIpcRouter(options: {
  ipcMain: IpcMainLike;
  senderPolicy: SenderPolicy;
  logger: Logger;
  validateResponses: boolean;
}): IpcRouter {
  const { ipcMain, senderPolicy, logger, validateResponses } = options;
  const registered = new Set<string>();

  async function dispatch(
    channel: InvokeChannel,
    handler: (request: unknown, ctx: HandlerContext) => unknown,
    limits: Required<RegisterOptions>,
    event: IpcEventLike,
    payload: unknown,
  ): Promise<Result<unknown>> {
    if (!senderPolicy(event)) {
      logger.warn(`ipc: forbidden sender channel=${channel}`);
      return fail('FORBIDDEN', 'Not allowed');
    }
    let size: number;
    try {
      size = limits.measurePayload(payload);
    } catch {
      return fail('VALIDATION_FAILED', 'Invalid request');
    }
    if (size > limits.maxPayloadBytes) return fail('LIMIT_EXCEEDED', limits.tooLargeMessage);

    const { request, response } = CHANNEL_SCHEMAS[channel];
    const parsed = request.safeParse(payload ?? {});
    if (!parsed.success) {
      const where = firstIssuePath(parsed.error);
      return fail('VALIDATION_FAILED', where ? `Invalid request: ${where}` : 'Invalid request');
    }
    try {
      const data = await handler(parsed.data, { webContentsId: event.sender.id });
      if (validateResponses) {
        const check = response.safeParse(data);
        if (!check.success) {
          logger.error(`ipc: response schema mismatch channel=${channel} at=${firstIssuePath(check.error)}`);
          return fail('INTERNAL', 'Something went wrong');
        }
      }
      return ok(data);
    } catch (err) {
      if (err instanceof AppError) return fail(err.code, err.message, err.details);
      logger.error(`ipc: handler failed channel=${channel} ${errorDetail(err)}`);
      return fail('INTERNAL', 'Something went wrong');
    }
  }

  return {
    register(channel, handler, registerOptions = {}) {
      if (!(INVOKE_CHANNELS as readonly string[]).includes(channel)) {
        throw new Error(`Channel is not in the IPC catalogue: ${channel}`);
      }
      if (registered.has(channel)) throw new Error(`Channel already registered: ${channel}`);
      registered.add(channel);
      const limits: Required<RegisterOptions> = {
        maxPayloadBytes: registerOptions.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
        measurePayload: registerOptions.measurePayload ?? jsonByteLength,
        tooLargeMessage: registerOptions.tooLargeMessage ?? 'Request is too large',
      };
      const untyped = handler as (request: unknown, ctx: HandlerContext) => unknown;
      ipcMain.handle(channel, (event, payload) => dispatch(channel, untyped, limits, event, payload));
    },
    dispose() {
      for (const channel of registered) ipcMain.removeHandler(channel);
      registered.clear();
    },
  };
}
