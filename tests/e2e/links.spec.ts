import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { editor, focusEditorEnd, selectionChange, waitSaved } from './editor-ui';
import { detailsPanel, withPanel } from './reminder-ui';
import { COMMON, createNote, reloadUi, saveDoc } from './seed';
import { activeTabLabel, dialogByName, openByPalette } from './ui';

/**
 * Links to notes and documents by key (F9, D-156, D-157): "[[", Ctrl+Shift+L, Ctrl+Shift+K on a selection, places in
 * documents, "Create note", document backlinks. Written in Run 5; runs in WSL under Xvfb and on CI (never on the
 * Windows desktop).
 */
const h = useApp({ failOnMainErrors: true });

async function createDeck(page: Page, title: string): Promise<string> {
  const res = await page.evaluate((t) => window.infinity.document.create({ location: { projectId: null, folderId: null }, kind: 'pptx', title: t }), title);
  if (!res.ok) throw new Error(res.error.message);
  return res.data.document.id;
}

const picker = (page: Page) => dialogByName(page, 'Link to note or document');

test('"[[" opens the picker over notes and documents; Escape puts the brackets back', async () => {
  const { page } = await h.start();
  await createNote(page, COMMON, 'Roadmap notes');
  await createDeck(page, 'Roadmap deck');
  await createNote(page, COMMON, 'Planning');
  await reloadUi(page);
  await openByPalette(page, 'Planning');
  await focusEditorEnd(page);
  await page.keyboard.type('See [[');
  await expect(picker(page)).toBeVisible();
  await picker(page).getByRole('combobox', { name: 'Search notes and documents' }).fill('roadm');
  // Equal title matches: the more recently changed first (the deck was made after the note).
  await expect(picker(page).getByRole('option')).toHaveText([/Roadmap deck/, /Roadmap notes/, /Create note “roadm”/]);
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
  await expect(editor(page)).toContainText('See [[');
});

test('a document link at a slide opens the presentation there and is listed as a backlink of the document', async () => {
  const { app, page } = await h.start();
  const deck = await createDeck(page, 'Quarterly deck');
  const note = await createNote(page, COMMON, 'Review');
  await reloadUi(page);
  await openByPalette(page, 'Review');
  await focusEditorEnd(page);
  await page.keyboard.press('Control+Shift+L');
  await picker(page).getByRole('combobox').fill('Quarterly');
  // The results arrive from main; until then the only choice is "Create note".
  await expect(picker(page).getByRole('option').first()).toHaveText(/Quarterly deck/);
  await page.keyboard.press('Enter');
  const place = dialogByName(page, 'Link to Quarterly deck');
  await place.getByRole('combobox', { name: 'Slide number' }).fill('1');
  await expect(place.getByRole('option').first()).toHaveText('Slide 1');
  await page.keyboard.press('Enter');
  const chip = editor(page).getByRole('link', { name: 'Quarterly deck › Slide 1' });
  await expect(chip).toBeVisible();
  await waitSaved(page);
  expect(h.all('SELECT target_document_id, target_json FROM document_references WHERE source_note_id = ?', note)).toEqual([{ target_document_id: deck, target_json: '{"slide":1}' }]);

  await chip.click();
  await expect.poll(() => activeTabLabel(page)).toBe('Quarterly deck');
  await withPanel(app, page);
  const backlinks = detailsPanel(page).getByRole('list', { name: 'Backlinks' });
  await expect(backlinks.getByRole('button', { name: /Review/ })).toBeVisible();
});

test('Ctrl+Shift+K links the selected text; "Create note" makes the target beside the note', async () => {
  const { page } = await h.start();
  const note = await createNote(page, COMMON, 'Ideas');
  await saveDoc(page, note, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: 'read the brand guide today' }] }] });
  await reloadUi(page);
  await openByPalette(page, 'Ideas');
  // The paragraph is selected with the keyboard (a double click at its middle can land after its text).
  await editor(page).getByText('read the brand guide today').click();
  await page.keyboard.press('Home');
  await selectionChange(page, () => page.keyboard.press('Shift+End'));
  await page.keyboard.press('Control+Shift+K');
  const combo = picker(page).getByRole('combobox');
  await expect(combo).toHaveValue('read the brand guide today');
  await combo.fill('Brand guide');
  await expect(picker(page).getByRole('option', { name: 'Create note “Brand guide”' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const created = h.one<{ id: string }>("SELECT id FROM notes WHERE title = 'Brand guide'")!;
  expect(h.all('SELECT target_note_id FROM note_references WHERE source_note_id = ?', note)).toEqual([{ target_note_id: created.id }]);
  // Ctrl+K is still the app's search.
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('combobox', { name: 'Type a command or search notes' })).toBeVisible();
});
