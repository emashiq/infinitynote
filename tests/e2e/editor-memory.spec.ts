import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { makePng } from '../support/png';
import { repoRoot } from './fixtures';
import { useApp } from './harness';
import { COMMON, createNote, importImage, reloadUi, saveDoc, saveText } from './seed';
import { activeTabLabel, openFromTree } from './ui';

const h = useApp();
const OUT = path.join(repoRoot, 'test-results', 'perf-editors.json');

interface Sample {
  cycles: number;
  usedJSHeapSize: number;
  workingSetKb: { browser: number; renderer: number; total: number };
}

async function sample(app: ElectronApplication, page: Page, cycles: number): Promise<Sample> {
  // performance.memory is Chromium-only and coarse; it is reported, not asserted (Phase 09 owns targets).
  const usedJSHeapSize = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? -1);
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize })));
  const sum = (filter: (t: string) => boolean) => metrics.filter((m) => filter(m.type)).reduce((a, m) => a + m.ws, 0);
  return { cycles, usedJSHeapSize, workingSetKb: { browser: sum((t) => t === 'Browser'), renderer: sum((t) => t === 'Tab'), total: sum(() => true) } };
}

/** INF-TABS-07 performance record: tab cycling keeps one live editor and bounded images; numbers are reported only. */
test('editor memory across tab cycles (perf record)', async () => {
  const { app, page } = await h.start();
  const ids: string[] = [];
  for (let i = 0; i < 10; i += 1) ids.push(await createNote(page, COMMON, `Perf ${String(i).padStart(2, '0')}`));
  const images = [];
  for (let i = 0; i < 20; i += 1) images.push(await importImage(page, makePng(200 + i, 120), `perf-${i}.png`));
  await saveDoc(page, ids[0]!, {
    type: 'doc',
    content: images.flatMap((img, i) => [
      { type: 'paragraph', content: [{ type: 'text', text: `image ${i}` }] },
      { type: 'image', attrs: { attachmentId: img.id, width: img.width, height: img.height } },
    ]),
  });
  for (const id of ids.slice(1)) await saveText(page, id, Array.from({ length: 200 }, (_, i) => `line ${i} of ${id}`).join('\n'));
  await reloadUi(page);
  for (const id of ids) await openFromTree(page, id);

  const samples: Sample[] = [await sample(app, page, 0)];
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    for (let step = 0; step < ids.length + 1; step += 1) {
      await page.keyboard.press('Control+Tab');
      const label = await activeTabLabel(page);
      await expect(page.locator('html')).toHaveAttribute('data-live-editors', label === 'Home' ? '0' : '1');
      await expect(page.locator('#tabpanel .ProseMirror')).toHaveCount(label === 'Home' ? 0 : 1);
    }
    if (cycle === 1 || cycle === 5) samples.push(await sample(app, page, cycle));
  }
  // Images exist only for the active tab, and only through the attachment protocol.
  await expect.poll(() => activeTabLabel(page)).toBe('Perf 09');
  await expect(page.locator('#tabpanel img')).toHaveCount(0);
  await page.keyboard.press('Control+Tab');
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Perf 00');
  await expect(page.locator('#tabpanel img')).toHaveCount(20);
  const srcs = await page.locator('#tabpanel img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src') ?? ''));
  expect(srcs.every((s) => s.startsWith('infinity-attachment://'))).toBe(true);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ platform: process.platform, tabs: ids.length, imagesInOneNote: 20, samples }, null, 2));
  console.log(`perf-editors ${JSON.stringify(samples)}`);
  expect(samples).toHaveLength(3);
});
