import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { paletteAction, queueDialog } from './editor-ui';
import { useApp } from './harness';
import { activate, dialogByName, tabItem } from './ui';

/**
 * The PowerPoint viewer and editor (F5, D-149..D-155). Written in Run 4; run in WSL under Xvfb and on CI at the end of
 * release 0.3.0. Slides are SVG images; each drawing on the shown slide has a frame (`[data-shape-id]`) to select,
 * drag and resize, and the slide itself takes the keyboard.
 */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-pptx-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function importFile(page: Page, app: ElectronApplication, file: string) {
  await queueDialog(app, [file]);
  await paletteAction(page, 'Import file…');
  const dialog = dialogByName(page, 'Add file');
  await activate(dialog.getByRole('button', { name: 'Copy into Infinity Notes' }));
  await expect(dialog).toHaveCount(0);
}

function storedFile(title: string): string {
  const row = h.one<{ relative_path: string }>('SELECT b.relative_path FROM documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.title = ? AND d.deleted_at IS NULL', title)!;
  return path.join(h.userData, 'data', row.relative_path);
}
const revisionOf = (title: string) => h.one<{ revision: number }>('SELECT revision FROM documents WHERE title = ? AND deleted_at IS NULL', title)?.revision;
const storedParts = (title: string) => unzipSync(new Uint8Array(fs.readFileSync(storedFile(title))));
const partText = (title: string, part: string) => strFromU8(storedParts(title)[part]!);

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Presentation' });
const status = (page: Page) => toolbar(page).getByRole('status');
const slides = (page: Page) => page.getByRole('listbox', { name: 'Slides' }).getByRole('option');
const slide = (page: Page) => page.locator('[aria-roledescription="slide"]');
const frame = (page: Page, id: string) => page.locator(`.pptx-frame[data-shape-id="${id}"]`);
const notes = (page: Page) => page.getByRole('textbox', { name: /Speaker notes of slide/ });

async function openDeck(page: Page, app: ElectronApplication, name = 'Review.pptx'): Promise<string> {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, 'sample-rich.pptx'), file);
  await importFile(page, app, file);
  const title = path.basename(name, path.extname(name));
  await expect(tabItem(page, title)).toHaveAttribute('aria-selected', 'true');
  await expect(slides(page)).toHaveCount(3);
  await expect(page.locator('.pptx-slide-image')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  return title;
}

async function saveAndWait(page: Page, title: string, revision: number) {
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+S');
  await expect.poll(() => revisionOf(title)).toBe(revision);
  await expect(status(page)).toHaveText('');
}

test('opens a presentation with thumbnails, the slide drawn under the app CSP, notes and the not-shown banner', async () => {
  const { app, page } = await h.start();
  await openDeck(page, app);
  await expect(slide(page)).toHaveAttribute('aria-label', 'Slide 1 of 3');
  await expect(notes(page)).toHaveValue('Thank the team first');
  await expect(page.locator('.pptx-banner')).toContainText('transitions, charts (drawn simplified)');
  // The SVG drawing loaded as an image: the CSP allows data: images and nothing was blocked.
  expect(await page.locator('.pptx-slide-image').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.pptx-thumbnails img')).toHaveCount(3);
});

test('edits text in a placeholder keeping its bold run, saves, and only that slide changes', async () => {
  const { app, page } = await h.start();
  const title = await openDeck(page, app);
  const before = unzipSync(new Uint8Array(fs.readFileSync(path.join(FIXTURES, 'sample-rich.pptx'))));
  await frame(page, '3').dblclick();
  const editor = page.getByRole('textbox', { name: 'Text of body 3' });
  await expect(editor).toHaveText('Revenue grew strongly this quarter');
  await editor.locator('span[data-i="2"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' again');
  await page.keyboard.press('Escape');
  await saveAndWait(page, title, 1);
  const after = storedParts(title);
  const changed = Object.keys(before).filter((name) => !Buffer.from(after[name]!).equals(Buffer.from(before[name]!)));
  expect(changed).toEqual(['ppt/slides/slide1.xml']);
  expect(partText(title, 'ppt/slides/slide1.xml')).toContain('<a:rPr lang="en-US" b="1"/><a:t>strongly</a:t>');
  expect(partText(title, 'ppt/slides/slide1.xml')).toContain('this quarter again');
});

test('moves a shape with the mouse and nudges it with the keyboard', async () => {
  const { app, page } = await h.start();
  const title = await openDeck(page, app);
  const picture = frame(page, '4');
  const box = (await picture.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  await expect(picture).toHaveClass(/pptx-frame-selected/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowRight');
  await saveAndWait(page, title, 1);
  const off = /<p:pic>.*?<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)"/.exec(partText(title, 'ppt/slides/slide1.xml'))!;
  expect(Number(off[1])).toBeLessThan(9_144_000);
  expect(Number(off[2])).toBeLessThan(4_572_000);
  expect(Number(off[3])).toBeGreaterThan(1_828_800);
});

test('adds, reorders and deletes slides, and writes speaker notes', async () => {
  const { app, page } = await h.start();
  const title = await openDeck(page, app);
  await activate(toolbar(page).getByRole('button', { name: 'New slide' }));
  await expect(slides(page)).toHaveCount(4);
  await expect(slides(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await notes(page).fill('Notes for the new slide');
  // Drag the new slide to the end of the list.
  await slides(page).nth(1).dragTo(slides(page).nth(3), { targetPosition: { x: 20, y: 70 } });
  await expect(slides(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  await slides(page).nth(0).click();
  await page.getByRole('listbox', { name: 'Slides' }).press('Alt+ArrowDown');
  await expect(slides(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await slides(page).nth(2).click();
  await page.getByRole('listbox', { name: 'Slides' }).press('Delete');
  await expect(slides(page)).toHaveCount(3);
  await saveAndWait(page, title, 1);
  const presentation = partText(title, 'ppt/presentation.xml');
  expect(presentation.match(/<p:sldId /g)).toHaveLength(3);
  const notesParts = Object.entries(storedParts(title)).filter(([name]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  expect(notesParts.some(([, bytes]) => strFromU8(bytes).includes('Notes for the new slide'))).toBe(true);

  await activate(page.getByRole('tab', { name: 'Home', exact: true }));
  await page.getByRole('tab', { name: title }).click();
  await expect(slides(page)).toHaveCount(3);
});

test('inserts a text box and a picture, and undoes and redoes', async () => {
  const { app, page } = await h.start();
  const title = await openDeck(page, app);
  await slides(page).nth(2).click();
  await activate(toolbar(page).getByRole('button', { name: 'Text box' }));
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Inserted words');
  await page.keyboard.press('Escape');
  const png = path.join(dir, 'pixel.png');
  fs.writeFileSync(png, unzipSync(new Uint8Array(fs.readFileSync(path.join(FIXTURES, 'sample-rich.pptx'))))['ppt/media/image1.png']!);
  const chooser = page.waitForEvent('filechooser');
  await activate(toolbar(page).getByRole('button', { name: 'Picture' }));
  await (await chooser).setFiles(png);
  await expect(page.locator('.pptx-frame')).toHaveCount(3);
  await activate(toolbar(page).getByRole('button', { name: 'Undo' }));
  await expect(page.locator('.pptx-frame')).toHaveCount(2);
  await activate(toolbar(page).getByRole('button', { name: 'Redo' }));
  await expect(page.locator('.pptx-frame')).toHaveCount(3);
  await saveAndWait(page, title, 1);
  expect(partText(title, 'ppt/slides/slide3.xml')).toContain('Inserted words');
  expect(Object.keys(storedParts(title)).filter((name) => name.startsWith('ppt/media/'))).toHaveLength(2);
});

test('presentation mode steps with keys and clicks and Esc returns to the editor', async () => {
  const { app, page } = await h.start();
  await openDeck(page, app);
  await activate(toolbar(page).getByRole('button', { name: 'Present' }));
  const show = page.getByRole('dialog', { name: 'Presentation' });
  await expect(show.getByRole('status')).toHaveText('1 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(show.getByRole('status')).toHaveText('2 / 3');
  await page.keyboard.press('Space');
  await expect(show.getByRole('status')).toHaveText('3 / 3');
  await page.keyboard.press('PageUp');
  await show.click();
  await expect(show.getByRole('status')).toHaveText('3 / 3');
  await page.keyboard.press('Escape');
  await expect(show).toHaveCount(0);
  await expect(slides(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('F5');
  await expect(page.getByRole('dialog', { name: 'Presentation' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Versions: an earlier version opens read-only and restores', async () => {
  const { app, page } = await h.start();
  const title = await openDeck(page, app);
  const original = fs.readFileSync(storedFile(title));
  await notes(page).fill('Changed notes');
  await notes(page).blur();
  await saveAndWait(page, title, 1);
  await activate(page.getByRole('button', { name: 'Versions' }));
  const panel = page.getByRole('complementary', { name: 'Versions' });
  await expect(panel.locator('.version-row')).toHaveCount(1);
  await activate(panel.getByRole('button', { name: 'Open' }));
  await expect(page.locator('.document-version-banner')).toContainText('Revision 0 from');
  await expect(status(page)).toHaveText('Read-only');
  await expect(notes(page)).toHaveValue('Thank the team first');
  await expect(toolbar(page).getByRole('button', { name: 'New slide' })).toHaveCount(0);
  await activate(page.locator('.document-version-banner').getByRole('button', { name: 'Restore this version' }));
  await expect.poll(() => revisionOf(title)).toBe(2);
  expect(fs.readFileSync(storedFile(title))).toEqual(original);
});

test('find goes to the slide of a match; search finds saved slide text and notes and opens the deck', async () => {
  const { app, page } = await h.start();
  const title = await openDeck(page, app);
  await page.keyboard.press('Control+F');
  await page.getByRole('searchbox', { name: 'Find in presentation' }).fill('timeline');
  await expect(page.locator('.document-find-count')).toHaveText('1 of 1');
  await expect(slides(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await notes(page).fill('Mention the wombat');
  await notes(page).blur();
  await saveAndWait(page, title, 1);
  await activate(page.getByRole('tab', { name: 'Home', exact: true }));
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('wombat');
  await expect(page.getByRole('option', { name: /Review/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(tabItem(page, title)).toHaveAttribute('aria-selected', 'true');
});

test('closing the tab saves edits first', async () => {
  const { app, page } = await h.start();
  const title = await openDeck(page, app);
  await slide(page).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+W');
  await expect.poll(() => revisionOf(title)).toBe(1);
});
