import type { z } from 'zod';
import { INVOKE_CHANNELS, type InvokeChannel } from '../../shared/contracts/channel-names';
import { fail, ok, type Result } from '../../shared/contracts/envelope';
import { AppError } from '../services/app-error';
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

export interface HandlerDef {
  channel: InvokeChannel;
  request: z.ZodType;
  response: z.ZodType;
  handler: (payload: never, ctx: HandlerContext) => unknown | Promise<unknown>;
  maxPayloadBytes?: number;
}

export interface IpcRouter {
  register(def: HandlerDef): void;
  dispose(): void;
}

function firstIssuePath(error: z.ZodError): string {
  const issue = error.issues[0];
  const parts = issue ? issue.path.map((p) => String(p)) : [];
  return parts.length > 0 ? parts.join('.') : '';
}

export function createIpcRouter(options: {
  ipcMain: IpcMainLike;
  senderPolicy: SenderPolicy;
  logger: Logger;
  validateResponses: boolean;
}): IpcRouter {
  const { ipcMain, senderPolicy, logger, validateResponses } = options;
  const registered = new Set<string>();

  async function dispatch(def: HandlerDef, event: IpcEventLike, payload: unknown): Promise<Result<unknown>> {
    if (!senderPolicy(event)) {
      logger.warn(`ipc: forbidden sender channel=${def.channel}`);
      return fail('FORBIDDEN', 'Not allowed');
    }
    let size: number;
    try {
      size = Buffer.byteLength(JSON.stringify(payload ?? null));
    } catch {
      return fail('VALIDATION_FAILED', 'Invalid request');
    }
    if (size > (def.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES)) {
      return fail('LIMIT_EXCEEDED', 'Request is too large');
    }
    const parsed = def.request.safeParse(payload ?? {});
    if (!parsed.success) {
      const where = firstIssuePath(parsed.error);
      return fail('VALIDATION_FAILED', where ? `Invalid request: ${where}` : 'Invalid request');
    }
    try {
      const data = await def.handler(parsed.data as never, { webContentsId: event.sender.id });
      if (validateResponses) {
        const check = def.response.safeParse(data);
        if (!check.success) {
          logger.error(`ipc: response schema mismatch channel=${def.channel} at=${firstIssuePath(check.error)}`);
          return fail('INTERNAL', 'Something went wrong');
        }
      }
      return ok(data);
    } catch (err) {
      if (err instanceof AppError) return fail(err.code, err.message, err.details);
      logger.error(`ipc: handler failed channel=${def.channel} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return fail('INTERNAL', 'Something went wrong');
    }
  }

  return {
    register(def) {
      if (!(INVOKE_CHANNELS as readonly string[]).includes(def.channel)) {
        throw new Error(`Channel is not in the IPC catalogue: ${def.channel}`);
      }
      if (registered.has(def.channel)) throw new Error(`Channel already registered: ${def.channel}`);
      registered.add(def.channel);
      ipcMain.handle(def.channel, (event, payload) => dispatch(def, event, payload));
    },
    dispose() {
      for (const channel of registered) ipcMain.removeHandler(channel);
      registered.clear();
    },
  };
}
