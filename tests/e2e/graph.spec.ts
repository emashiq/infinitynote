import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { detailsPanel, withPanel } from './reminder-ui';
import { COMMON, createNote, reloadUi, saveDoc } from './seed';
import { activeTabLabel, openByPalette } from './ui';

/**
 * The relation graph (F10, D-170): the Graph page from the rail and the palette, the canvas and its list view, search,
 * filters, a click that opens an item, the per-project entry in the tree, and the local graph in the Details panel.
 * Written in Run 6; runs in WSL under Xvfb and on CI (never on the Windows desktop).
 */
const h = useApp({ failOnMainErrors: true });

const link = (noteId: string) => ({ type: 'noteRef', attrs: { noteId, blockId: null, label: 'x', excerpt: null, alias: null } });

async function linkedNotes(page: Page) {
  const a = await createNote(page, COMMON, 'Alpha plan');
  const b = await createNote(page, COMMON, 'Beta notes');
  const c = await createNote(page, COMMON, 'Gamma loose');
  await saveDoc(page, a, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, link(b)] }] });
  await reloadUi(page);
  return { a, b, c };
}

test('the rail opens the graph; the list view shows items with their links and opens them', async () => {
  const { page } = await h.start();
  await linkedNotes(page);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Graph' }).click();
  await expect.poll(() => activeTabLabel(page)).toBe('Graph');
  await expect(page.getByRole('img', { name: /Relation graph: 3 items, 1 links/ })).toBeVisible();
  await page.getByRole('radio', { name: 'List' }).check();
  const list = page.getByRole('list', { name: 'Items and their links' });
  await expect(list.getByRole('list', { name: 'Linked with Alpha plan' })).toContainText('Beta notes');
  await list.getByRole('button', { name: 'Gamma loose' }).first().click();
  await expect.poll(() => activeTabLabel(page)).toBe('Gamma loose');
});

test('search highlights matches, unlinked items can be hidden, and a click on a node opens it', async () => {
  const { page } = await h.start();
  await linkedNotes(page);
  await openByPalette(page, 'Open graph');
  await page.getByRole('searchbox', { name: 'Search the graph' }).fill('beta');
  await expect(page.getByRole('status').filter({ hasText: '1 item matches' })).toBeVisible();
  await page.getByRole('switch', { name: 'Unlinked items' }).click();
  await expect(page.getByRole('img', { name: /Relation graph: 2 items, 1 links/ })).toBeVisible();

  const canvas = page.getByRole('img', { name: /Relation graph/ });
  await canvas.focus();
  await page.keyboard.press('0');
  // The graph settles, then a node is found by hovering over the canvas.
  const box = (await canvas.boundingBox())!;
  let opened = false;
  for (let y = box.y + 10; y < box.y + box.height && !opened; y += 8) {
    for (let x = box.x + 10; x < box.x + box.width && !opened; x += 8) {
      await page.mouse.move(x, y);
      if ((await page.locator('.graph-tooltip').count()) > 0) {
        await page.mouse.click(x, y);
        opened = true;
      }
    }
  }
  expect(opened).toBe(true);
  await expect.poll(() => activeTabLabel(page)).toMatch(/Alpha plan|Beta notes/);
});

test('a project’s tree menu opens its graph, and the Details panel shows the local graph of a note', async () => {
  const { app, page } = await h.start();
  await withPanel(app, page);
  await linkedNotes(page);
  await openByPalette(page, 'Alpha plan');
  const local = detailsPanel(page).locator('.local-graph-section');
  await expect(local.getByRole('img', { name: /Local graph: 2 items, 1 links/ })).toBeVisible();
  await local.getByRole('radio', { name: '2 links' }).check();
  await expect(local.getByRole('img', { name: /Local graph: 2 items/ })).toBeVisible();

  const project = await page.evaluate(() => window.infinity.project.create({ name: 'Atlas' }));
  if (!project.ok) throw new Error(project.error.message);
  await reloadUi(page);
  await page.getByRole('treeitem', { name: /Atlas/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open graph' }).click();
  await expect(page.getByRole('combobox', { name: 'Show' })).toHaveValue(`project:${project.data.project.id}`);
  await expect(page.getByText('Nothing to show.', { exact: false })).toBeVisible();
});
