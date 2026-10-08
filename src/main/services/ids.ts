import { randomUUID } from 'node:crypto';

export interface IdGenerator {
  uuid(): string;
}

export const systemIds: IdGenerator = { uuid: () => randomUUID() };
