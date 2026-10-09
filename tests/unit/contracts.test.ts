import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHANNEL_SCHEMAS, EVENT_SCHEMAS } from '../../src/shared/contracts/channels';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../../src/shared/contracts/channel-names';
import { ERROR_CODES, fail, ok } from '../../src/shared/contracts/envelope';
import {
  LeaseAcquireRequest,
  LeaseAcquireResponse,
  LeaseReleaseRequest,
  LeaseReleaseResponse,
  LeaseTakeRequest,
  LeaseTakeResponse,
  NoteLeaseEvent,
  NoteRevisionEvent,
  NoteSaveAck,
  NoteSaveRequest,
} from '../../src/shared/contracts/notes';
import { SETTINGS, SettingsGetRequest, SettingsSetRequest } from '../../src/shared/contracts/settings';

const base = () => ({
  noteId: randomUUID(),
  viewId: randomUUID(),
  leaseToken: randomUUID(),
  baseRevision: 0,
  requestId: randomUUID(),
});
const richDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

describe('note:save schema (INF-FND-13)', () => {
  it('accepts valid rich and plain saves', () => {
    expect(NoteSaveRequest.safeParse({ ...base(), format: 'rich', content: richDoc, title: 'T' }).success).toBe(true);
    expect(NoteSaveRequest.safeParse({ ...base(), format: 'plain', content: 'hello' }).success).toBe(true);
    expect(NoteSaveRequest.safeParse({ ...base(), format: 'rich', content: { type: 'doc' } }).success).toBe(true);
  });

  it('rejects malformed requests', () => {
    const ok1 = { ...base(), format: 'plain', content: 'x' };
    expect(NoteSaveRequest.safeParse({ ...ok1, noteId: 'not-a-uuid' }).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...ok1, noteId: randomUUID().toUpperCase() }).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...ok1, baseRevision: -1 }).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...ok1, baseRevision: 1.5 }).success).toBe(false);
    const { requestId: _omit, ...noRequest } = ok1;
    expect(NoteSaveRequest.safeParse(noRequest).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...ok1, extra: 1 }).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...ok1, title: 'x'.repeat(201) }).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...base(), format: 'rich', content: 'a string' }).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...base(), format: 'plain', content: richDoc }).success).toBe(false);
    expect(NoteSaveRequest.safeParse({ ...base(), format: 'rich', content: { type: 'not-doc' } }).success).toBe(false);
  });

  it('defines ack, lease and event shapes', () => {
    const id = randomUUID();
    expect(NoteSaveAck.safeParse({ noteId: id, revision: 1, requestId: id, updatedAt: 5 }).success).toBe(true);
    expect(LeaseAcquireRequest.safeParse({ noteId: id, viewId: id }).success).toBe(true);
    expect(LeaseAcquireResponse.safeParse({ granted: true, leaseToken: id }).success).toBe(true);
    expect(LeaseAcquireResponse.safeParse({ granted: false, holderViewId: id }).success).toBe(true);
    expect(LeaseAcquireResponse.safeParse({ granted: true }).success).toBe(false);
    expect(LeaseReleaseRequest.safeParse({ noteId: id, viewId: id, leaseToken: id }).success).toBe(true);
    expect(LeaseReleaseResponse.safeParse({ released: true }).success).toBe(true);
    expect(LeaseTakeRequest.safeParse({ noteId: id, viewId: id }).success).toBe(true);
    expect(LeaseTakeResponse.safeParse({ leaseToken: id }).success).toBe(true);
    expect(NoteRevisionEvent.safeParse({ noteId: id, revision: 2, sourceViewId: id }).success).toBe(true);
    expect(NoteLeaseEvent.safeParse({ noteId: id, holderViewId: null }).success).toBe(true);
  });
});

describe('IPC contract catalogue (INF-FND-04)', () => {
  it('ERROR_CODES are exactly the nine codes', () => {
    expect([...ERROR_CODES]).toEqual([
      'VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT', 'LEASE_REQUIRED', 'CYCLE', 'LIMIT_EXCEEDED', 'UNSUPPORTED', 'FORBIDDEN', 'INTERNAL',
    ]);
  });

  it('envelope helpers build the documented shape', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(fail('NOT_FOUND', 'nope')).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } });
    expect(fail('CONFLICT', 'x', { n: 1 })).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'x', details: { n: 1 } } });
  });

  it('every invoke channel has request and response schemas and vice versa', () => {
    expect(Object.keys(CHANNEL_SCHEMAS).sort()).toEqual([...INVOKE_CHANNELS].sort());
    for (const ch of INVOKE_CHANNELS) {
      expect(CHANNEL_SCHEMAS[ch].request).toBeDefined();
      expect(CHANNEL_SCHEMAS[ch].response).toBeDefined();
    }
  });

  it('event channels are the Phase 01-05 events (D-052, D-063, D-074)', () => {
    const events = [
      'settings:changed',
      'tree:changed',
      'note:revision',
      'note:lease',
      'lease:release-request',
      'app:flush-request',
      'sticky:state',
      'app:openNote',
      'reminder:changed',
      'reminder:alert',
      'widget:state',
      'app:openReminders',
    ];
    expect([...EVENT_CHANNELS]).toEqual(events);
    expect(Object.keys(EVENT_SCHEMAS)).toEqual(events);
  });

  it('the Phase 03 channels are in the catalogue in order (D-052)', () => {
    expect(INVOKE_CHANNELS.slice(31, 41)).toEqual([
      'lease:take',
      'note:convertFormat',
      'versions:list',
      'versions:restore',
      'drafts:list',
      'drafts:resolve',
      'attachment:importBytes',
      'attachment:importFromDialog',
      'shell:openExternal',
      'app:flushed',
    ]);
  });

  it('the Phase 04 channels are appended in order (D-063)', () => {
    expect(INVOKE_CHANNELS.slice(41, 50)).toEqual([
      'sticky:float',
      'sticky:dock',
      'sticky:hide',
      'sticky:setColor',
      'sticky:setPinned',
      'sticky:setCollapsed',
      'sticky:remove',
      'sticky:restore',
      'window:getState',
    ]);
  });

  it('no Phase 07 channel is registered in Phase 06, and note:trashed was not added (D-063, D-089)', () => {
    const all: string[] = [...INVOKE_CHANNELS, ...EVENT_CHANNELS];
    for (const name of ['refs:list', 'search:query', 'notes:pick', 'attachment:open', 'attachment:showInFolder', 'tags:list', 'tags:set', 'note:trashed', 'sticky:removeSticky', 'attachment:importImageBytes']) {
      expect(all, name).not.toContain(name);
    }
    expect(all).toContain('note:save');
    expect(all).toContain('lease:take');
  });

  it('empty-request channels are strict objects', () => {
    expect(CHANNEL_SCHEMAS['app:getInfo'].request.safeParse({}).success).toBe(true);
    expect(CHANNEL_SCHEMAS['app:getInfo'].request.safeParse({ x: 1 }).success).toBe(false);
  });
});

describe('settings registry', () => {
  it('every default passes its own schema', () => {
    for (const [key, entry] of Object.entries(SETTINGS)) {
      expect(entry.schema.safeParse(entry.default).success, key).toBe(true);
    }
  });

  it('settings:set union rejects unknown keys and bad values', () => {
    expect(SettingsSetRequest.safeParse({ key: 'appearance.theme', value: 'dark' }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'appearance.theme', value: 'neon' }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'x.y', value: 1 }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'appearance.theme', value: 'dark', extra: 1 }).success).toBe(false);
  });

  it('settings:get keys are registry keys, unique and bounded', () => {
    expect(SettingsGetRequest.safeParse({ keys: ['appearance.theme'] }).success).toBe(true);
    expect(SettingsGetRequest.safeParse({ keys: [] }).success).toBe(false);
    expect(SettingsGetRequest.safeParse({ keys: ['appearance.theme', 'appearance.theme'] }).success).toBe(false);
    expect(SettingsGetRequest.safeParse({ keys: ["appearance.theme'; DROP TABLE settings;--"] }).success).toBe(false);
  });
});
