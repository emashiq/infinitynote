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
      'attachments.addFiles',
      'documents.office',
      'notes.mathResults',
      'ai.enabled',
      'ai.engine',
      'ai.claudeModel',
      'ai.codexModel',
      'ai.anthropicModel',
      'ai.anthropicEffort',
      'ai.openaiModel',
      'ai.timeoutMinutes',
      'ai.acknowledged',
      'ai.cliPaths',
      'app.closeBehavior',
      'window.zoom',
      'stickies.restoreOnStartup',
      'reminders.defaultZone',
      'reminders.followupDefault',
      'reminders.quietHours',
      'reminders.endOfDayTime',
      'reminders.dateOnlyTime',
      'reminders.suggestFromText',
      'retention.trashDays',
      'retention.autoVersionDays',
      'retention.autoVersionMax',
      'locks.autoLockMinutes',
      'locks.blurStickySeconds',
      'backup.auto',
      'backup.lastAuto',
      'shortcut.quickSticky',
    ]);
  });

  it('v0.4.0 AI keys: off by default, Claude Code first, models checked; programs and confirmations main-only (D-190)', () => {
    expect(SETTINGS['ai.enabled']).toMatchObject({ version: 1, default: false, public: true });
    expect(SETTINGS['ai.engine']).toMatchObject({ default: 'claude-code', public: true });
    expect(SETTINGS['ai.anthropicModel']).toMatchObject({ default: 'claude-opus-5-5', public: true });
    expect(SETTINGS['ai.anthropicEffort']).toMatchObject({ default: 'medium', public: true });
    expect(SETTINGS['ai.openaiModel']).toMatchObject({ default: 'gpt-5.5', public: true });
    expect(SETTINGS['ai.timeoutMinutes']).toMatchObject({ default: 5, public: true });
    expect(SETTINGS['ai.acknowledged']).toMatchObject({ default: [], public: false });
    expect(SETTINGS['ai.cliPaths']).toMatchObject({ default: { claude: null, codex: null }, public: false });
    expect(SettingsSetRequest.safeParse({ key: 'ai.engine', value: 'openai-api' }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'ai.engine', value: 'gemini' }).success).toBe(false);
    // A model name reaches a command line, so it is one plain token.
    expect(SettingsSetRequest.safeParse({ key: 'ai.claudeModel', value: '' }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'ai.claudeModel', value: 'opus' }).success).toBe(true);
    for (const bad of ['opus & calc', 'a b', '--danger', '"x"', 'x;y']) expect(SettingsSetRequest.safeParse({ key: 'ai.codexModel', value: bad }).success, bad).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'ai.openaiModel', value: '' }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'ai.timeoutMinutes', value: 31 }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'ai.anthropicModel', value: 'claude-sonnet-5-5' }).success).toBe(true);
    // No renderer names a program to run or confirms the notice through settings:set.
    expect(SettingsSetRequest.safeParse({ key: 'ai.cliPaths', value: { claude: 'C:\\evil.exe', codex: null } }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'ai.acknowledged', value: ['codex'] }).success).toBe(false);
  });

  it('v0.4.0 keys: Office documents off and math results suggested by default, the window zoom main-only (D-186..D-188)', () => {
    expect(SETTINGS['documents.office']).toMatchObject({ version: 1, default: false, public: true });
    expect(SETTINGS['notes.mathResults']).toMatchObject({ version: 1, default: 'suggest', public: true });
    expect(SETTINGS['window.zoom']).toMatchObject({ version: 1, default: { main: 100, sticky: 100, widget: 100 }, public: false });
    expect(SettingsSetRequest.safeParse({ key: 'documents.office', value: true }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'documents.office', value: 'yes' }).success).toBe(false);
    for (const mode of ['suggest', 'insert', 'off']) expect(SettingsSetRequest.safeParse({ key: 'notes.mathResults', value: mode }).success, mode).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'notes.mathResults', value: 'always' }).success).toBe(false);
    // Only main writes the zoom, through window:zoom.
    expect(SettingsSetRequest.safeParse({ key: 'window.zoom', value: { main: 125, sticky: 100, widget: 100 } }).success).toBe(false);
    expect(SETTINGS['window.zoom'].schema.safeParse({ main: 125, sticky: 100, widget: 100 }).success).toBe(true);
    expect(SETTINGS['window.zoom'].schema.safeParse({ main: 120, sticky: 100, widget: 100 }).success).toBe(false);
  });

  it('note:create requires a boolean sticky flag and a valid location', () => {
    const req = CHANNEL_SCHEMAS['note:create'].request;
    expect(req.safeParse({ location: { projectId: null, folderId: null }, sticky: false }).success).toBe(true);
    expect(req.safeParse({ location: { projectId: null, folderId: null } }).success).toBe(false);
    expect(req.safeParse({ location: { projectId: 'x', folderId: null }, sticky: true }).success).toBe(false);
  });
});
