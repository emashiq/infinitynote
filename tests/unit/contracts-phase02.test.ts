import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHANNEL_SCHEMAS } from '../../src/shared/contracts/channels';
import { DEFAULT_SESSION } from '../../src/shared/contracts/session';
import { SETTINGS, SettingsGetRequest, SettingsSetRequest } from '../../src/shared/contracts/settings';
import { NameInput, TitleInput } from '../../src/shared/names';

const id = () => randomUUID();
const home = { id: 'home', kind: 'home' } as const;

describe('Phase 02 request schemas', () => {
  it('project:rename and project:trash accept only lower-case UUIDs (Common cannot be addressed)', () => {
    const rename = CHANNEL_SCHEMAS['project:rename'].request;
    expect(rename.safeParse({ projectId: id(), name: 'A' }).success).toBe(true);
    for (const bad of [null, 'common', '', id().toUpperCase()]) {
      expect(rename.safeParse({ projectId: bad, name: 'A' }).success, String(bad)).toBe(false);
      expect(CHANNEL_SCHEMAS['project:trash'].request.safeParse({ projectId: bad }).success, String(bad)).toBe(false);
    }
  });

  it('NameInput trims, NFC-normalizes and enforces 1..200 code points without control characters', () => {
    expect(NameInput.parse('  Alpha  ')).toBe('Alpha');
    expect(NameInput.parse('é')).toBe('é');
    expect(NameInput.safeParse('').success).toBe(false);
    expect(NameInput.safeParse('   ').success).toBe(false);
    expect(NameInput.safeParse('x'.repeat(201)).success).toBe(false);
    expect(NameInput.safeParse('a\u0007b').success).toBe(false);
    expect(NameInput.safeParse('a\u007Fb').success).toBe(false);
    expect(NameInput.safeParse('ক'.repeat(200)).success).toBe(true);
    expect(NameInput.safeParse('\u{1F600}'.repeat(200)).success).toBe(true);
    expect(NameInput.safeParse('\u{1F600}'.repeat(201)).success).toBe(false);
  });

  it('TitleInput allows empty titles but not control characters or 201 code points', () => {
    expect(TitleInput.safeParse('').success).toBe(true);
    expect(TitleInput.safeParse('x'.repeat(200)).success).toBe(true);
    expect(TitleInput.safeParse('x'.repeat(201)).success).toBe(false);
    expect(TitleInput.safeParse('a\nb').success).toBe(false);
  });

  it('trash:purge requires confirmed:true', () => {
    const req = CHANNEL_SCHEMAS['trash:purge'].request;
    expect(req.safeParse({ target: { kind: 'all' }, confirmed: true }).success).toBe(true);
    expect(req.safeParse({ target: { kind: 'batch', batchId: id() }, confirmed: true }).success).toBe(true);
    expect(req.safeParse({ target: { kind: 'all' } }).success).toBe(false);
    expect(req.safeParse({ target: { kind: 'all' }, confirmed: false }).success).toBe(false);
  });

  it('session:set rejects Home not first, duplicate ids, a missing active id, mismatched note ids and 201 tabs', () => {
    const req = CHANNEL_SCHEMAS['session:set'].request;
    const a = id();
    const note = { id: 'note:' + a, kind: 'note', noteId: a };
    expect(req.safeParse({ session: DEFAULT_SESSION }).success).toBe(true);
    expect(req.safeParse({ session: { version: 1, tabs: [home, note], activeTabId: note.id } }).success).toBe(true);
    expect(req.safeParse({ session: { version: 1, tabs: [note, home], activeTabId: 'home' } }).success).toBe(false);
    expect(req.safeParse({ session: { version: 1, tabs: [home, note, note], activeTabId: 'home' } }).success).toBe(false);
    expect(req.safeParse({ session: { version: 1, tabs: [home], activeTabId: 'note:' + a } }).success).toBe(false);
    expect(
      req.safeParse({ session: { version: 1, tabs: [home, { id: 'note:' + id(), kind: 'note', noteId: a }], activeTabId: 'home' } }).success,
    ).toBe(false);
    const many = Array.from({ length: 200 }, () => {
      const n = id();
      return { id: 'note:' + n, kind: 'note', noteId: n };
    });
    expect(req.safeParse({ session: { version: 1, tabs: [home, ...many], activeTabId: 'home' } }).success).toBe(false);
    expect(req.safeParse({ session: { version: 1, tabs: [home, ...many.slice(0, 199)], activeTabId: 'home' } }).success).toBe(true);
  });

  it('settings channels refuse the internal session key and out-of-range or malformed values', () => {
    expect(SettingsSetRequest.safeParse({ key: 'session.tabs', value: DEFAULT_SESSION }).success).toBe(false);
    expect(SettingsGetRequest.safeParse({ keys: ['session.tabs'] }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'layout.treeWidth', value: 219 }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'layout.treeWidth', value: 281 }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'layout.treeWidth', value: 220 }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'layout.treeWidth', value: 280 }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'tree.expanded', value: ['common', 'project:' + id(), 'folder:' + id()] }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'tree.expanded', value: ['note:' + id()] }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'tree.expanded', value: ['project:nope'] }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'home.scope', value: { kind: 'project', projectId: id() } }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'home.scope', value: { kind: 'project' } }).success).toBe(false);
  });

  it('every registry default passes its schema, including the new keys', () => {
    for (const [key, entry] of Object.entries(SETTINGS)) {
      expect(entry.schema.safeParse(entry.default).success, key).toBe(true);
    }
    expect(Object.keys(SETTINGS)).toEqual([
      'appearance.theme',
      'layout.treeOpen',
      'layout.treeWidth',
      'layout.panelOpen',
      'home.scope',
      'tree.expanded',
      'session.tabs',
      'attachments.imageMaxMb',
      'attachments.documentMaxMb',
    ]);
  });

  it('note:create requires a boolean sticky flag and a valid location', () => {
    const req = CHANNEL_SCHEMAS['note:create'].request;
    expect(req.safeParse({ location: { projectId: null, folderId: null }, sticky: false }).success).toBe(true);
    expect(req.safeParse({ location: { projectId: null, folderId: null } }).success).toBe(false);
    expect(req.safeParse({ location: { projectId: 'x', folderId: null }, sticky: true }).success).toBe(false);
  });
});
