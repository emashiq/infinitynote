import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { chooseNoteMenu, editor, focusEditorEnd, queueDialog, shellCalls, waitSaved } from './editor-ui';
import { detailsPanel, withPanel } from './reminder-ui';
import { COMMON, createNote, reloadUi, saveDoc, trashNote } from './seed';
import { activeTabLabel, dialogByName, openByPalette, toasts } from './ui';

const h = useApp({ failOnMainErrors: true });

const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

/** "Design" with 60 paragraphs; the target paragraph is near the end, far below the fold. */
async function seedDesign(page: Page): Promise<{ design: string; target: string }> {
  const design = await createNote(page, COMMON, 'Design');
  const target = randomUUID();
  const blocks = Array.from({ length: 60 }, (_, i) => (i === 55 ? para(target, 'Target paragraph') : para(randomUUID(), `Filler line ${i}`)));
  await saveDoc(page, design, { type: 'doc', content: blocks });
  return { design, target };
}

/** Inserts a reference through the note menu → "Link to note…": the note by title, then the whole note or a paragraph. */
async function linkTo(page: Page, title: string, paragraph: string | null): Promise<void> {
  await chooseNoteMenu(page, 'Link to note…');
  const picker = dialogByName(page, 'Link to note');
  await picker.getByRole('combobox', { name: 'Search notes by title' }).fill(title.slice(0, 3));
  await expect(picker.getByRole('option', { name: new RegExp(title) })).toBeVisible();
  await page.keyboard.press('Enter');
  const blocks = dialogByName(page, `Link to ${title}`);
  await expect(blocks.getByRole('option', { name: 'Whole note' })).toBeVisible();
  if (paragraph) {
    await blocks.getByRole('combobox', { name: 'Filter paragraphs' }).fill(paragraph.slice(0, 6));
    await expect(blocks.getByRole('option', { name: paragraph })).toBeVisible();
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await expect(blocks).toHaveCount(0);
}

const chip = (page: Page, name: string | RegExp) => editor(page).getByRole('link', { name });

test('picker: a note link is inserted from the searchable picker and indexed with the save (INF-REF-01)', async () => {
  const { page } = await h.start();
  const { design } = await seedDesign(page);
  const meeting = await createNote(page, COMMON, 'Meeting');
  await reloadUi(page);
  await openByPalette(page, 'Meeting');
  await focusEditorEnd(page);
  await page.keyboard.insertText('See ');
  await linkTo(page, 'Design', null);
  await expect(chip(page, 'Design')).toBeVisible();
  await page.keyboard.insertText('for details');
  await waitSaved(page);
  expect(h.all('SELECT target_note_id, target_block_id FROM note_references WHERE source_note_id = ?', meeting)).toEqual([{ target_note_id: design, target_block_id: null }]);
  expect(h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', meeting)!.plain_text).toBe('See Design for details');

  // Escape closes the picker without inserting anything; the palette action opens it too.
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('Link to note');
  await page.keyboard.press('Enter');
  await expect(dialogByName(page, 'Link to note')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialogByName(page, 'Link to note')).toHaveCount(0);
  await expect(editor(page).getByRole('link')).toHaveCount(1);
});

test('scroll to block: a block reference opens the target in a tab at that paragraph (INF-REF-02, INF-REF-04)', async () => {
  const { page } = await h.start();
  const { design, target } = await seedDesign(page);
  const meeting = await createNote(page, COMMON, 'Meeting');
  await reloadUi(page);
  await openByPalette(page, 'Meeting');
  await focusEditorEnd(page);
  await linkTo(page, 'Design', 'Target paragraph');
  await expect(chip(page, 'Design › Target paragraph')).toBeVisible();
  await waitSaved(page);
  expect(h.all('SELECT target_note_id, target_block_id FROM note_references WHERE source_note_id = ?', meeting)).toEqual([{ target_note_id: design, target_block_id: target }]);

  await chip(page, 'Design › Target paragraph').click();
  await expect.poll(() => activeTabLabel(page)).toBe('Design');
  const revealed = page.locator('.note-editor-content .reveal-block');
  await expect(revealed).toHaveText('Target paragraph');
  await expect(revealed).toBeInViewport();
});

test('backlinks: the Details panel lists outgoing references and backlinks, and opens them (INF-REF-03)', async () => {
  const { app, page } = await h.start();
  const { design, target } = await seedDesign(page);
  const meeting = await createNote(page, COMMON, 'Meeting');
  const P = randomUUID();
  await saveDoc(page, meeting, {
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { id: P }, content: [{ type: 'text', text: 'Agreed in ' }, { type: 'noteRef', attrs: { noteId: design, blockId: target, label: 'Design', excerpt: 'Target paragraph' } }] }],
  });
  await reloadUi(page);
  await withPanel(app, page);
  await openByPalette(page, 'Design');
  const backlinks = detailsPanel(page).getByRole('list', { name: 'Backlinks' });
  await expect(backlinks.getByRole('button')).toHaveText(/Meeting.*Agreed in Design/);

  await backlinks.getByRole('button', { name: /Meeting/ }).click();
  await expect.poll(() => activeTabLabel(page)).toBe('Meeting');
  const outgoing = detailsPanel(page).getByRole('list', { name: 'Outgoing references' });
  await expect(outgoing.getByRole('button')).toHaveText(/Design.*Target paragraph/);
  await expect(detailsPanel(page).getByRole('list', { name: 'Backlinks' }).getByRole('listitem')).toHaveCount(0);
  await expect(detailsPanel(page).getByText('No other note links here')).toBeVisible();

  // The compact close control hides the docked panel.
  await detailsPanel(page).getByRole('button', { name: 'Close details panel' }).click();
  await expect(detailsPanel(page)).toHaveCount(0);
});

test('trashed target: a broken link shows Trash or missing with Restore and Search, never another note (INF-REF-05, INF-REF-06)', async () => {
  const { app, page } = await h.start();
  const { design } = await seedDesign(page);
  const meeting = await createNote(page, COMMON, 'Meeting');
  await saveDoc(page, meeting, {
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'noteRef', attrs: { noteId: design, blockId: null, label: 'Design', excerpt: null } }] }],
  });
  await reloadUi(page);
  await withPanel(app, page);
  await openByPalette(page, 'Meeting');
  const outgoing = detailsPanel(page).getByRole('list', { name: 'Outgoing references' });

  // Rename keeps the link and shows the new title (INF-REF-05).
  await page.evaluate((id) => window.infinity.note.rename({ noteId: id, title: 'Design v2' }), design);
  await expect(chip(page, 'Design v2')).toBeVisible();
  await expect(outgoing).toContainText('Design v2');

  await trashNote(page, design);
  // A chip whose target is not live keeps the title it was inserted with, marked unavailable.
  await expect(chip(page, 'Design (linked note unavailable)')).toBeVisible();
  await expect(outgoing).toContainText('The linked note is in Trash');
  // The chip opens the note's own Trash state, not a different note.
  await chip(page, 'Design (linked note unavailable)').click();
  await expect(page.locator(`[role="tab"][id="tab-note:${design}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'This note is in Trash' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Search' })).toBeVisible();
  await openByPalette(page, 'Meeting');

  await outgoing.getByRole('button', { name: 'Restore' }).click();
  await expect(outgoing).not.toContainText('The linked note is in Trash');
  await expect(chip(page, 'Design v2')).toBeVisible();

  // Purged: the link keeps the last title and says the note no longer exists; Search looks for it.
  const batch = await page.evaluate(async (id) => {
    const r = await window.infinity.note.trash({ noteId: id });
    return r.ok ? r.data.trashBatchId : null;
  }, design);
  await page.evaluate((b) => window.infinity.trash.purge({ target: { kind: 'batch', batchId: b! }, confirmed: true }), batch);
  await expect(outgoing).toContainText('The linked note no longer exists');
  await expect(outgoing.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  await outgoing.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('combobox', { name: 'Type a command or search notes' })).toHaveValue('Design v2');
});

test('attached documents open only through the validated hand-off; programs are never launched (INF-REF-08)', async () => {
  const { app, page } = await h.start();
  await createNote(page, COMMON, 'Files');
  await reloadUi(page);
  await openByPalette(page, 'Files');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-handoff-'));
  try {
    const pdf = path.join(dir, 'report.pdf');
    const exe = path.join(dir, 'tool.exe');
    fs.writeFileSync(pdf, '%PDF-1.4 test');
    fs.writeFileSync(exe, 'MZ test');
    await focusEditorEnd(page);
    await queueDialog(app, [pdf, exe]);
    await chooseNoteMenu(page, 'Attach file');
    await page.getByRole('dialog', { name: 'Add 2 files' }).getByRole('button', { name: 'Copy into Infinity Notes' }).click();
    await expect(editor(page).locator('.file-chip')).toHaveCount(2);
    await waitSaved(page);

    await editor(page).getByRole('button', { name: 'Open report.pdf' }).click();
    await expect.poll(async () => (await shellCalls(app)).filter((c) => c.op === 'openPath').map((c) => path.extname(c.path!))).toEqual(['.pdf']);

    await editor(page).getByRole('button', { name: 'Open tool.exe' }).click();
    await expect(toasts(page).filter({ hasText: 'This kind of file is not opened from Infinity Notes. Use Show in folder.' })).toBeVisible();
    await editor(page).getByRole('button', { name: 'Show tool.exe in folder' }).click();
    await expect.poll(async () => (await shellCalls(app)).map((c) => `${c.op}${path.extname(c.path ?? '')}`)).toEqual(['openPath.pdf', 'showItemInFolder.exe']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
