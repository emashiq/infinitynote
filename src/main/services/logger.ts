import fs from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const nullLogger: Logger = { info() {}, warn() {}, error() {} };

/** In-memory logger for tests. */
export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (message: string) => {
    lines.push(`${level} ${message}`);
  };
  return { lines, info: push('INFO'), warn: push('WARN'), error: push('ERROR') };
}

const MAX_LOG_BYTES = 1024 * 1024;

export interface FileLoggerOptions {
  mirrorToConsole?: boolean;
}

/** Appends one line per event to <logsDir>/main.log, rotating at startup when over 1 MB. */
export function createFileLogger(logsDir: string, options: FileLoggerOptions = {}): Logger {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, 'main.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, path.join(logsDir, 'main.1.log'));
    }
  } catch {
    // Rotation is best effort.
  }
  const write = (level: string, message: string) => {
    const line = `${new Date().toISOString()} ${level} ${message.replace(/[\r\n]+/g, ' ')}`;
    try {
      fs.appendFileSync(file, line + '\n', 'utf8');
    } catch {
      // Logging must never crash the app.
    }
    if (options.mirrorToConsole) console.log(line);
  };
  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
  };
}
