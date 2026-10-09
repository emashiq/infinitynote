import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { appArgs, appEnv, appExecutable, readMainLog, spawnAndWait } from './fixtures';
import { useApp } from './harness';
import { COMMON, createFolder, createNote, createProject, reloadUi, saveText } from './seed';
import { activate, chooseMenu, confirmDialog, dialogByName, openByPalette, openFromTree, railGo, tabs, titleInput, treeByKey } from './ui';
import { editor, editorText, paletteAction } from './editor-ui';
import {
  closeWindowByUrl,
  floatFromTab,
  listenerCounts,
  mainPageOf,
  pressClosing,
  queueClose,
  stickyHeader,
  stickyMenu,
  stickyNoteIds,
  stickyPage,
  windowCount,
  windowsOf,
} from './sticky-ui';

const h = useApp({ failOnMainErrors: true });

const WIN = process.platform === 'win32';
/** Hosts that report programmatic window geometry as set (probe): Windows and Xvfb. WSLg shifts windows by its frame. */
const EXACT_GEOMETRY = WIN || !process.env.WAYLAND_DISPLAY;
const MISSING = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

interface NoteDb {
  title: string;
  sticky_enabled: number;
  color: string | null;
  revision: number;
  plain_text: string;
  deleted_at: number | null;
}
interface WindowStateDb {
  bounds: string | null;
  display_id: number | null;
  open: number;
  collapsed: number;
  always_on_top: number;
}
const noteRow = (id: string) => h.one<NoteDb>('SELECT title, sticky_enabled, color, revision, plain_text, deleted_at FROM notes WHERE id = ?', id)!;
const winRow = (id: string) => h.one<WindowStateDb>('SELECT bounds, display_id, open, collapsed, always_on_top FROM window_state WHERE note_id = ?', id);
const storedBounds = (id: string) => {
  const raw = winRow(id)?.bounds;
  return raw ? (JSON.parse(raw) as { x: number | null; y: number | null; width: number; height: number }) : null;
};
const draftCount = () => h.all('SELECT id FROM note_drafts').length;

function bridgeCall<T>(page: Page, fn: (noteId: string) => Promise<T>, noteId: string): Promise<T> {
  return page.evaluate(fn, noteId);
}
const floatViaBridge = (page: Page, noteId: string) => bridgeCall(page, (id) => window.infinity.sticky.float({ noteId: id }), noteId);

/** Types at the end of a page's note editor once it is editable. */
async function typeEnd(page: Page, text: string): Promise<void> {
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(text);
}

/** The sticky window entry main reports for a note. */
async function stickyInfo(app: ElectronApplication, noteId: string) {
  return (await windowsOf(app)).stickies.find((s) => s.noteId === noteId);
}

function setStickyBounds(app: ElectronApplication, noteId: string, b: { x: number; y: number; width: number; height: number }): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, [id, bounds]) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith(`#/sticky/${id as string}`))!
        .setBounds(bounds as Electron.Rectangle);
    },
    [noteId, b] as const,
  );
}

function mainBounds(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.getBounds());
}

const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function capsOf(page: Page) {
  const r = await page.evaluate(() => window.infinity.capabilities.get());
  if (!r.ok) throw new Error('capabilities');
  return r.data;
}

test('float opens one native window for the same note id (INF-STKY-01)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Groceries');
  await saveText(page, id, 'milk');
  const notesBefore = h.all('SELECT id FROM notes').length;
  const revisionBefore = noteRow(id).revision;
  await reloadUi(page);
  await openFromTree(page, id);
  await expect(editor(page)).toHaveText('milk');

  await floatFromTab(page);
  const sp = await stickyPage(app, id);
  expect(sp.url()).toBe(`infinity-app://renderer/index.html#/sticky/${id}`);
  await expect.poll(async () => (await windowsOf(app)).stickies.map((s) => ({ noteId: s.noteId, visible: s.visible }))).toEqual([{ noteId: id, visible: true }]);
  await expect(titleInput(sp)).toHaveValue('Groceries');
  await expect(editor(sp)).toHaveText('milk');
  expect(noteRow(id)).toMatchObject({ sticky_enabled: 1, color: 'yellow', revision: revisionBefore });
  expect(h.all('SELECT id FROM notes')).toHaveLength(notesBefore);
  expect(winRow(id)?.open).toBe(1);

  // Float again from the tab, the tree menu and the palette: still the same single window.
  await floatFromTab(page);
  await chooseMenu(page, treeByKey(page, `note:${id}`), 'Float as sticky');
  await paletteAction(page, 'Float current note');
  await expect.poll(async () => (await stickyInfo(app, id))?.activation).toBe(4);
  expect(await windowCount(app)).toBe(2);
  expect(await stickyNoteIds(app)).toEqual([id]);

  const unknown = await floatViaBridge(page, MISSING);
  expect(unknown).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: 'This note no longer exists' } });
  const invalid = await bridgeCall(page, (x) => window.infinity.sticky.float({ noteId: x }), 'abc');
  expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  const trashedId = await createNote(page, COMMON, 'Gone');
  await page.evaluate((x) => window.infinity.note.trash({ noteId: x }), trashedId);
  expect(await floatViaBridge(page, trashedId)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', details: { trashed: true } } });
  expect(await windowCount(app)).toBe(2);
});

test('two stickies are independent windows (INF-STKY-02)', async () => {
  const { app, page } = await h.start();
  const a = await createNote(page, COMMON, 'A');
  const b = await createNote(page, COMMON, 'B');
  await saveText(page, a, 'alpha body');
  await saveText(page, b, 'beta body');
  await floatViaBridge(page, a);
  await floatViaBridge(page, b);
  const spA = await stickyPage(app, a);
  const spB = await stickyPage(app, b);
  await expect(editor(spA)).toHaveText('alpha body');
  await expect(editor(spB)).toHaveText('beta body');

  const native = await app.evaluate(({ BrowserWindow }, ids) =>
    ids.map((id) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(`#/sticky/${id}`))!;
      return { pid: win.webContents.getOSProcessId(), handle: win.getNativeWindowHandle().toString('hex') };
    }),
    [a, b],
  );
  expect(native[0]!.pid).not.toBe(native[1]!.pid);
  expect(native[0]!.handle).not.toBe(native[1]!.handle);

  await typeEnd(spA, ' A1');
  await typeEnd(spB, ' B1');
  await expect.poll(() => noteRow(a).plain_text).toBe('alpha body A1');
  await expect.poll(() => noteRow(b).plain_text).toBe('beta body B1');

  // A move and resize outside the main window (programmatic, which emits the same events as a user drag).
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#/'))!
      .setBounds({ x: 0, y: 0, width: 760, height: 560 });
  });
  await page.waitForTimeout(1000);
  const bBefore = { row: winRow(b), bounds: (await stickyInfo(app, b))!.bounds };
  const target = { x: 800, y: 40, width: 340, height: 280 };
  await setStickyBounds(app, a, target);
  await expect.poll(() => storedBounds(a)?.width, { timeout: 5000 }).toBe((await stickyInfo(app, a))!.bounds!.width);
  const aBounds = (await stickyInfo(app, a))!.bounds!;
  const positioned = (await capsOf(page)).windowPositioning.status !== 'unsupported';
  if (EXACT_GEOMETRY) {
    expect(aBounds).toEqual(target);
    expect(intersects(aBounds, await mainBounds(app))).toBe(false);
    expect(storedBounds(a)).toEqual(positioned ? target : { x: null, y: null, width: 340, height: 280 });
  } else {
    console.log(`WSLg sticky bounds after setBounds(${JSON.stringify(target)}): ${JSON.stringify(aBounds)}`);
    expect(storedBounds(a)).toMatchObject({ x: null, y: null });
  }
  expect((await stickyInfo(app, b))!.bounds).toEqual(bBefore.bounds);
  expect(winRow(b)).toEqual(bBefore.row);
});

test('dock preserves content and edit control (INF-STKY-03)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Dockable');
  await saveText(page, id, 'start');
  await floatViaBridge(page, id);
  const sp = await stickyPage(app, id);
  await typeEnd(sp, ' docked');
  await stickyMenu(sp, 'Open in app');

  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  expect(await windowCount(app)).toBe(1);
  expect(winRow(id)?.open).toBe(0);
  expect(noteRow(id).sticky_enabled).toBe(1);
  await expect(tabs(page).filter({ hasText: 'Dockable' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => editorText(page)).toBe('start docked');
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  expect(noteRow(id).plain_text).toBe('start docked');
  expect(draftCount()).toBe(0);

  // With the main window closed to the background, dock brings it back with the note.
  await floatViaBridge(page, id);
  const again = await stickyPage(app, id);
  await queueClose(app, 'background', false);
  await closeWindowByUrl(app, '#/');
  await expect.poll(async () => (await windowsOf(app)).main).toBeNull();
  await typeEnd(again, ' again');
  await stickyMenu(again, 'Open in app');
  const main = await mainPageOf(app);
  await main.waitForSelector('#app-shell[data-ready="true"]');
  await expect(tabs(main).filter({ hasText: 'Dockable' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => editorText(main)).toBe('start docked again');
  await expect(editor(main)).toHaveAttribute('aria-readonly', 'false');
  expect(noteRow(id).plain_text).toBe('start docked again');
  expect(draftCount()).toBe(0);
});

test('header controls (INF-STKY-04)', async () => {
  const { app, page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const plans = await createFolder(page, { projectId: alpha, parentId: null }, 'Plans');
  const id = await createNote(page, COMMON, 'Header');
  await floatViaBridge(page, id);
  const sp = await stickyPage(app, id);
  const header = stickyHeader(sp);

  // Color.
  await activate(header.getByRole('button', { name: 'Sticky color' }));
  const colors = sp.getByRole('radiogroup', { name: 'Sticky color' }).getByRole('radio');
  await expect(colors).toHaveCount(6);
  expect(await colors.evaluateAll((radios) => radios.map((r) => r.getAttribute('aria-label')))).toEqual(['Yellow', 'Green', 'Blue', 'Pink', 'Violet', 'Gray']);
  const blue = sp.getByRole('radiogroup', { name: 'Sticky color' }).getByRole('radio', { name: 'Blue' });
  await blue.focus();
  await blue.press('Enter');
  await expect.poll(() => noteRow(id).color).toBe('blue');
  await expect(sp.locator('.sticky-window')).toHaveAttribute('data-sticky-color', 'blue');
  await sp.keyboard.press('Escape');
  await expect(sp.getByRole('dialog', { name: 'Sticky color' })).toBeHidden();
  await railGo(page, 'Stickies');
  await expect(page.locator('.sticky-row .dot-blue')).toBeVisible();

  // Source badge follows a move made in the main window, without reopening.
  const wcId = (await stickyInfo(app, id))!.webContentsId;
  await expect(header.locator('.sticky-badge')).toHaveText('Common');
  await page.evaluate(([n, p, f]) => window.infinity.note.move({ noteId: n!, target: { projectId: p!, folderId: f! } }), [id, alpha, plans]);
  await expect(header.locator('.sticky-badge')).toHaveText('Alpha › Plans');
  expect((await stickyInfo(app, id))!.webContentsId).toBe(wcId);

  // Pin where the desktop supports always-on-top (Windows; INF-STKY-13 covers the unsupported case).
  if ((await capsOf(page)).alwaysOnTop.status === 'supported') {
    const pin = header.getByRole('button', { name: 'Keep on top' });
    await activate(pin);
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await stickyInfo(app, id))?.alwaysOnTop).toBe(true);
    expect(winRow(id)?.always_on_top).toBe(1);
    await activate(pin);
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await stickyInfo(app, id))?.alwaysOnTop).toBe(false);
    expect(winRow(id)?.always_on_top).toBe(0);
  }

  // Collapse to the header only, then expand back.
  const expandedHeight = (await stickyInfo(app, id))!.contentSize![1]!;
  await activate(header.getByRole('button', { name: 'Collapse sticky' }));
  const expand = header.getByRole('button', { name: 'Expand sticky' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(editor(sp)).toBeHidden();
  await expect.poll(async () => (await stickyInfo(app, id))?.resizable).toBe(false);
  expect(winRow(id)?.collapsed).toBe(1);
  const collapsedInfo = (await stickyInfo(app, id))!;
  if (EXACT_GEOMETRY) expect(collapsedInfo.contentSize![1]).toBe(36);
  else console.log(`WSLg collapsed sticky: contentSize=${JSON.stringify(collapsedInfo.contentSize)} bounds=${JSON.stringify(collapsedInfo.bounds)}`);
  await activate(expand);
  await expect(header.getByRole('button', { name: 'Collapse sticky' })).toHaveAttribute('aria-expanded', 'true');
  await expect(editor(sp)).toBeVisible();
  await expect.poll(async () => (await stickyInfo(app, id))?.resizable).toBe(true);
  if (EXACT_GEOMETRY) await expect.poll(async () => (await stickyInfo(app, id))?.contentSize?.[1]).toBe(expandedHeight);
  expect(winRow(id)?.collapsed).toBe(0);

  // The actions menu, then Hide.
  await activate(header.getByRole('button', { name: 'Sticky actions' }));
  await expect(sp.getByRole('menu', { name: 'Sticky actions' }).getByRole('menuitem')).toHaveText([
    'Open in app',
    'Rename',
    'Change color',
    'Hide',
    'Remove from stickies',
    'Move to Trash',
    'Quit Infinity Notes',
  ]);
  await sp.keyboard.press('Escape');
  await stickyMenu(sp, 'Hide');
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  expect(winRow(id)?.open).toBe(0);
  expect(noteRow(id).sticky_enabled).toBe(1);
});

test('close hides; delete is separate (INF-STKY-05)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Keep me');
  await saveText(page, id, 'text');
  await floatViaBridge(page, id);
  const sp = await stickyPage(app, id);
  await typeEnd(sp, ' kept');
  await closeWindowByUrl(app, `#/sticky/${id}`);
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  expect(readMainLog(h.userData)).toContain('flush: requested=1 acked=1 timedOut=0');
  expect(noteRow(id)).toMatchObject({ deleted_at: null, sticky_enabled: 1, plain_text: 'text kept' });
  expect(winRow(id)?.open).toBe(0);

  await railGo(page, 'Stickies');
  await activate(page.getByRole('button', { name: 'Float Keep me' }));
  const sp2 = await stickyPage(app, id);
  await expect(editor(sp2)).toHaveText('text kept');

  await stickyMenu(sp2, 'Move to Trash');
  const dialog = dialogByName(sp2, 'Move to Trash?');
  await expect(dialog).toContainText('“Keep me” will be moved to Trash. You can restore it from Trash.');
  await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(noteRow(id).deleted_at).toBeNull();
  await stickyMenu(sp2, 'Move to Trash');
  await confirmDialog(sp2, 'Move to Trash?', 'Move to Trash');
  await expect.poll(() => noteRow(id).deleted_at).not.toBeNull();
  await expect(sp2.getByRole('heading', { name: 'This note is in Trash' })).toBeVisible();
});

test('Ctrl+W hides the sticky once the key is released, keeping the typed text (INF-STKY-05)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Keyboard hide');
  await floatViaBridge(page, id);
  const sp = await stickyPage(app, id);
  let sticky = sp;
  for (let i = 0; i < 3; i += 1) {
    await typeEnd(sticky, `${i === 0 ? '' : ' '}w${i}`);
    // The whole key press reaches the window before it closes (no closed-page error, QA-02 race).
    await sticky.keyboard.press('Control+w');
    await expect.poll(() => stickyNoteIds(app)).toEqual([]);
    expect(noteRow(id).plain_text).toBe(['w0', 'w1', 'w2'].slice(0, i + 1).join(' '));
    if (i < 2) {
      await floatViaBridge(page, id);
      sticky = await stickyPage(app, id);
    }
  }
});

test('bounds persist and are clamped to connected displays (INF-STKY-06)', async () => {
  test.setTimeout(180_000);
  const displays = {
    displays: [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
    ],
    primaryId: 1,
  };
  const env = { INFINITY_NOTES_TEST_CAPS: JSON.stringify({ windowPositioning: 'supported' }), INFINITY_NOTES_TEST_DISPLAYS: JSON.stringify(displays) };
  const { app, page } = await h.start(env);
  const id = await createNote(page, COMMON, 'Roaming');
  await floatViaBridge(page, id);
  await stickyPage(app, id);
  const inside = (b: { x?: number; y?: number; width: number; height: number }) =>
    b.x !== undefined && b.y !== undefined && b.x >= 0 && b.y >= 0 && b.x + b.width <= 1920 && b.y + b.height <= 1040;

  if (EXACT_GEOMETRY) {
    await setStickyBounds(app, id, { x: 2400, y: 100, width: 320, height: 300 });
    await expect.poll(() => winRow(id)?.display_id, { timeout: 5000 }).toBe(2);
    expect(storedBounds(id)!.x!).toBeGreaterThanOrEqual(1920);
    await app.evaluate((_e, d) => globalThis.__infinityTest!.displays!.set([d], 1), displays.displays[0]!);
    await expect.poll(() => app.evaluate(() => globalThis.__infinityTest!.stickyLog.filter((e) => e.op === 'clamp').length)).toBe(1);
    const clamp = (await app.evaluate(() => globalThis.__infinityTest!.stickyLog.find((e) => e.op === 'clamp')!)).bounds;
    expect(inside(clamp)).toBe(true);
    expect((await stickyInfo(app, id))!.bounds).toEqual({ x: clamp.x, y: clamp.y, width: clamp.width, height: clamp.height });
    await expect.poll(() => winRow(id)?.display_id).toBe(1);
    expect(storedBounds(id)).toMatchObject({ x: clamp.x, y: clamp.y });
  } else {
    console.log('WSLg: the window manager keeps windows on its own screen, so the display-move part runs on Windows and Xvfb (plan 12.4)');
  }

  // Collapsed (and pinned where supported) state comes back at the next start, with off-screen bounds clamped.
  const pinSupported = (await capsOf(page)).alwaysOnTop.status === 'supported';
  const sp = await stickyPage(app, id);
  await activate(stickyHeader(sp).getByRole('button', { name: 'Collapse sticky' }));
  if (pinSupported) await activate(stickyHeader(sp).getByRole('button', { name: 'Keep on top' }));
  await expect.poll(() => winRow(id)?.collapsed).toBe(1);
  await page.evaluate(() => window.infinity.settings.set({ key: 'stickies.restoreOnStartup', value: true }));
  await h.stop();
  expect(winRow(id)?.open).toBe(1);
  h.writeWhileClosed((db) =>
    db.prepare("UPDATE window_state SET bounds = json('{\"x\":9000,\"y\":9000,\"width\":330,\"height\":310}'), display_id = 2 WHERE note_id = ?").run(id),
  );
  // The second display was removed while the app was closed.
  const second = await h.start({ ...env, INFINITY_NOTES_TEST_DISPLAYS: JSON.stringify({ displays: [displays.displays[0]], primaryId: 1 }) });
  await stickyPage(second.app, id);
  const created = await second.app.evaluate((_e, n) => globalThis.__infinityTest!.stickyLog.find((e) => e.noteId === n && e.op === 'create')!.bounds, id);
  expect(inside(created)).toBe(true);
  expect(created).toMatchObject({ width: 330, height: 310, displayId: 1 });
  await expect.poll(async () => (await stickyInfo(second.app, id))?.collapsed).toBe(true);
  expect((await stickyInfo(second.app, id))!.resizable).toBe(false);
  if (EXACT_GEOMETRY) expect((await stickyInfo(second.app, id))!.contentSize![1]).toBe(36);
  if (pinSupported) expect((await stickyInfo(second.app, id))!.alwaysOnTop).toBe(true);
});

test('size only where positioning is unsupported (INF-STKY-06)', async () => {
  const { app, page } = await h.startUnsupported('windowPositioning');
  expect((await capsOf(page)).windowPositioning.status).toBe('unsupported');
  const id = await createNote(page, COMMON, 'Compositor placed');
  await floatViaBridge(page, id);
  await stickyPage(app, id);
  await app.evaluate(({ BrowserWindow }, n) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith(`#/sticky/${n}`))!
      .setSize(333, 444);
  }, id);
  await expect.poll(() => storedBounds(id)?.width, { timeout: 5000 }).toBe((await stickyInfo(app, id))!.bounds!.width);
  const reported = (await stickyInfo(app, id))!.bounds!;
  expect(storedBounds(id)).toEqual({ x: null, y: null, width: reported.width, height: reported.height });
  if (EXACT_GEOMETRY) expect(reported).toMatchObject({ width: 333, height: 444 });

  const sp = await stickyPage(app, id);
  await stickyMenu(sp, 'Hide');
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  await floatViaBridge(page, id);
  await stickyPage(app, id);
  const creates = await app.evaluate((_e, n) => globalThis.__infinityTest!.stickyLog.filter((e) => e.noteId === n && e.op === 'create').map((e) => e.bounds), id);
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual({ width: reported.width, height: reported.height });
});

test('tab and sticky edit the same note together without losing text (INF-STKY-07, D-103)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Relay');
  await reloadUi(page);
  await openFromTree(page, id);
  const revisions: number[] = [];
  const settled = async (text: string) => {
    await expect.poll(() => noteRow(id).plain_text).toBe(text);
    revisions.push(noteRow(id).revision);
  };

  await typeEnd(page, 'one');
  await floatFromTab(page);
  const sp = await stickyPage(app, id);
  await expect(editor(sp)).toHaveText('one');
  // Both views edit at once (D-103): no read-only mirror, no edit control to take.
  await expect(editor(sp)).toHaveAttribute('aria-readonly', 'false');
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await settled('one');

  await typeEnd(sp, ' two');
  await expect.poll(() => editorText(page)).toBe('one two');
  await settled('one two');

  await typeEnd(page, ' three');
  await expect.poll(() => editorText(sp)).toBe('one two three');
  await settled('one two three');

  await stickyMenu(sp, 'Hide');
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');

  await floatFromTab(page);
  const sp2 = await stickyPage(app, id);
  await typeEnd(sp2, ' four');
  await stickyMenu(sp2, 'Open in app');
  await expect.poll(() => editorText(page)).toBe('one two three four');
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await settled('one two three four');

  for (let i = 1; i < revisions.length; i += 1) expect(revisions[i]!).toBeGreaterThan(revisions[i - 1]!);
  expect(draftCount()).toBe(0);
  console.log(`INF-STKY-07 revisions per step: ${revisions.join(' < ')}; note_drafts=${draftCount()}`);
});

test('trashing a floating note shows a recoverable trash state (INF-STKY-08)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Doomed');
  await saveText(page, id, 'stored');
  await reloadUi(page);
  await floatViaBridge(page, id);
  const sp = await stickyPage(app, id);
  await expect(editor(sp)).toHaveAttribute('aria-readonly', 'false');

  // Open the tree's confirmation first, so the typing below is still unsaved when the note goes to Trash.
  const row = treeByKey(page, `note:${id}`);
  await row.focus();
  await row.press('Delete');
  const confirm = dialogByName(page, 'Move to Trash?');
  await confirm.waitFor({ state: 'visible' });
  await typeEnd(sp, ' pending');
  await confirm.getByRole('button', { name: 'Move to Trash', exact: true }).press('Enter');

  await expect(sp.getByRole('heading', { name: 'This note is in Trash' })).toBeVisible();
  await expect(sp.getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect(sp.getByRole('button', { name: 'Close window' })).toBeVisible();
  await expect(editor(sp)).toHaveCount(0);
  await expect.poll(() => h.all<{ reason: string; content: string }>('SELECT reason, content FROM note_drafts WHERE note_id = ?', id)).toEqual([
    { reason: 'conflict', content: expect.stringContaining(' pending') },
  ]);
  await expect(sp.locator('.toast').filter({ hasText: 'Your unsaved edits to "Doomed" were kept as a recovered draft.' })).toBeVisible();

  await activate(sp.getByRole('button', { name: 'Restore' }));
  await expect.poll(() => noteRow(id).deleted_at).toBeNull();
  await expect(editor(sp)).toHaveText('stored');
  await expect(sp.locator('.toast').filter({ hasText: 'Restored to Common' })).toBeVisible();

  await page.evaluate((n) => window.infinity.note.trash({ noteId: n }), id);
  await expect(sp.getByRole('heading', { name: 'This note is in Trash' })).toBeVisible();
  await pressClosing(sp.getByRole('button', { name: 'Close window' }));
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  expect(winRow(id)?.open).toBe(0);

  await chooseMenu(page, treeByKey(page, 'trash'), 'Empty trash');
  await confirmDialog(page, 'Empty trash?', 'Empty trash');
  await expect.poll(() => h.all('SELECT key FROM window_state')).toEqual([]);
});

test('purging a note while its sticky shows the trash state closes the window (INF-STKY-08)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Purged');
  await floatViaBridge(page, id);
  const sp = await stickyPage(app, id);
  await page.evaluate((n) => window.infinity.note.trash({ noteId: n }), id);
  await expect(sp.getByRole('heading', { name: 'This note is in Trash' })).toBeVisible();
  await page.evaluate(() => window.infinity.trash.purge({ target: { kind: 'all' }, confirmed: true }));
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  expect(await windowCount(app)).toBe(1);
  expect(h.all('SELECT key FROM window_state')).toEqual([]);
});

test('restore open stickies on startup (INF-STKY-09)', async () => {
  test.setTimeout(180_000);
  const { app, page } = await h.start();
  const a = await createNote(page, COMMON, 'Restore A');
  const b = await createNote(page, COMMON, 'Restore B');
  await saveText(page, a, 'alpha');
  await saveText(page, b, 'beta');
  await floatViaBridge(page, a);
  await stickyPage(app, a);
  // A fresh profile writes no setting and restores nothing.
  expect(h.setting('stickies.restoreOnStartup')).toBeUndefined();
  let next = await h.restart();
  await next.page.waitForTimeout(1500);
  expect(await stickyNoteIds(next.app)).toEqual([]);
  expect(winRow(a)?.open).toBe(0);

  await railGo(next.page, 'Settings');
  await activate(next.page.getByRole('switch', { name: 'Restore open stickies on startup' }));
  await expect.poll(() => h.setting('stickies.restoreOnStartup')).toEqual({ v: 1, value: true });
  await floatViaBridge(next.page, a);
  await floatViaBridge(next.page, b);
  const spB = await stickyPage(next.app, b);
  await activate(stickyHeader(spB).getByRole('button', { name: 'Collapse sticky' }));
  await expect.poll(() => winRow(b)?.collapsed).toBe(1);
  await h.stop();
  expect([winRow(a)?.open, winRow(b)?.open]).toEqual([1, 1]);

  next = await h.start();
  const restoredA = await stickyPage(next.app, a);
  const restoredB = await stickyPage(next.app, b);
  expect(await stickyNoteIds(next.app)).toEqual([a, b].sort());
  await expect(editor(restoredA)).toHaveText(noteRow(a).plain_text);
  await expect(editor(restoredB)).toBeHidden();
  await expect.poll(async () => (await stickyInfo(next.app, b))?.collapsed).toBe(true);
  expect((await stickyInfo(next.app, a))!.activation).toBe(0);
  if (WIN) {
    const focused = await next.app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL() ?? '');
    expect(focused.endsWith('#/')).toBe(true);
  } else {
    expect(next.page.url().endsWith('#/')).toBe(true);
  }

  await railGo(next.page, 'Settings');
  await activate(next.page.getByRole('switch', { name: 'Restore open stickies on startup' }));
  await expect.poll(() => h.setting('stickies.restoreOnStartup')).toEqual({ v: 1, value: false });
  next = await h.restart();
  await next.page.waitForTimeout(1500);
  expect(await stickyNoteIds(next.app)).toEqual([]);
  expect(h.all<{ open: number }>('SELECT open FROM window_state').map((r) => r.open)).toEqual([0, 0]);
});

test('stickies page (INF-STKY-10)', async () => {
  const { app, page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const plans = await createFolder(page, { projectId: alpha, parentId: null }, 'Plans');
  const common = await createNote(page, COMMON, 'Common sticky', { sticky: true });
  const inPlans = await createNote(page, { projectId: alpha, folderId: plans }, 'Plans sticky', { sticky: true });
  await reloadUi(page);
  await railGo(page, 'Stickies');
  const rows = page.locator('.sticky-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Common sticky' }).locator('.sticky-path')).toHaveText('Common');
  await expect(rows.filter({ hasText: 'Plans sticky' }).locator('.sticky-path')).toHaveText('Alpha › Plans');
  await expect(rows.locator('.dot-yellow')).toHaveCount(2);

  await activate(page.getByRole('button', { name: 'Float Plans sticky' }));
  await stickyPage(app, inPlans);
  expect(await stickyNoteIds(app)).toEqual([inPlans]);
  await activate(page.getByRole('button', { name: 'Open Common sticky' }));
  await expect(tabs(page).filter({ hasText: 'Common sticky' })).toHaveAttribute('aria-selected', 'true');

  await railGo(page, 'Stickies');
  const tabCount = await tabs(page).count();
  await activate(page.getByRole('button', { name: 'New sticky', exact: true }));
  await expect.poll(() => h.all('SELECT id FROM notes WHERE sticky_enabled = 1').length).toBe(3);
  const created = h.one<{ id: string; project_id: string | null; folder_id: string | null }>(
    'SELECT id, project_id, folder_id FROM notes WHERE id NOT IN (?, ?)',
    common,
    inPlans,
  )!;
  expect(created).toMatchObject({ project_id: null, folder_id: null });
  await stickyPage(app, created.id);
  expect(await stickyNoteIds(app)).toEqual([inPlans, created.id].sort());
  expect(await tabs(page).count()).toBe(tabCount);
});

test('reopen cycles leave one window and no extra listeners (INF-STKY-11)', async () => {
  test.setTimeout(240_000);
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Cycled');
  const baseline = await listenerCounts(app);
  expect(baseline).toMatchObject({ windows: 1, registry: 1, 'displays:changed': 1 });

  for (let i = 0; i < 5; i += 1) {
    await floatViaBridge(page, id);
    const sp = await stickyPage(app, id);
    expect(await stickyNoteIds(app)).toEqual([id]);
    await stickyMenu(sp, 'Hide');
    await expect.poll(() => stickyNoteIds(app)).toEqual([]);
    await expect.poll(() => listenerCounts(app)).toEqual(baseline);
  }
  for (let i = 0; i < 3; i += 1) {
    await floatViaBridge(page, id);
    await stickyPage(app, id);
    expect(await stickyNoteIds(app)).toEqual([id]);
    expect(await windowCount(app)).toBe(2);
  }
  await stickyMenu(await stickyPage(app, id), 'Hide');
  await expect.poll(() => listenerCounts(app)).toEqual(baseline);

  for (let i = 0; i < 3; i += 1) {
    await queueClose(app, 'background', false);
    await closeWindowByUrl(app, '#/');
    await expect.poll(async () => (await windowsOf(app)).main).toBeNull();
    const second = await spawnAndWait(appExecutable(), appArgs(), appEnv(h.userData), 15_000);
    expect(second.code).toBe(0);
    const main = await mainPageOf(app);
    await main.waitForSelector('#app-shell[data-ready="true"]');
    expect((await windowsOf(app)).main).not.toBeNull();
    await expect.poll(() => listenerCounts(app)).toEqual(baseline);
  }
});

test('unsupported pin is shown as unavailable (INF-STKY-13)', async () => {
  const { app, page } = await h.startUnsupported('alwaysOnTop');
  const caps = await capsOf(page);
  expect(caps.alwaysOnTop.status).toBe('unsupported');
  const id = await createNote(page, COMMON, 'No pin');
  await floatViaBridge(page, id);
  const sp = await stickyPage(app, id);
  const pin = stickyHeader(sp).getByRole('button', { name: 'Keep on top' });
  await expect(pin).toHaveAttribute('aria-disabled', 'true');
  await expect(pin).toHaveAttribute('title', 'Not supported by this desktop');
  await activate(pin);
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  const res = await sp.evaluate((n) => window.infinity.sticky.setPinned({ noteId: n, pinned: true }), id);
  expect(res).toEqual({ ok: false, error: { code: 'UNSUPPORTED', message: 'Not supported by this desktop' } });
  expect(winRow(id)?.always_on_top).toBe(0);
  expect((await stickyInfo(app, id))!.alwaysOnTop).toBe(false);
  const line = readMainLog(h.userData).match(/capabilities positioning=\S+ alwaysOnTop=\S+ tray=\S+ session=\S+ ozone=\S+/)?.[0];
  expect(line).toBeTruthy();
  console.log(`main.log: ${line}`);
});

test('windows hook stays safe while windows close (F04-A2)', async () => {
  test.setTimeout(300_000);
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Busy');
  await saveText(page, id, 'safe');
  // A background poller calls the database-reading hook as fast as Playwright allows during every close (QA2-X1 shape).
  const errors: string[] = [];
  let polls = 0;
  let polling = true;
  const poller = (async () => {
    while (polling) {
      polls += 1;
      await windowsOf(app).catch((err: unknown) => errors.push(String(err)));
    }
  })();
  for (let round = 0; round < 15; round += 1) {
    await floatViaBridge(page, id);
    const sp = await stickyPage(app, id);
    // Saves fail: the OS close keeps the window open with its text.
    await app.evaluate(() => {
      globalThis.__infinityTest!.failSaves = 100;
    });
    await typeEnd(sp, ` f${round}`);
    await closeWindowByUrl(app, `#/sticky/${id}`);
    await expect(sp.getByText('Could not save this note. The window stays open.').first()).toBeVisible({ timeout: 20_000 });
    expect(await stickyNoteIds(app)).toEqual([id]);
    // Saving recovers: the next close stores the text and closes the window.
    await app.evaluate(() => {
      globalThis.__infinityTest!.failSaves = 0;
    });
    await typeEnd(sp, ` r${round}`);
    await closeWindowByUrl(app, `#/sticky/${id}`);
    await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  }
  polling = false;
  await poller;
  console.log(`windows hook polls=${polls} errors=${errors.length}`);
  expect(errors).toEqual([]);
  expect(polls).toBeGreaterThan(100);
  expect(noteRow(id).plain_text.endsWith(' r14')).toBe(true);
  expect(draftCount()).toBe(0);
});

test('quick sticky scope: Ctrl+Shift+N files the sticky where the user works, with no project question (INF-REF-09)', async () => {
  const { app, page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const plans = await createFolder(page, { projectId: alpha, parentId: null }, 'Plans');
  const inPlans = await createNote(page, { projectId: alpha, folderId: plans }, 'Roadmap');
  await reloadUi(page);
  const created = (known: string[]) =>
    h.one<{ id: string; project_id: string | null; folder_id: string | null; sticky_enabled: number }>(
      `SELECT id, project_id, folder_id, sticky_enabled FROM notes WHERE id NOT IN (${known.map(() => '?').join(', ')})`,
      ...known,
    );

  // From an open note in Alpha › Plans: the sticky inherits that folder.
  await openByPalette(page, 'Roadmap');
  await expect(tabs(page).filter({ hasText: 'Roadmap' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Shift+N');
  await expect.poll(() => created([inPlans])?.id ?? null).not.toBeNull();
  const first = created([inPlans])!;
  expect(first).toMatchObject({ project_id: alpha, folder_id: plans, sticky_enabled: 1 });
  await stickyPage(app, first.id);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // From Home with the All scope: the Common root, still without asking.
  await page.bringToFront();
  await railGo(page, 'Home');
  await page.keyboard.press('Control+Shift+N');
  await expect.poll(() => created([inPlans, first.id])?.id ?? null).not.toBeNull();
  expect(created([inPlans, first.id])).toMatchObject({ project_id: null, folder_id: null, sticky_enabled: 1 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
