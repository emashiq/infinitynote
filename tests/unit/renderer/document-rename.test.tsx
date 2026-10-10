// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { NAME_MESSAGE } from '../../../src/shared/names';
import { createFakeBridge } from './support/fake-bridge';
import { setupDom } from './support/dom';

const dom = setupDom();

function withSheet() {
  const fake = createFakeBridge();
  const sheet = fake.addDocument({ projectId: null, folderId: null, title: 'Budget', kind: 'xlsx', storage: 'managed', sizeBytes: 4096 });
  return { fake, sheet };
}

const field = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
const toastTexts = () => [...document.querySelectorAll('.toasts .toast')].map((t) => t.textContent ?? '');

async function enter(input: HTMLInputElement, value: string) {
  await dom.type(input, value);
  await dom.key(input, 'Enter');
  await dom.settle();
}

describe('renaming documents (D-182)', () => {
  it('the tree menu Rename keeps its field open and focused, for documents and notes', async () => {
    const { fake, sheet } = withSheet();
    const created = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'Plan' });
    if (!created.ok) throw new Error('note');
    const note = created.data.note;
    const { el } = await dom.mount(fake);
    for (const [key, next] of [
      [`document:${sheet.id}`, 'Budget 2026'],
      [`note:${note.id}`, 'Plan B'],
    ] as const) {
      const row = el.querySelector<HTMLElement>(`[id="tree-${key}"]`)!;
      await act(async () => row.focus());
      await dom.key(row, 'F10', { shiftKey: true });
      await dom.click([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent === 'Rename')!);
      const input = field('Rename')!;
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);
      await enter(input, next);
      expect(el.querySelector(`[id="tree-${key}"] .tree-label`)?.textContent).toBe(next);
      expect(document.activeElement).toBe(el.querySelector(`[id="tree-${key}"]`));
    }
    expect(sheet.title).toBe('Budget 2026');
  });

  it('F2 on a document tab renames it with the tree rules; errors show as a notice and keep the field', async () => {
    const { fake, sheet } = withSheet();
    const { el } = await dom.mount(fake);
    await dom.click(el.querySelector(`[id="tree-document:${sheet.id}"]`));
    const tab = el.querySelector<HTMLElement>(`[id="tab-document:${sheet.id}"]`)!;
    await act(async () => tab.focus());
    await dom.key(tab, 'F2');
    const input = field('Rename')!;
    expect(input.classList.contains('tab-rename')).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Budget');
    await enter(input, '   ');
    expect(toastTexts()).toContain(NAME_MESSAGE);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(field('Rename')).toBe(input);
    expect(sheet.title).toBe('Budget');
    await enter(input, '  Forecast  ');
    expect(sheet.title).toBe('Forecast');
    expect(field('Rename')).toBeNull();
    expect(tab.querySelector('.tab-label')?.textContent).toBe('Forecast');
    expect(el.querySelector('.document-title-button')?.textContent).toBe('Forecast');
    expect(document.activeElement).toBe(tab);
  });

  it('double-click on a document tab opens its rename field; Escape keeps the name', async () => {
    const { fake, sheet } = withSheet();
    const { el } = await dom.mount(fake);
    await dom.click(el.querySelector(`[id="tree-document:${sheet.id}"]`));
    const tab = el.querySelector<HTMLElement>(`[id="tab-document:${sheet.id}"]`)!;
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await dom.settle();
    const input = field('Rename')!;
    await dom.type(input, 'Other');
    await dom.key(input, 'Escape');
    expect(field('Rename')).toBeNull();
    expect(sheet.title).toBe('Budget');
    expect(document.activeElement).toBe(tab);
  });

  it('the header title renames on click or F2 and from the Rename action, with inline errors', async () => {
    const { fake, sheet } = withSheet();
    const { el } = await dom.mount(fake);
    await dom.click(el.querySelector(`[id="tree-document:${sheet.id}"]`));
    const view = el.querySelector('.document-view')!;
    expect(view.querySelector('h2')?.textContent).toBe('Budget');

    await dom.click(view.querySelector('.document-title-button'));
    let input = field('Document name')!;
    expect(document.activeElement).toBe(input);
    await enter(input, '');
    expect(view.querySelector('.document-title [role="alert"]')?.textContent).toBe(NAME_MESSAGE);
    await dom.key(input, 'Escape');
    await dom.settle();
    expect(document.activeElement).toBe(view.querySelector('.document-title-button'));

    await dom.key(view.querySelector('.document-title-button')!, 'F2');
    input = field('Document name')!;
    await enter(input, 'Q3 budget');
    expect(sheet.title).toBe('Q3 budget');
    expect(el.querySelector(`[id="tree-document:${sheet.id}"] .tree-label`)?.textContent).toBe('Q3 budget');
    expect(el.querySelector(`[id="tab-document:${sheet.id}"] .tab-label`)?.textContent).toBe('Q3 budget');
    expect(document.activeElement).toBe(view.querySelector('.document-title-button'));

    await dom.click([...view.querySelectorAll('.document-actions button')].find((b) => b.textContent === 'Rename')!);
    expect(document.activeElement).toBe(field('Document name'));
  });
});
