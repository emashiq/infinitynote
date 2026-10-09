import { randomUUID } from 'node:crypto';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURE_QUERIES, median, p95, seedLargeNotebook } from '../support/perf-fixture';
import { makeNoisePng } from '../support/png';
import { editor, focusEditorEnd, paste, seedClipboardHtml, waitSaved } from './editor-ui';
import { packagedExe } from './fixtures';
import { useApp } from './harness';
import { advance, reminderEnv, reminderRowsOnPage, shownNotifications, widgetPage } from './reminder-ui';
import { COMMON, createNote, importImage, reloadUi, saveDoc } from './seed';
import { listenerCounts, stickyNoteIds, stickyPage } from './sticky-ui';
import { activate, dialogByName, openFromTree, railGo } from './ui';

/**
 * Integrated measurements (INF-PERF-01..05, Phase 09). Every scenario prints one `PERF <name> {json}` line; the numbers
 * in docs/FINAL_REPORT.md come from those lines in the run logs. Assertions hold the product targets where one exists
 * (search p95 < 300 ms, cold start < 3 s, a 256K Bangla run responsive < 1 s) and otherwise catch regressions only.
 */
const h = useApp();
const NOTES = 10_000;
const PROJECTS = 100;
const REMINDERS = 1_000;
const DAY = 24 * 60 * 60_000;

function record(name: string, data: Record<string, unknown>): void {
  console.log(`PERF ${name} ${JSON.stringify({ platform: process.platform, packaged: packagedExe !== '', ...data })}`);
}

const round = (ms: number) => Math.round(ms * 10) / 10;
const summary = (samples: number[]) => ({ n: samples.length, median: round(median(samples)), p95: round(p95(samples)), max: round(Math.max(...samples)) });

/** Starts the app on a profile holding the 10,000-note, 100-project fixture (written while the app is closed). */
async function startWithLargeNotebook(env: Record<string, string>) {
  await h.start(env);
  await h.stop();
  let noteIds: string[] = [];
  h.writeWhileClosed((db) => {
    noteIds = seedLargeNotebook(db, { projects: PROJECTS, notes: NOTES }).noteIds;
  });
  const launched = await h.start(env);
  return { ...launched, noteIds };
}

/** Restarts `runs` times; launch is Playwright's launch-to-ready time, process is Electron's own uptime at that point. */
async function coldStarts(runs: number, env: Record<string, string>): Promise<{ launchMs: number[]; processMs: number[]; page: Page; app: ElectronApplication }> {
  const launchMs: number[] = [];
  const processMs: number[] = [];
  let last: { page: Page; app: ElectronApplication } | null = null;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    last = await h.restart(env);
    launchMs.push(Math.round(performance.now() - started));
    processMs.push(await last.app.evaluate(() => Math.round(process.uptime() * 1000)));
  }
  return { launchMs, processMs, ...last! };
}

/** Search through the real bridge from the renderer: 4 rounds of the fixture queries, every other round in a project. */
async function searchTimes(page: Page, projectId: string): Promise<number[]> {
  return page.evaluate(
    async ([queries, project]) => {
      const times: number[] = [];
      for (let r = 0; r < 4; r += 1) {
        for (const query of queries) {
          const started = performance.now();
          const res = await window.infinity.search.query({ query, ...(r % 2 === 1 ? { scope: { kind: 'project' as const, projectId: project } } : {}) });
          times.push(performance.now() - started);
          if (!res.ok || res.data.results.length > 50) throw new Error(`search ${query} failed`);
        }
      }
      return times;
    },
    [FIXTURE_QUERIES as readonly string[], projectId] as const,
  );
}

/** Creates reminders on the first notes through the real bridge; dates spread over 30 days from `firstDate`. */
async function createReminders(page: Page, noteIds: string[], firstDate: string): Promise<number> {
  return page.evaluate(
    async ([ids, first]) => {
      const started = performance.now();
      const base = Date.parse(`${first}T00:00:00Z`);
      for (let i = 0; i < ids.length; i += 1) {
        const date = new Date(base + (i % 30) * 86_400_000).toISOString().slice(0, 10);
        const time = `${String(8 + (i % 10)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`;
        const res = await window.infinity.reminder.create({ noteId: ids[i]!, blockId: null, title: `Reminder ${i}`, zoneId: 'Asia/Dhaka', date, time, recurrence: null, followup: null });
        if (!res.ok) throw new Error(`reminder ${i}: ${res.error.message}`);
      }
      return performance.now() - started;
    },
    [noteIds, firstDate] as const,
  );
}

/** Time from each key press to the frame after the editor's input event. */
async function typingLatency(page: Page, text: string): Promise<number[]> {
  await page.evaluate(() => {
    const el = document.querySelector('#tabpanel .ProseMirror')!;
    const samples: number[] = [];
    let pressed = 0;
    el.addEventListener('keydown', () => (pressed = performance.now()), { capture: true });
    el.addEventListener('input', () => {
      const from = pressed;
      requestAnimationFrame(() => samples.push(performance.now() - from));
    });
    (window as unknown as { keySamples: number[] }).keySamples = samples;
  });
  await page.keyboard.type(text);
  await expect.poll(() => page.evaluate(() => (window as unknown as { keySamples: number[] }).keySamples.length)).toBe(text.length);
  return page.evaluate(() => (window as unknown as { keySamples: number[] }).keySamples);
}

/** Every image inside the window's viewport has been decoded (and at least one is in view). */
function visibleImagesLoaded(imgs: Element[]): boolean {
  const inView = imgs.filter((i) => {
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  });
  return inView.length > 0 && inView.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0);
}

async function memory(app: ElectronApplication): Promise<{ totalMb: number; renderers: number }> {
  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })));
  return { totalMb: Math.round(metrics.reduce((s, m) => s + m.kb, 0) / 1024), renderers: metrics.filter((m) => m.type === 'Tab').length };
}

test('10,000 notes, 100 projects and 1,000 reminders: cold start, search p95, Reminders page and a due burst (INF-PERF-01..03)', async () => {
  test.setTimeout(600_000);
  const env = reminderEnv({ notifications: true });
  const { page, noteIds } = await startWithLargeNotebook(env);
  const createMs = await createReminders(page, noteIds.slice(0, REMINDERS), '2026-10-09');

  const search = await searchTimes(page, (h.one<{ id: string }>('SELECT id FROM projects LIMIT 1'))!.id);
  const listStarted = performance.now();
  await railGo(page, 'Reminders');
  await activate(page.getByRole('tab', { name: /^Upcoming/ }));
  await expect(reminderRowsOnPage(page).first()).toBeVisible();
  const remindersPageMs = Math.round(performance.now() - listStarted);
  const upcomingRows = await reminderRowsOnPage(page).count();

  const starts = await coldStarts(3, env);
  // Palette: typing to rendered results, the debounce included.
  const palette: number[] = [];
  for (const query of ['budget', 'বাংলা', 'design review']) {
    await starts.page.keyboard.press('Control+K');
    const box = dialogByName(starts.page, 'Command palette').getByRole('combobox', { name: 'Type a command or search notes' });
    const started = performance.now();
    await box.fill(query);
    await expect(dialogByName(starts.page, 'Command palette').getByRole('listbox', { name: 'Results' }).locator('.option-result').first()).toBeVisible();
    palette.push(performance.now() - started);
    await starts.page.keyboard.press('Escape');
  }

  // Two days pass at once: every reminder due by then (9 October and the morning of the 10th) is due in one tick.
  const tickStarted = performance.now();
  await advance(starts.app, 2 * DAY);
  const burstMs = Math.round(performance.now() - tickStarted);
  const shown = await shownNotifications(starts.app);

  record('large-notebook', {
    notes: NOTES,
    projects: PROJECTS,
    reminders: REMINDERS,
    reminderCreateMsPerItem: round(createMs / REMINDERS),
    searchIpcMs: summary(search),
    paletteToResultsMs: summary(palette),
    upcoming: { ms: remindersPageMs, rows: upcomingRows },
    coldStartLaunchMs: starts.launchMs,
    coldStartProcessMs: starts.processMs,
    dueBurst: { tickMs: burstMs, notifications: shown.map((n) => n.title) },
  });
  expect(p95(search)).toBeLessThan(300);
  expect(Math.max(...starts.processMs)).toBeLessThan(3000);
  // No alert storm: the reminders due in one tick arrive as one summary notification.
  expect(shown).toHaveLength(1);
});

test('packaged cold start and search with 10,000 notes, 100 projects and 1,000 reminders (INF-PERF-02, INF-PERF-03) @packaged', async () => {
  test.setTimeout(600_000);
  const { page, noteIds } = await startWithLargeNotebook({});
  await createReminders(page, noteIds.slice(0, REMINDERS), '2027-03-01');
  const search = await searchTimes(page, (h.one<{ id: string }>('SELECT id FROM projects LIMIT 1'))!.id);
  const starts = await coldStarts(3, {});
  record('packaged-large-notebook', { notes: NOTES, reminders: REMINDERS, searchIpcMs: summary(search), coldStartLaunchMs: starts.launchMs, coldStartProcessMs: starts.processMs });
  expect(p95(search)).toBeLessThan(300);
  expect(Math.max(...starts.processMs)).toBeLessThan(3000);
});

test('image-heavy and very large notes stay responsive; inactive tabs hold no editor (INF-PERF-04, F-03-2)', async () => {
  test.setTimeout(600_000);
  const { app, page } = await h.start();
  const images = [];
  for (let i = 0; i < 24; i += 1) images.push(await importImage(page, makeNoisePng(800, 600, i + 1), `photo-${i}.png`));
  const imageNote = await createNote(page, COMMON, 'Photos');
  await saveDoc(page, imageNote, {
    type: 'doc',
    content: images.flatMap((img, i) => [
      { type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: `Photo ${i}` }] },
      { type: 'image', attrs: { attachmentId: img.id, width: img.width, height: img.height } },
    ]),
  });
  const largeNote = await createNote(page, COMMON, 'Large');
  await saveDoc(page, largeNote, {
    type: 'doc',
    content: Array.from({ length: 20_000 }, (_, i) => ({ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: `Line ${i} of a long note with ordinary words` }] })),
  });
  const others: string[] = [];
  for (let i = 0; i < 8; i += 1) others.push(await createNote(page, COMMON, `Tab ${i}`));
  await reloadUi(page);
  const before = await memory(app);

  let started = performance.now();
  await openFromTree(page, imageNote);
  await expect(page.locator('#tabpanel img')).toHaveCount(24);
  // Images load lazily: the note is usable once the images in view are decoded.
  await expect.poll(() => page.locator('#tabpanel img').evaluateAll(visibleImagesLoaded)).toBe(true);
  const imageOpenMs = Math.round(performance.now() - started);
  started = performance.now();
  await focusEditorEnd(page);
  await expect.poll(() => page.locator('#tabpanel img').evaluateAll(visibleImagesLoaded)).toBe(true);
  const imageScrollToEndMs = Math.round(performance.now() - started);
  const imageTyping = await typingLatency(page, 'typing below twenty four photos');
  await waitSaved(page);

  started = performance.now();
  await openFromTree(page, largeNote);
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  const largeOpenMs = Math.round(performance.now() - started);
  await focusEditorEnd(page);
  const largeTyping = await typingLatency(page, 'typing at the end of 20,000 lines');
  await waitSaved(page);

  for (const id of others) await openFromTree(page, id);
  await expect(page.locator('html')).toHaveAttribute('data-live-editors', '1');
  await expect(page.locator('#tabpanel .ProseMirror')).toHaveCount(1);
  await expect(page.locator('img')).toHaveCount(0);
  const tenTabs = await memory(app);

  record('editor-responsiveness', {
    imageNote: { images: 24, size: '800x600 noise PNG', openMs: imageOpenMs, jumpToEndMs: imageScrollToEndMs, keyToFrameMs: summary(imageTyping) },
    largeNote: { paragraphs: 20_000, openMs: largeOpenMs, keyToFrameMs: summary(largeTyping) },
    memoryMb: { beforeTabs: before.totalMb, tenTabsOneLive: tenTabs.totalMb, renderers: tenTabs.renderers },
  });
  expect(p95(imageTyping)).toBeLessThan(100);
  expect(p95(largeTyping)).toBeLessThan(100);
});

test('a 256K-character unbroken Bangla run pastes and reopens responsively, byte-exact (F-03-1)', async () => {
  test.setTimeout(300_000);
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Long run');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);
  await page.keyboard.insertText('SAFE');
  await waitSaved(page);
  const run = 'ক'.repeat(256 * 1024);
  await seedClipboardHtml(app, `<p>${run}</p>`, run);
  let started = performance.now();
  await paste(page);
  await expect(editor(page).locator('p.long-run')).toHaveCount(1);
  await editor(page).evaluate(() => 1);
  const pasteMs = Math.round(performance.now() - started);
  await waitSaved(page);
  // Byte-exact: only the paragraph boundary the paste may or may not create can differ.
  expect(h.one<{ t: string }>('SELECT plain_text AS t FROM notes WHERE id = ?', id)!.t.replace('\n', '')).toBe(`SAFE${run}`);

  await reloadUi(page);
  started = performance.now();
  await openFromTree(page, id);
  await expect(editor(page).locator('p.long-run')).toHaveCount(1);
  await editor(page).evaluate(() => 1);
  const reopenMs = Math.round(performance.now() - started);
  record('long-bangla-run', { chars: run.length, pasteResponsiveMs: pasteMs, reopenResponsiveMs: reopenMs });
  expect(pasteMs).toBeLessThan(1000);
  expect(reopenMs).toBeLessThan(1000);
});

test('ten stickies and the widget opened and closed three times leave no windows, renderers or listeners behind (INF-PERF-05)', async () => {
  test.setTimeout(600_000);
  const { app, page } = await h.start();
  const ids: string[] = [];
  for (let i = 0; i < 10; i += 1) ids.push(await createNote(page, COMMON, `Sticky ${i}`));
  const baseline = await listenerCounts(app);
  const baseMemory = await memory(app);
  const cycles: Array<{ openMs: number; totalMbOpen: number; renderersOpen: number }> = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const started = performance.now();
    await page.evaluate((list) => Promise.all(list.map((noteId) => window.infinity.sticky.float({ noteId }))), ids);
    for (const id of ids) await stickyPage(app, id);
    await page.evaluate(() => window.infinity.widget.show());
    await widgetPage(app);
    const openMs = Math.round(performance.now() - started);
    expect(await stickyNoteIds(app)).toEqual([...ids].sort());
    const open = await memory(app);
    cycles.push({ openMs, totalMbOpen: open.totalMb, renderersOpen: open.renderers });

    await page.evaluate((list) => Promise.all(list.map((noteId) => window.infinity.sticky.hide({ noteId }))), ids);
    await page.evaluate(() => window.infinity.widget.hide());
    await expect.poll(() => stickyNoteIds(app)).toEqual([]);
    await expect.poll(() => listenerCounts(app)).toEqual(baseline);
    await expect.poll(async () => (await memory(app)).renderers).toBe(baseMemory.renderers);
  }
  const after = await memory(app);
  record('window-cleanup', { stickies: 10, widget: true, cycles, baseline, baseMb: baseMemory.totalMb, afterMb: after.totalMb });
  expect(after.renderers).toBe(baseMemory.renderers);
});
