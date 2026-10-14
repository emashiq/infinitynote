// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_LOCK_MESSAGES } from '../../../src/shared/contracts/locks';
import { createFakeBridge } from './support/fake-bridge';
import { setupDom } from './support/dom';

const dom = setupDom();
const PASSWORD = 'correct horse battery';

const dialog = () => document.querySelector<HTMLDialogElement>('dialog');
const field = (label: string) => [...document.querySelectorAll<HTMLLabelElement>('dialog label')].find((l) => l.textContent === label)!.control as HTMLInputElement;
const button = (root: ParentNode, name: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined;

async function openTreeMenu(el: HTMLElement, documentId: string) {
  const row = el.querySelector<HTMLElement>(`[id="tree-document:${documentId}"]`)!;
  await act(async () => row.focus());
  await dom.key(row, 'F10', { shiftKey: true });
  return [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent);
}

async function chooseMenu(name: string) {
  await dom.click([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent === name)!);
}

async function lockWithDialog() {
  await dom.type(field('Password'), PASSWORD);
  await dom.type(field('Repeat password'), PASSWORD);
  await dom.click(document.querySelector('dialog input[type="checkbox"]'));
  await act(async () => {
    dialog()!.querySelector('form')!.requestSubmit();
  });
  await dom.settle();
}

describe('locked documents in the window (D-185)', () => {
  it('Lock… in the tree locks a document: the tab shows the lock screen, tree and tab show a lock, unlock shows the viewer', async () => {
    const fake = createFakeBridge();
    // The viewers of these documents need Office documents on (off by default, D-187).
    fake.data.settings.set('documents.office', true);
    const deck = fake.addDocument({ projectId: null, folderId: null, title: 'Board deck', kind: 'pptx', storage: 'managed', sizeBytes: 2048 });
    const { el } = await dom.mount(fake);
    await dom.click(el.querySelector(`[id="tree-document:${deck.id}"]`));
    // Opening reads the document once; only a change of its lock reads it again (no spurious viewer remount).
    expect(fake.callsTo('document:open')).toHaveLength(1);
    expect(await openTreeMenu(el, deck.id)).toContain('Lock…');
    await chooseMenu('Lock…');
    expect(dialog()?.textContent).toContain('Its earlier versions and its search text are deleted now');
    await lockWithDialog();
    expect(dialog()).toBeNull();
    expect(deck.locked).toBe(true);

    const view = el.querySelector('.document-view')!;
    await dom.until(() => view.querySelector('.lock-screen'));
    expect(view.querySelector('.lock-screen')?.textContent).toContain('This document is locked.');
    expect(view.querySelector('.pptx-viewer, .pptx-message')).toBeNull();
    expect(el.querySelector(`[id="tree-document:${deck.id}"] [aria-label="Locked"]`)).not.toBeNull();
    expect(el.querySelector(`[id="tab-document:${deck.id}"] [aria-label="Locked"]`)).not.toBeNull();
    expect(button(view, 'Export a copy…')?.disabled).toBe(true);
    expect(button(view, 'Open in system app')?.disabled).toBe(true);
    expect(await openTreeMenu(el, deck.id)).toEqual(expect.arrayContaining(['Lock now', 'Lock settings…']));
    await act(async () => (document.activeElement as HTMLElement | null)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await dom.settle();

    const password = view.querySelector<HTMLInputElement>('.lock-screen input[type="password"]')!;
    await dom.type(password, 'wrong password');
    await act(async () => view.querySelector('form')!.requestSubmit());
    await dom.settle();
    expect(view.querySelector('.lock-screen [role="alert"]')?.textContent).toBe('That password is not correct.');
    await dom.type(password, PASSWORD);
    await act(async () => view.querySelector('form')!.requestSubmit());
    await dom.settle();
    expect(view.querySelector('.lock-screen')).toBeNull();
    await dom.until(() => view.querySelector('.pptx-message'));
    expect(button(view, 'Lock now')).toBeDefined();

    // Working in it reports use (throttled); main locking it again brings the lock screen back.
    await act(async () => view.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
    expect(fake.callsTo('lock:documentActivity')).toHaveLength(1);
    await act(async () => void (await fake.bridge.lock.documentLockNow({ documentId: deck.id })));
    await dom.settle();
    expect(view.querySelector('.lock-screen')).not.toBeNull();
  });

  it('a linked document is copied in to be locked; one over the copy limit is explained instead', async () => {
    const fake = createFakeBridge();
    // The viewers of these documents need Office documents on (off by default, D-187).
    fake.data.settings.set('documents.office', true);
    const at = { projectId: null, folderId: null };
    const paper = fake.addDocument({ ...at, title: 'Paper', kind: 'pptx', storage: 'linked', sizeBytes: 1000 }, { path: '/home/me/Paper.pptx', state: 'available', sizeBytes: 1000, modifiedAt: 1 });
    const scan = fake.addDocument({ ...at, title: 'Scan', kind: 'pdf', storage: 'linked', sizeBytes: 300 * 1024 * 1024 }, { path: '/home/me/Scan.pdf', state: 'available', sizeBytes: 1, modifiedAt: 1 });
    const { el } = await dom.mount(fake);

    await openTreeMenu(el, scan.id);
    await chooseMenu('Lock…');
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(DOCUMENT_LOCK_MESSAGES.linkedTooLarge(25));
    expect(dialog()?.querySelector('input[type="password"]')).toBeNull();
    await dom.click(button(dialog()!, 'Close')!);

    await dom.click(el.querySelector(`[id="tree-document:${paper.id}"]`));
    expect(el.querySelector('.document-header .file-chip-badge')?.textContent).toBe('Linked');
    await openTreeMenu(el, paper.id);
    await chooseMenu('Lock…');
    expect(dialog()?.textContent).toContain('Locking copies it into Infinity Notes and locks the copy; the original file stays where it is');
    expect(button(dialog()!, 'Copy in and lock')).toBeDefined();
    await lockWithDialog();
    expect(fake.callsTo('lock:documentSet').at(-1)?.req).toMatchObject({ documentId: paper.id, copyIn: true });
    expect(paper).toMatchObject({ locked: true, storage: 'managed' });
    // The open tab reads the document again: it is stored in Infinity Notes now.
    await dom.until(() => el.querySelector('.document-view .lock-screen'));
    expect(el.querySelector('.document-header .file-chip-badge')).toBeNull();
  });

  it('Lock settings of a document change the password and remove the lock', async () => {
    const fake = createFakeBridge();
    // The viewers of these documents need Office documents on (off by default, D-187).
    fake.data.settings.set('documents.office', true);
    const sheet = fake.addDocument({ projectId: null, folderId: null, title: 'Salaries', kind: 'xlsx', storage: 'managed', sizeBytes: 4096 });
    await fake.bridge.lock.documentSet({ documentId: sheet.id, password: PASSWORD, hello: false, acknowledged: true, copyIn: false });
    const { el } = await dom.mount(fake);
    await openTreeMenu(el, sheet.id);
    await chooseMenu('Lock settings…');
    expect(dialog()?.textContent).toContain('The file is stored unencrypted again from now on');
    const remove = [...dialog()!.querySelectorAll('section')].find((s) => s.textContent?.startsWith('Remove lock'))!;
    await dom.type(remove.querySelector('input')!, PASSWORD);
    await act(async () => remove.querySelector('form')!.requestSubmit());
    await dom.settle();
    expect(sheet.locked).toBe(false);
    expect(el.querySelector(`[id="tree-document:${sheet.id}"] [aria-label="Locked"]`)).toBeNull();
  });
});
