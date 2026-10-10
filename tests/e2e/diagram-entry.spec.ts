import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { editor, focusEditorEnd, noteMenu, paletteAction, seedClipboardHtml, selectionChange, toolbarButton, waitSaved } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi } from './seed';
import { stickyPage } from './sticky-ui';
import { openByPalette } from './ui';

/**
 * Every way to make a Mermaid diagram (D-183): the note menu's Insert diagram, the formatting toolbar's Diagram button,
 * the palette, "```mermaid" then Enter, and pasted Markdown; in a note tab and in a sticky.
 */
const h = useApp({ failOnMainErrors: true });

const drawn = (page: Page) => editor(page).locator('.code-block.is-diagram').getByRole('img', { name: 'Diagram' });
const writeClipboardText = (app: ElectronApplication, text: string) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);

async function openNote(page: Page, title: string): Promise<string> {
  const id = await createNote(page, COMMON, title);
  await reloadUi(page);
  await openByPalette(page, title);
  await focusEditorEnd(page);
  return id;
}

const storedText = (id: string) => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)!.plain_text;

test('Insert diagram in the note menu and in the palette add a drawn flowchart', async () => {
  const { page } = await h.start();
  const id = await openNote(page, 'Menu diagram');
  await editor(page).click({ button: 'right' });
  await noteMenu(page).getByRole('menuitem', { name: 'Insert diagram', exact: true }).click();
  await expect(drawn(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(drawn(page)).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press('Control+End');
  await paletteAction(page, 'Insert diagram');
  await expect(drawn(page)).toHaveCount(2, { timeout: 15_000 });
  await waitSaved(page);
  expect(storedText(id).match(/flowchart TD/g)).toHaveLength(2);
});

test('the formatting toolbar turns selected Mermaid source into a diagram, and back into text', async () => {
  const { page } = await h.start();
  await openNote(page, 'Toolbar diagram');
  await page.keyboard.type('graph LR; Start --> Finish');
  await selectionChange(page, () => page.keyboard.press('Shift+Home'));
  await toolbarButton(page, 'Diagram').click();
  await expect(drawn(page)).toBeVisible({ timeout: 15_000 });
  await expect(editor(page).locator('.code-block.is-diagram pre code')).toHaveText('graph LR; Start --> Finish');
  await editor(page).locator('.code-block.is-diagram pre code').click();
  await page.keyboard.press('End');
  await selectionChange(page, () => page.keyboard.press('Shift+Home'));
  await expect(toolbarButton(page, 'Diagram')).toHaveAttribute('aria-pressed', 'true');
  await toolbarButton(page, 'Diagram').click();
  await expect(editor(page).locator('.code-block.is-diagram')).toHaveCount(0);
  await expect(editor(page).locator('p', { hasText: 'graph LR; Start --> Finish' })).toBeVisible();
});

test('```mermaid then Enter starts a diagram block; typed source is drawn', async () => {
  const { page } = await h.start();
  const id = await openNote(page, 'Fence diagram');
  await page.keyboard.type('```mermaid');
  await page.keyboard.press('Enter');
  const block = editor(page).locator('.code-block.is-diagram');
  await expect(block).toHaveCount(1);
  await page.keyboard.type('sequenceDiagram\n  Alice->>Bob: Hello');
  await expect(block.getByRole('img', { name: 'Diagram' })).toBeVisible({ timeout: 15_000 });
  await waitSaved(page);
  expect(storedText(id)).toContain('Alice->>Bob: Hello');
  expect(storedText(id)).not.toContain('```');
});

test('pasted Markdown with a mermaid fence becomes a diagram, from plain text and from an editor that adds styled HTML', async () => {
  const { app, page } = await h.start();
  await openNote(page, 'Pasted diagram');
  await writeClipboardText(app, 'The flow:\n```mermaid\nflowchart LR\n  Paste --> Diagram\n```\nDone.');
  await page.keyboard.press('Control+V');
  await expect(drawn(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(editor(page).locator('p', { hasText: 'The flow:' })).toBeVisible();
  await expect(editor(page).locator('p', { hasText: 'Done.' })).toBeVisible();

  await page.keyboard.press('Control+End');
  await seedClipboardHtml(
    app,
    '<div style="color:#333"><div><span>```mermaid</span></div><div><span>flowchart TD</span></div><div><span>  Styled --&gt; Pasted</span></div><div><span>```</span></div></div>',
    '```mermaid\nflowchart TD\n  Styled --> Pasted\n```',
  );
  await page.keyboard.press('Control+V');
  await expect(drawn(page)).toHaveCount(2, { timeout: 15_000 });
});

test('a sticky makes diagrams the same ways', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Sticky diagram', { sticky: true });
  await page.evaluate((noteId) => window.infinity.sticky.float({ noteId }), id);
  const sticky = await stickyPage(app, id);
  await editor(sticky).click();
  await sticky.keyboard.type('```mermaid');
  await sticky.keyboard.press('Enter');
  await sticky.keyboard.type('flowchart LR\n  A --> B');
  await expect(drawn(sticky)).toBeVisible({ timeout: 15_000 });
  await sticky.keyboard.press('Control+End');
  await sticky.keyboard.press('ArrowDown');
  await editor(sticky).click({ button: 'right', position: { x: 10, y: 10 } });
  await noteMenu(sticky).getByRole('menuitem', { name: 'Insert diagram', exact: true }).click();
  await expect(drawn(sticky)).toHaveCount(2, { timeout: 15_000 });
});
