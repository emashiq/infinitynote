// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/App';
import { liveEditor } from '../../../src/renderer/editor/editor-registry';
import { NOTE_TOO_LARGE_MESSAGE } from '../../../src/shared/contracts/notes';
import { createFakeBridge, type FakeBridge } from './support/fake-bridge';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true, writable: true });
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
});

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(fake: FakeBridge = createFakeBridge()): Promise<{ el: HTMLElement; fake: FakeBridge }> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<App bridge={fake.bridge} />));
  await settle();
  return { el: host, fake };
}

const byLabel = (el: ParentNode, label: string) => el.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const click = async (target: Element | null) => {
  expect(target).not.toBeNull();
  await act(async () => {
    (target as HTMLElement).click();
  });
  await settle();
};
const typeInto = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const key = async (target: Element, k: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
  await settle(2);
};

describe('Phase 02 shell (smoke)', () => {
  it('renders the landmarks, the product heading and the Home tab', async () => {
    const { el } = await mount();
    expect(el.querySelector('#app-shell')?.getAttribute('data-ready')).toBe('true');
    expect(el.querySelector('header[role="banner"] h1')?.textContent).toBe('Infinity Notes');
    expect(byLabel(el, 'Primary')?.tagName).toBe('NAV');
    expect(el.querySelector('nav[aria-label="Notes"]')).not.toBeNull();
    expect(el.querySelector('main')).not.toBeNull();
    // The Details panel starts closed (D-102).
    expect(byLabel(el, 'Details')).toBeNull();
    expect(el.querySelectorAll('h1')).toHaveLength(1);
    const home = el.querySelector('[role="tab"]#tab-home');
    expect(home?.getAttribute('aria-selected')).toBe('true');
    expect(home?.parentElement?.querySelector('.tab-close')).toBeNull();
    expect(el.querySelector('[role="tabpanel"] h2')?.textContent).toBe('Home');
    expect(el.textContent).toContain('Pin a note to keep it here.');
    expect(el.textContent).toContain('No notes yet. Create one with New note.');
    // No positive tabindex anywhere.
    expect([...el.querySelectorAll('[tabindex]')].every((n) => Number(n.getAttribute('tabindex')) <= 0)).toBe(true);
  });

  it('creates a note from Quick actions, opens a tab and focuses the title', async () => {
    const { el, fake } = await mount();
    const tile = [...el.querySelectorAll('button.tile')].find((b) => b.textContent === 'New note');
    await click(tile ?? null);
    const tabs = [...el.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.textContent).toBe('Untitled');
    const title = byLabel(el, 'Title') as HTMLInputElement;
    expect(title).not.toBeNull();
    expect(document.activeElement).toBe(title);
    expect(fake.calls.some((c) => c.channel === 'note:create')).toBe(true);
    const editor = byLabel(el, 'Note text');
    expect(editor?.getAttribute('role')).toBe('textbox');
    expect(editor?.getAttribute('contenteditable')).toBe('true');
    expect(editor?.classList.contains('ProseMirror')).toBe(true);
    expect(document.documentElement.dataset.liveEditors).toBe('1');
    expect(el.querySelector('[role="status"].save-status')?.textContent).toBe('Saved');
    expect(el.querySelector('.tree [role="treeitem"][aria-level="2"]')?.textContent).toContain('Untitled');
    expect(byLabel(el, 'Close Untitled')).not.toBeNull();
  });

  it('an edit in the live editor saves the document JSON through the controller', async () => {
    const { el, fake } = await mount();
    await click([...el.querySelectorAll('button.tile')].find((b) => b.textContent === 'New note') ?? null);
    const editor = liveEditor();
    expect(editor).not.toBeNull();
    await act(async () => {
      editor!.commands.insertContentAt(1, 'hello world');
    });
    // The steps went to main at once; main saves a moment later (D-103).
    expect(el.querySelector('[role="status"].save-status')?.textContent).toMatch(/^(Editing|Saving)…$/);
    expect(el.querySelector('.save-status')?.classList.contains('sr-only')).toBe(true);
    expect(fake.callsTo('collab:push').length).toBeGreaterThan(0);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    await settle(8);
    const stored = fake.data.notes.at(-1)!;
    expect(stored.format).toBe('rich');
    expect(JSON.stringify(stored.content)).toContain('hello world');
    expect(el.querySelector('[role="status"].save-status')?.textContent).toBe('Saved');
  });

  it('creates a project through the New project dialog and validates names', async () => {
    const { el } = await mount();
    await click(byLabel(el, 'New project'));
    const dialog = el.ownerDocument.querySelector('dialog[open]');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog?.querySelector('h2')?.textContent).toBe('New project');
    const input = dialog!.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('New project');
    await typeInto(input, '   ');
    await click([...dialog!.querySelectorAll('button')].find((b) => b.textContent === 'Create') ?? null);
    expect(dialog!.querySelector('[role="alert"]')?.textContent).toBe('Names must be 1 to 200 characters without control characters.');
    await typeInto(input, 'Work');
    await click([...dialog!.querySelectorAll('button')].find((b) => b.textContent === 'Create') ?? null);
    expect(el.ownerDocument.querySelector('dialog[open]')).toBeNull();
    const labels = [...el.querySelectorAll('.tree [role="treeitem"]')].map((n) => n.textContent);
    expect(labels).toContain('Work');
  });

  it('tree keyboard: arrows move focus and Common cannot be renamed or trashed', async () => {
    const { el } = await mount();
    const tree = el.querySelector('[role="tree"]')!;
    expect(tree.getAttribute('aria-label')).toBe('Notes tree');
    const items = () => [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const first = items()[0]!;
    expect(first.textContent).toBe('Common');
    expect(first.getAttribute('tabindex')).toBe('0');
    await act(async () => first.focus());
    await key(first, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    await key(items()[0]!, 'F2');
    expect(el.querySelector('.toast')?.textContent).toContain('Common cannot be renamed');
    await key(items()[0]!, 'Delete');
    expect(el.textContent).toContain('Common cannot be moved to Trash');
    expect(el.ownerDocument.querySelector('dialog[open]')).toBeNull();
  });

  it('global shortcuts open the palette and Ctrl+N creates a note', async () => {
    const { el } = await mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    const palette = el.ownerDocument.querySelector('dialog[aria-label="Command palette"]');
    expect(palette).not.toBeNull();
    const input = palette!.querySelector('input[role="combobox"]') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Type a command or search notes');
    expect(palette!.textContent).toContain('New note');
    await typeInto(input, 'zzzz');
    expect(palette!.textContent).toContain('No matches');
    await key(input, 'Escape');
    await act(async () => {
      palette!.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await settle();
    expect(el.ownerDocument.querySelector('dialog[aria-label="Command palette"]')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it('Settings page switches the theme and shows About', async () => {
    const { el, fake } = await mount();
    await click(byLabel(el, 'Settings'));
    expect(el.querySelector('[role="tabpanel"] h2')?.textContent).toBe('Settings');
    const dark = byLabel(el, 'Theme')!.querySelectorAll('input')[2] as HTMLInputElement;
    await click(dark);
    expect(fake.calls.some((c) => c.channel === 'settings:set')).toBe(true);
    expect(el.textContent).toContain('Version 0.1.0');
    expect(el.textContent).toContain('Developed by Ashiqur Rahman Emran');
    expect(el.textContent).toContain('Copyright © 2026 Ashiqur Rahman Emran');
    expect(el.textContent).toContain('Storage ready (SQLite 3.0.0)');
  });

  it('Rail Notes toggles the tree pane and header buttons expose aria-expanded', async () => {
    const { el } = await mount();
    const notes = byLabel(el, 'Primary')!.querySelector('[aria-label="Notes"]') as HTMLElement;
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    await click(notes);
    expect(el.querySelector('#tree-pane')).toBeNull();
    expect(notes.getAttribute('aria-expanded')).toBe('false');
    const toggle = [...el.querySelectorAll('header button')].find((b) => b.getAttribute('aria-label')?.startsWith('Toggle details panel'));
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    await click(toggle ?? null);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(byLabel(el, 'Details')?.tagName).toBe('ASIDE');
  });

  it('a note shows only its text, its tab is its title; the save state appears only when not saved (D-102)', async () => {
    const { el, fake } = await mount();
    await click([...el.querySelectorAll('button.tile')].find((b) => b.textContent === 'New note') ?? null);
    const view = el.querySelector('.note-view')!;
    // A new note's tab is being renamed; the note view has no title field.
    const title = byLabel(el, 'Title') as HTMLInputElement;
    expect(title.classList.contains('tab-rename')).toBe(true);
    expect(view.contains(title)).toBe(false);
    expect(document.activeElement).toBe(title);
    expect(view.querySelectorAll('input, button, [contenteditable="true"]')).toHaveLength(1);
    expect(byLabel(view, 'Note text')?.getAttribute('role')).toBe('textbox');
    // Enter moves into the text; the tab shows the title again.
    await key(title, 'Enter');
    expect(byLabel(el, 'Title')).toBeNull();
    expect(document.activeElement).toBe(byLabel(view, 'Note text'));
    // No toolbar row, float button, location line or Details panel around the text.
    expect(view.querySelector('[role="toolbar"]')).toBeNull();
    expect(byLabel(view, 'Float as sticky')).toBeNull();
    expect(view.textContent).not.toContain('Common');
    expect(byLabel(el, 'Details')).toBeNull();
    const status = view.querySelector('[role="status"].save-status')!;
    expect(status.textContent).toBe('Saved');
    expect(status.classList.contains('sr-only')).toBe(true);

    fake.failNext('collab:push', { code: 'LIMIT_EXCEEDED', message: NOTE_TOO_LARGE_MESSAGE });
    await act(async () => {
      liveEditor()!.commands.insertContentAt(1, 'too much');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    await settle(8);
    expect(status.textContent).toBe('Not saved');
    expect(status.classList.contains('sr-only')).toBe(false);
    expect(status.classList.contains('save-status-alert')).toBe(true);
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(NOTE_TOO_LARGE_MESSAGE);
  });
});
