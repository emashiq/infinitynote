import { describe, expect, it } from 'vitest';
import { CHANNEL_SCHEMAS, EVENT_SCHEMAS } from '../../src/shared/contracts/channels';
import { TreeChangedEvent, TreeChangedReasons } from '../../src/shared/contracts/hierarchy';
import { SETTINGS, SettingsSetRequest } from '../../src/shared/contracts/settings';
import { StickyState, StoredBounds } from '../../src/shared/contracts/stickies';
import { AppOpenNoteEvent, WindowGetStateResponse } from '../../src/shared/contracts/windows';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const state = { noteId: ID, title: 'Groceries', color: 'yellow', path: ['Common'], trashed: null, collapsed: false, alwaysOnTop: false, activation: 1 };

describe('Phase 04 contracts (D-062, D-063)', () => {
  it('sticky requests take a canonical note id, strictly', () => {
    for (const ch of ['sticky:float', 'sticky:dock', 'sticky:hide', 'sticky:remove', 'sticky:restore'] as const) {
      const req = CHANNEL_SCHEMAS[ch].request;
      expect(req.safeParse({ noteId: ID }).success, ch).toBe(true);
      expect(req.safeParse({ noteId: 'abc' }).success, ch).toBe(false);
      expect(req.safeParse({ noteId: ID.toUpperCase() }).success, ch).toBe(false);
      expect(req.safeParse({ noteId: ID, extra: 1 }).success, ch).toBe(false);
      expect(req.safeParse({}).success, ch).toBe(false);
    }
  });

  it('header requests validate color and booleans', () => {
    expect(CHANNEL_SCHEMAS['sticky:setColor'].request.safeParse({ noteId: ID, color: 'violet' }).success).toBe(true);
    expect(CHANNEL_SCHEMAS['sticky:setColor'].request.safeParse({ noteId: ID, color: 'red' }).success).toBe(false);
    expect(CHANNEL_SCHEMAS['sticky:setPinned'].request.safeParse({ noteId: ID, pinned: true }).success).toBe(true);
    expect(CHANNEL_SCHEMAS['sticky:setPinned'].request.safeParse({ noteId: ID, pinned: 'yes' }).success).toBe(false);
    expect(CHANNEL_SCHEMAS['sticky:setCollapsed'].request.safeParse({ noteId: ID, collapsed: false }).success).toBe(true);
    expect(CHANNEL_SCHEMAS['sticky:setCollapsed'].request.safeParse({ noteId: ID }).success).toBe(false);
  });

  it('responses: float, setColor (state or null), window state', () => {
    expect(CHANNEL_SCHEMAS['sticky:float'].response.safeParse({ noteId: ID, created: true }).success).toBe(true);
    expect(CHANNEL_SCHEMAS['sticky:setColor'].response.safeParse(null).success).toBe(true);
    expect(CHANNEL_SCHEMAS['sticky:setColor'].response.safeParse(state).success).toBe(true);
    expect(CHANNEL_SCHEMAS['window:getState'].request.safeParse({}).success).toBe(true);
    expect(CHANNEL_SCHEMAS['window:getState'].request.safeParse({ noteId: ID }).success).toBe(false);
    expect(WindowGetStateResponse.safeParse({ role: 'main', openNotes: [{ noteId: ID, takeEdit: true }] }).success).toBe(true);
    expect(WindowGetStateResponse.safeParse({ role: 'sticky', sticky: state }).success).toBe(true);
    expect(WindowGetStateResponse.safeParse({ role: 'sticky', openNotes: [] }).success).toBe(false);
    expect(WindowGetStateResponse.safeParse({ role: 'main', openNotes: Array.from({ length: 51 }, () => ({ noteId: ID, takeEdit: false })) }).success).toBe(false);
  });

  it('StickyState limits: title, path depth, activation, trashed shape, strict keys', () => {
    expect(StickyState.safeParse(state).success).toBe(true);
    expect(StickyState.safeParse({ ...state, trashed: { batchId: ID } }).success).toBe(true);
    expect(StickyState.safeParse({ ...state, trashed: { batchId: null } }).success).toBe(true);
    expect(StickyState.safeParse({ ...state, title: 'x'.repeat(201) }).success).toBe(false);
    expect(StickyState.safeParse({ ...state, path: Array.from({ length: 67 }, () => 'f') }).success).toBe(false);
    expect(StickyState.safeParse({ ...state, activation: -1 }).success).toBe(false);
    expect(StickyState.safeParse({ ...state, activation: 1.5 }).success).toBe(false);
    expect(StickyState.safeParse({ ...state, extra: true }).success).toBe(false);
  });

  it('StoredBounds: integers, nullable position, size limits', () => {
    expect(StoredBounds.safeParse({ x: -1920, y: 0, width: 320, height: 300 }).success).toBe(true);
    expect(StoredBounds.safeParse({ x: null, y: null, width: 320, height: 36 }).success).toBe(true);
    expect(StoredBounds.safeParse({ x: 1.5, y: 0, width: 320, height: 300 }).success).toBe(false);
    expect(StoredBounds.safeParse({ x: 0, y: 0, width: 99, height: 300 }).success).toBe(false);
    expect(StoredBounds.safeParse({ x: 0, y: 0, width: 320, height: 35 }).success).toBe(false);
    expect(StoredBounds.safeParse({ x: 0, y: 0, width: 20_001, height: 300 }).success).toBe(false);
    expect(StoredBounds.safeParse({ y: 0, width: 320, height: 300 }).success).toBe(false);
  });

  it('events: sticky:state and app:openNote', () => {
    expect(EVENT_SCHEMAS['sticky:state'].safeParse(state).success).toBe(true);
    expect(EVENT_SCHEMAS['app:openNote'].safeParse({ noteId: ID, takeEdit: true }).success).toBe(true);
    expect(AppOpenNoteEvent.safeParse({ noteId: ID }).success).toBe(false);
  });

  it('tree:changed gains the reason sticky', () => {
    expect(TreeChangedReasons).toContain('sticky');
    expect(TreeChangedEvent.safeParse({ reason: 'sticky', trashedNoteIds: [] }).success).toBe(true);
  });

  it('settings: app.closeBehavior and stickies.restoreOnStartup are public with the planned defaults', () => {
    expect(SETTINGS['app.closeBehavior']).toMatchObject({ default: 'ask', public: true });
    expect(SETTINGS['stickies.restoreOnStartup']).toMatchObject({ default: false, public: true });
    for (const value of ['ask', 'background', 'quit']) expect(SettingsSetRequest.safeParse({ key: 'app.closeBehavior', value }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'app.closeBehavior', value: 'minimize' }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'stickies.restoreOnStartup', value: 'yes' }).success).toBe(false);
  });
});
