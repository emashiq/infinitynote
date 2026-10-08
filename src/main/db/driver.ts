export interface Statement<P extends unknown[] = unknown[], R = unknown> {
  run(...p: P): { changes: number; lastInsertRowid: number | bigint };
  get(...p: P): R | undefined;
  all(...p: P): R[];
}

export interface Db {
  readonly driverName: 'better-sqlite3' | 'node:sqlite';
  readonly sqliteVersion: string;
  exec(sql: string): void;
  prepare<P extends unknown[] = unknown[], R = unknown>(sql: string): Statement<P, R>;
  /** Runs fn inside a transaction; rolls back on throw. */
  transaction<T>(fn: () => T, mode?: 'deferred' | 'immediate'): T;
  pragma(sql: string): unknown[];
  pragmaValue(sql: string): unknown;
  backup(destFile: string): Promise<void>;
  close(): void;
}

export interface OpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeoutMs?: number;
}
