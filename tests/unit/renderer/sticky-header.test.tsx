// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StickyHeader, type StickyHeaderActions } from '../../../src/renderer/stickies/StickyHeader';
import type { StickyStateType } from '../../../src/shared/contracts/stickies';
import { createFakeBridge } from './support/fake-bridge';
import { setupDom } from './support/dom';

const NOTE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const state: StickyStateType = { noteId: NOTE, title: 'Groceries', color: 'blue', textColor: null, path: ['Alpha', 'Plans'], trashed: null, collapsed: false, alwaysOnTop: false, activation: 1 };

const dom = setupDom();
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

async function renderHeader(over: Partial<{ state: StickyStateType; pinSupported: boolean; trashed: boolean }> = {}) {
  const actions: { [K in keyof StickyHeaderActions]: ReturnType<typeof vi.fn> } = {
    setColor: vi.fn(),
    setTextColor: vi.fn(),
    togglePinned: vi.fn(),
    toggleCollapsed: vi.fn(),
    openInApp: vi.fn(),
    rename: vi.fn(),
    hide: vi.fn(),
    remove: vi.fn(),
    trash: vi.fn(),
    quit: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <StickyHeader
        state={over.state ?? state}
        pinSupported={over.pinSupported ?? true}
        trashed={over.trashed ?? false}
        canRename={!(over.trashed ?? false)}
        titleField={<input aria-label="Title" className="sticky-title-input" defaultValue="Groceries" />}
        actions={actions as unknown as StickyHeaderActions}
      />,
    ),
  );
  const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  return { host, actions, button };
}

const menuItems = (role = 'menuitem') => [...document.querySelectorAll(`[role="menu"] [role="${role}"]`)].map((b) => b.textContent);
const group = (label: string) => document.querySelector(`[role="radiogroup"][aria-label="${label}"]`)!;
const radios = (label: string) => [...group(label).querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('aria-label'));
const checked = (label: string) => [...group(label).querySelectorAll('[role="radio"][aria-checked="true"]')].map((r) => r.getAttribute('aria-label'));
const radio = (label: string, name: string) => group(label).querySelector(`[role="radio"][aria-label="${name}"]`);

describe('sticky header (INF-STKY-04, D-070)', () => {
  it('is a toolbar with the color, title field, source badge, pin, collapse, actions and close controls', async () => {
    const { host, button } = await renderHeader();
    const toolbar = host.querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute('aria-label')).toBe('Sticky');
    expect([...toolbar.querySelectorAll('button, input')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Sticky color',
      'Title',
      'Keep on top',
      'Collapse sticky',
      'Sticky actions',
      'Close sticky',
    ]);
    const badge = host.querySelector('.sticky-badge')!;
    expect(badge.textContent).toBe('Alpha › Plans');
    expect(badge.getAttribute('title')).toBe('Alpha › Plans');
    expect(button('Keep on top')!.getAttribute('aria-pressed')).toBe('false');
    expect(button('Keep on top')!.hasAttribute('aria-disabled')).toBe(false);
    expect(button('Collapse sticky')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('Rename in the actions menu asks to edit the title (D-102)', async () => {
    const { button, actions } = await renderHeader();
    await dom.click(button('Sticky actions'));
    await dom.click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Rename')!);
    expect(actions.rename).toHaveBeenCalledTimes(1);
  });

  it('Close hides the sticky, as closing its frameless window does (D-097)', async () => {
    const { button, actions } = await renderHeader();
    await dom.click(button('Close sticky'));
    expect(actions.hide).toHaveBeenCalledTimes(1);
  });

  it('pin toggles where supported and is an inert, explained control where not (INF-STKY-13)', async () => {
    const supported = await renderHeader({ state: { ...state, alwaysOnTop: true } });
    expect(supported.button('Keep on top')!.getAttribute('aria-pressed')).toBe('true');
    await dom.click(supported.button('Keep on top'));
    expect(supported.actions.togglePinned).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());

    const unsupported = await renderHeader({ pinSupported: false });
    const pin = unsupported.button('Keep on top')!;
    expect(pin.getAttribute('aria-disabled')).toBe('true');
    expect(pin.getAttribute('title')).toBe('Not supported by this desktop');
    await dom.click(pin);
    expect(unsupported.actions.togglePinned).not.toHaveBeenCalled();
  });

  it('collapse reads Expand sticky with aria-expanded false while collapsed', async () => {
    const { button, actions } = await renderHeader({ state: { ...state, collapsed: true } });
    expect(button('Collapse sticky')).toBeNull();
    expect(button('Expand sticky')!.getAttribute('aria-expanded')).toBe('false');
    await dom.click(button('Expand sticky'));
    expect(actions.toggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('the actions menu has exactly the planned items, Quit set apart; trashed notes cannot be removed or trashed', async () => {
    const { button, actions } = await renderHeader();
    await dom.click(button('Sticky actions'));
    expect(document.querySelector('[role="menu"]')!.getAttribute('aria-label')).toBe('Sticky actions');
    expect(menuItems()).toEqual(['Open in app', 'Rename', 'Change color', 'Hide', 'Remove from stickies', 'Move to Trash', 'Quit Infinity Notes']);
    const separator = document.querySelector('[role="menu"] [role="separator"]')!;
    expect(separator.nextElementSibling?.textContent).toBe('Quit Infinity Notes');
    await dom.click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Hide')!);
    expect(actions.hide).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => root?.unmount());

    const trashed = await renderHeader({ trashed: true });
    await dom.click(trashed.button('Sticky actions'));
    const disabled = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter((b) => b.disabled).map((b) => b.textContent);
    expect(disabled).toEqual(['Rename', 'Remove from stickies', 'Move to Trash']);
  });

  it('the color popover has the six presets and the text colors as radio groups with the current ones checked', async () => {
    const { button, actions } = await renderHeader();
    await dom.click(button('Sticky color'));
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Sticky color');
    expect(radios('Sticky color')).toEqual(['Yellow', 'Green', 'Blue', 'Pink', 'Violet', 'Gray']);
    expect(checked('Sticky color')).toEqual(['Blue']);
    expect(radios('Text color').slice(0, 3)).toEqual(['Automatic', 'Black', 'White']);
    expect(checked('Text color')).toEqual(['Automatic']);
    await dom.click(radio('Sticky color', 'Pink'));
    expect(actions.setColor).toHaveBeenCalledWith('pink');
    await dom.click(radio('Text color', 'Red'));
    expect(actions.setTextColor).toHaveBeenCalledWith('#e03131');
    await dom.click(radio('Text color', 'Automatic'));
    expect(actions.setTextColor).toHaveBeenLastCalledWith(null);
  });

  it('a custom sticky color is any #rrggbb typed in the hex field; anything else is refused with a message', async () => {
    const { button, actions } = await renderHeader();
    await dom.click(button('Sticky color'));
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Sticky color: custom color"]')!;
    const apply = field.parentElement!.querySelector('button')!;
    await dom.type(field, 'red');
    await dom.click(apply);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a color as #rrggbb, for example #3366ff.');
    expect(actions.setColor).not.toHaveBeenCalled();
    await dom.type(field, '#3A7BD5');
    await dom.click(apply);
    expect(actions.setColor).toHaveBeenCalledWith('#3a7bd5');
  });

  it('a custom color shows in the hex field and checks no preset', async () => {
    const { button } = await renderHeader({ state: { ...state, color: '#3a7bd5', textColor: '#123456' } });
    await dom.click(button('Sticky color'));
    expect(checked('Sticky color')).toEqual([]);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Sticky color: custom color"]')!.value).toBe('#3a7bd5');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Text color: custom color"]')!.value).toBe('#123456');
  });

  it('Change color in the actions menu opens the color popover', async () => {
    const { button } = await renderHeader();
    await dom.click(button('Sticky actions'));
    await dom.click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Change color')!);
    expect(radios('Sticky color')).toHaveLength(6);
  });
});

describe('window routes in the renderer (plan section 9.1)', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('#/sticky/<id> renders the sticky window for a note main confirms', async () => {
    const fake = createFakeBridge();
    const r = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: true, title: 'Groceries' });
    if (!r.ok) throw new Error('note');
    fake.data.floating.set(r.data.note.id, { collapsed: false, alwaysOnTop: false, activation: 1 });
    fake.data.setWindowState({ role: 'sticky', sticky: fake.stickyState(r.data.note.id) });
    window.location.hash = `#/sticky/${r.data.note.id}`;
    const { el } = await dom.mount(fake);
    expect(el.querySelector('.sticky-window')?.getAttribute('data-sticky-color')).toBe('yellow');
    expect(el.querySelector('[role="toolbar"][aria-label="Sticky"]')).not.toBeNull();
    expect(el.querySelector('#app-shell')).toBeNull();
    expect(fake.callsTo('tree:list')).toHaveLength(0);
  });

  it('a sticky route main does not confirm shows the invalid-window message and opens nothing', async () => {
    const fake = createFakeBridge();
    window.location.hash = `#/sticky/${NOTE}`;
    const { el } = await dom.mount(fake);
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('This window could not be opened.');
    expect(fake.callsTo('note:open')).toHaveLength(0);
  });

  it('a sticky whose URL was changed to the main route shows the invalid-window message, not the main shell (QA-2)', async () => {
    const fake = createFakeBridge();
    const r = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: true, title: 'Sticky' });
    if (!r.ok) throw new Error('note');
    fake.data.setWindowState({ role: 'sticky', sticky: fake.stickyState(r.data.note.id) });
    window.location.hash = '#/';
    const { el } = await dom.mount(fake);
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('This window could not be opened.');
    expect(el.querySelector('#app-shell')).toBeNull();
    expect(fake.callsTo('tree:list')).toHaveLength(0);
  });

  it('the main window opens the notes main queued while it loaded, asking main once', async () => {
    const fake = createFakeBridge();
    const r = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'Docked note' });
    if (!r.ok) throw new Error('note');
    fake.data.setWindowState({ role: 'main', openNotes: [{ noteId: r.data.note.id, blockId: null }], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } });
    window.location.hash = '#/';
    const { el } = await dom.mount(fake);
    expect(el.querySelector('#app-shell')).not.toBeNull();
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Docked note');
    expect(fake.callsTo('window:getState')).toHaveLength(1);
  });

  it('an unknown route shows the invalid-window message without asking main', async () => {
    const fake = createFakeBridge();
    window.location.hash = '#/elsewhere';
    const { el } = await dom.mount(fake);
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('This window could not be opened.');
    expect(fake.calls).toEqual([]);
  });
});
