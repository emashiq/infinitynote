import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AI_PROVIDERS, type AiProvider } from '../../shared/ai/engines';
import { AI_MESSAGES } from '../../shared/ai/limits';
import { newDataKey, open, seal } from '../locks/note-crypto';
import { AppError, errorMessage } from '../services/app-error';
import type { Logger } from '../services/logger';

/** Encrypts text so only this OS account can read it back (Electron safeStorage). */
export interface TextProtector {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(blob: Buffer): string;
}

/**
 * Electron safeStorage as a protector (DPAPI on Windows, the keyring on Linux). On Linux without a keyring Electron
 * falls back to `basic_text`, a fixed key anyone can undo, which does not count as encrypted here.
 */
export function safeStorageTextProtector(
  safeStorage: { isEncryptionAvailable(): boolean; encryptString(text: string): Buffer; decryptString(blob: Buffer): string; getSelectedStorageBackend?(): string },
  platform: NodeJS.Platform = process.platform,
): TextProtector {
  return {
    available: () => safeStorage.isEncryptionAvailable() && (platform !== 'linux' || safeStorage.getSelectedStorageBackend?.() !== 'basic_text'),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (blob) => safeStorage.decryptString(blob),
  };
}

/** A protector bound to this process (integration tests and the E2E hooks; never DPAPI or a keyring in tests). */
export function createMemoryTextProtector(): TextProtector {
  const secret = newDataKey();
  const owner = '00000000-0000-4000-8000-000000000000';
  return {
    available: () => true,
    encrypt: (text) => seal(secret, 'key', owner, Buffer.from(text, 'utf8')),
    decrypt: (blob) => open(secret, 'key', owner, blob).toString('utf8'),
  };
}

const KeyFile = z.partialRecord(z.enum(AI_PROVIDERS), z.string().max(4096));

/**
 * The API keys (D-193): each encrypted by the OS and kept in `<userData>/ai-keys.json`, outside the data folder, so
 * never in the database, backups, exports or logs. Renderers learn only whether a key is stored. Without OS encryption
 * no key is stored at all.
 */
export class AiKeys {
  constructor(
    private readonly file: string,
    private readonly protector: TextProtector | null,
    private readonly logger: Logger,
  ) {}

  canStore(): boolean {
    return this.protector?.available() ?? false;
  }

  has(provider: AiProvider): boolean {
    return this.read()[provider] !== undefined;
  }

  /** The key in the clear for one request, or null when none is stored or it cannot be opened any more. */
  get(provider: AiProvider): string | null {
    const sealed = this.read()[provider];
    if (sealed === undefined || !this.protector) return null;
    try {
      return this.protector.decrypt(Buffer.from(sealed, 'base64'));
    } catch (err) {
      this.logger.warn(`ai: stored key could not be opened provider=${provider} error=${errorMessage(err).slice(0, 80)}`);
      return null;
    }
  }

  /** Stores a key, or with null removes it. */
  set(provider: AiProvider, key: string | null): void {
    const keys = this.read();
    if (key === null) delete keys[provider];
    else {
      if (!this.protector || !this.canStore()) throw new AppError('UNSUPPORTED', AI_MESSAGES.keyStorage);
      keys[provider] = this.protector.encrypt(key).toString('base64');
    }
    this.write(keys);
    this.logger.info(`ai: key ${key === null ? 'removed' : 'stored'} provider=${provider}`);
  }

  private read(): Partial<Record<AiProvider, string>> {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return {};
    }
    try {
      const parsed = KeyFile.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private write(keys: Partial<Record<AiProvider, string>>): void {
    if (Object.keys(keys).length === 0) {
      fs.rmSync(this.file, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(keys), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
}
