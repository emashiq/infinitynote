// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { createFakeBridge } from './support/fake-bridge';
import { setupDom } from './support/dom';

const dom = setupDom();

async function withNotes() {
  const fake = createFakeBridge();
  const ids: string[] = [];
  for (const title of ['One', 'Two']) {
    const r = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: false, title });
    if (!r.ok) throw new Error('note');
    ids.push(r.data.note.id);
  }
  return { fake, ids };
}

const tabs = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('[role="tab"]')];

describe('tab strip (INF-TABS-02, INF-HOME-01)', () => {
  it('exposes tab roles, aria-selected and a single roving tab stop; Home has no close button', async () => {
    const { fake, ids } = await withNotes();
    const { el } = await dom.mount(fake);
    const list = el.querySelector('[role="tablist"]')!;
    expect(list.getAttribute('aria-label')).toBe('Open tabs');
    await dom.click(el.querySelector(`[id="tree-note:${ids[0]}"]`));
    expect(tabs(el).map((t) => t.textContent)).toEqual(['Home', 'One']);
    expect(tabs(el).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(tabs(el).filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(tabs(el)[1]!.tabIndex).toBe(0);
    expect(tabs(el)[0]!.parentElement!.querySelector('.tab-close')).toBeNull();
    expect(tabs(el)[1]!.parentElement!.querySelector('.tab-close')?.getAttribute('aria-label')).toBe('Close One');
    expect(el.querySelector('#tabpanel')?.getAttribute('aria-labelledby')).toBe(tabs(el)[1]!.id);
  });

  it('arrow keys move focus without activating and Enter activates', async () => {
    const { fake, ids } = await withNotes();
    const { el } = await dom.mount(fake);
    await dom.click(el.querySelector(`[id="tree-note:${ids[0]}"]`));
    const [home, one] = tabs(el);
    await act(async () => one!.focus());
    await dom.key(one!, 'ArrowLeft');
    expect(document.activeElement).toBe(home);
    expect(one!.getAttribute('aria-selected')).toBe('true');
    await dom.key(home!, 'Enter');
    expect(home!.getAttribute('aria-selected')).toBe('true');
    await dom.key(home!, 'End');
    expect(document.activeElement).toBe(one);
  });

  it('Delete closes a note tab but never Home, and the note is kept', async () => {
    const { fake, ids } = await withNotes();
    const { el } = await dom.mount(fake);
    await dom.click(el.querySelector(`[id="tree-note:${ids[0]}"]`));
    await dom.click(el.querySelector(`[id="tree-note:${ids[1]}"]`));
    expect(tabs(el).map((t) => t.textContent)).toEqual(['Home', 'One', 'Two']);
    await act(async () => tabs(el)[2]!.focus());
    await dom.key(tabs(el)[2]!, 'Delete');
    expect(tabs(el).map((t) => t.textContent)).toEqual(['Home', 'One']);
    expect(tabs(el)[1]!.getAttribute('aria-selected')).toBe('true');
    await dom.key(tabs(el)[0]!, 'Delete');
    expect(tabs(el).map((t) => t.textContent)).toEqual(['Home', 'One']);
    expect(el.querySelector(`[id="tree-note:${ids[1]}"]`)).not.toBeNull();
    expect(fake.callsTo('note:trash')).toHaveLength(0);
  });

  it('the All tabs menu lists every tab as a radio item with the active one checked', async () => {
    const { fake, ids } = await withNotes();
    const { el } = await dom.mount(fake);
    await dom.click(el.querySelector(`[id="tree-note:${ids[0]}"]`));
    await dom.click(el.querySelector('[aria-label="All tabs"]'));
    const menu = document.querySelector('[role="menu"]')!;
    const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
    expect(items.map((i) => i.textContent)).toEqual(['Home', 'One']);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });
});
