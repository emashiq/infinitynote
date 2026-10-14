import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { aiNotice } from '../../src/shared/ai/engines';
import { AI_MESSAGES } from '../../src/shared/ai/limits';
import { installFakeAiTools, type FakeAiRun } from '../support/fake-ai-tools';
import { editor, selectText, waitSaved } from './editor-ui';
import { useApp } from './harness';
import { detailsPanel, withPanel } from './reminder-ui';
import { COMMON, createNote, reloadUi, saveDoc } from './seed';
import { stickyPage } from './sticky-ui';
import { openByPalette, railGo } from './ui';

/**
 * AI actions on a selected part (F4, D-190..D-193) with the fake `claude` and `codex` as the only tools the app can
 * find (INFINITY_NOTES_TEST_AI_PATH): never a real AI service. Runs in WSL under Xvfb and on CI, never on the Windows
 * desktop.
 */
const h = useApp({ failOnMainErrors: true, settings: { 'ai.enabled': true } });

const P1 = '0c0c0c0c-0000-4000-8000-000000000001';
const PASSWORD = 'correct horse battery';
const thread = (page: Page) => detailsPanel(page).locator('.comment-thread.is-ai');
const askDialog = (page: Page) => page.getByRole('dialog', { name: 'Ask AI' });

/** Starts the app with fresh fake tools; returns their run log. */
async function startWithFakeTools(): Promise<{ app: ElectronApplication; page: Page; runs: () => FakeAiRun[] }> {
  const tools = installFakeAiTools(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-e2e-ai-')));
  const { app, page } = await h.start({ INFINITY_NOTES_TEST_AI_PATH: tools.dir, FAKE_AI_LOG: tools.log });
  await withPanel(app, page);
  return { app, page, runs: tools.runs };
}

async function openPlan(page: Page): Promise<string> {
  const note = await createNote(page, COMMON, 'Plan');
  await saveDoc(page, note, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: P1 }, content: [{ type: 'text', text: 'The budget is due on Friday' }] }] });
  await reloadUi(page);
  await openByPalette(page, 'Plan');
  return note;
}

test('Ctrl+Shift+I asks Claude Code about the selection: notice, anchored thread, a follow-up that resumes, Insert below', async () => {
  const { page, runs } = await startWithFakeTools();
  const note = await openPlan(page);
  await selectText(page, 'budget');
  await page.keyboard.press('Control+Shift+I');
  await expect(askDialog(page).getByRole('note')).toHaveText(aiNotice('claude-code'));
  await askDialog(page).getByRole('button', { name: 'Summarize' }).click();
  await expect(askDialog(page)).toHaveCount(0);

  await expect(thread(page).locator('.ai-message.is-assistant .ai-body')).toContainText('Fake Claude answer (new session)');
  await expect(editor(page).locator('.ai-anchor')).toHaveText('budget');
  await waitSaved(page);
  const [row] = h.all<{ id: string; kind: string; quote: string }>("SELECT id, kind, quote FROM comment_threads WHERE target_id = ?", note);
  expect(row).toMatchObject({ kind: 'ai', quote: 'budget' });
  expect(runs()[0]!.args).toEqual(expect.arrayContaining(['--restricted', '--strict-mcp-config']));
  // The working folder is the app's own under its settings folder, never the shared temp directory (D-195).
  expect(path.basename(path.dirname(runs()[0]!.cwd))).toBe('ai-work');
  expect(fs.existsSync(path.join(h.userData, 'ai-work'))).toBe(true);
  expect(runs()[0]!.prompt).toContain('<selection>\nbudget\n</selection>');
  expect(h.setting('ai.acknowledged')).toMatchObject({ value: ['claude-code'] });

  const session = (JSON.parse(h.one<{ meta: string }>("SELECT meta FROM comments WHERE role = 'assistant'")!.meta) as { sessionId: string }).sessionId;
  await thread(page).getByRole('textbox', { name: 'Follow-up question' }).fill('And the deadline?');
  await thread(page).getByRole('button', { name: 'Ask' }).click();
  await expect(thread(page).locator('.ai-message.is-assistant')).toHaveCount(2);
  await expect(thread(page).locator('.ai-message.is-assistant .ai-body').last()).toContainText(`resumed ${session}`);
  expect(runs()[1]!.args.slice(-2)).toEqual(['--resume', session]);
  expect(runs()[1]!.prompt).toBe('And the deadline?');

  await thread(page).getByRole('button', { name: 'Insert below' }).click();
  await expect(editor(page).locator('ul li').first()).toHaveText('First point');
  // A second action needs no notice any more.
  await selectText(page, 'Friday');
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Ask AI' }).click();
  await expect(askDialog(page).getByRole('note')).toHaveCount(0);
  await askDialog(page).getByRole('button', { name: 'Cancel' }).click();
});

test('the Codex engine answers a free question asked from the note menu', async () => {
  const { page, runs } = await startWithFakeTools();
  await page.evaluate(() => window.infinity.settings.set({ key: 'ai.engine', value: 'codex' }));
  await openPlan(page);
  await selectText(page, 'due on Friday');
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Ask AI…' }).click();
  await expect(askDialog(page).getByText('Runs on OpenAI Codex (headless).')).toBeVisible();
  await askDialog(page).getByRole('textbox', { name: /Question/ }).fill('Which day exactly?');
  await page.keyboard.press('Control+Enter');
  await expect(thread(page).locator('.ai-message .ai-body').first()).toHaveText('Which day exactly?');
  await expect(thread(page).locator('.ai-message.is-assistant .ai-body')).toContainText('Fake Codex answer (new thread)');
  await expect(thread(page).locator('.ai-speaker')).toHaveText(['You', 'Codex']);
  expect(runs()[0]!.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=read-only', '-s', 'read-only', '-']);
  await detailsPanel(page).getByRole('radio', { name: /AI \(1\)/ }).check();
  await expect(thread(page)).toHaveCount(1);
});

test('a locked note is never sent, even while it is unlocked', async () => {
  const { page, runs } = await startWithFakeTools();
  const note = await openPlan(page);
  await page.evaluate(
    async ([id, password]) => {
      await window.infinity.lock.set({ noteId: id, password, hello: false, acknowledged: true });
      await window.infinity.lock.unlock({ noteId: id, password });
    },
    [note, PASSWORD] as const,
  );
  await reloadUi(page);
  await openByPalette(page, 'Plan');
  await selectText(page, 'budget');
  await page.keyboard.press('Control+Shift+I');
  await askDialog(page).getByRole('button', { name: 'Explain' }).click();
  await expect(askDialog(page).getByRole('alert')).toHaveText(AI_MESSAGES.locked);
  expect(runs()).toEqual([]);
  expect(h.all("SELECT id FROM comment_threads WHERE kind = 'ai'")).toEqual([]);
});

test('a sticky asks AI about its own text and puts the answer below it', async () => {
  const { app, page, runs } = await startWithFakeTools();
  const note = await createNote(page, COMMON, 'Errands', { sticky: true });
  await saveDoc(page, note, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: P1 }, content: [{ type: 'text', text: 'Renew the budget plan' }] }] });
  await page.evaluate((id) => window.infinity.sticky.float({ noteId: id }), note);
  const sticky = await stickyPage(app, note);
  await selectText(sticky, 'budget plan');
  await sticky.keyboard.press('Control+Shift+I');
  const ask = sticky.getByRole('dialog', { name: 'Ask AI' });
  await expect(ask.getByRole('note')).toHaveText(aiNotice('claude-code'));
  await ask.getByRole('button', { name: 'Analyze' }).click();
  const shown = sticky.getByRole('dialog', { name: 'AI' });
  await expect(shown.locator('.ai-message.is-assistant .ai-body')).toContainText('Fake Claude answer (new session)');
  expect(runs()[0]!.prompt).toContain('<selection>\nbudget plan\n</selection>');
  await shown.getByRole('button', { name: 'Insert below' }).click();
  await expect(shown).toHaveCount(0);
  await expect(editor(sticky).locator('ul li').first()).toHaveText('First point');
  await expect.poll(() => h.all("SELECT target_id FROM comment_threads WHERE kind = 'ai'")).toEqual([{ target_id: note }]);
});

test('Settings → AI: the switch, the engine and Test with the tool’s version', async () => {
  const { page } = await startWithFakeTools();
  await railGo(page, 'Settings');
  const section = page.getByRole('region', { name: 'AI', exact: true });
  await expect(section.getByRole('switch', { name: 'AI actions' })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByText('Found on PATH (claude)')).toBeVisible();
  await section.getByRole('button', { name: 'Test Claude Code (headless)' }).click();
  await expect(section.getByRole('status')).toHaveText('Claude Code 2.1.293 (Claude Code)');
  await section.getByRole('combobox', { name: 'Engine' }).selectOption('codex');
  await section.getByRole('button', { name: 'Test OpenAI Codex (headless)' }).click();
  await expect(section.getByRole('status')).toHaveText('Codex codex-cli 0.162.1');
  await section.getByRole('switch', { name: 'AI actions' }).click();
  await expect.poll(() => (h.setting('ai.enabled') as { value: boolean }).value).toBe(false);
});
