import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { chooseNoteMenu } from './editor-ui';

/** Types like a user, key by key (`delay` ms between keys). */
export async function typeText(page: Page, text: string, delay = 0): Promise<void> {
  await page.keyboard.type(text, { delay });
}

/** The underlined phrases (D-091). */
export function candidates(page: Page): Locator {
  return page.locator('.nlp-candidate');
}

/** Waits until a phrase with this text is underlined (detection runs 1000 ms after the last edit). */
export async function waitForCandidate(page: Page, text: string): Promise<void> {
  await expect(candidates(page).filter({ hasText: text })).toHaveCount(1, { timeout: 5_000 });
}

export function suggestionBar(page: Page): Locator {
  return page.getByRole('group', { name: 'Reminder suggestion' });
}

/** The confirmation card (D-093). */
export function card(page: Page): Locator {
  return page.getByRole('dialog', { name: /^(Create|Update) reminder$/ });
}

/** Note menu → "Create reminder from text", with the keyboard (D-050, D-102). */
export async function openCreateFromText(page: Page): Promise<void> {
  await chooseNoteMenu(page, 'Create reminder from text');
}

export interface SourceRow {
  reminder_id: string;
  note_id: string;
  block_id: string | null;
  source_text: string;
  span_start: number | null;
  span_end: number | null;
  span_ordinal: number;
  reference_instant_utc: number;
  reference_zone: string;
  parser_version: number;
  origin: 'suggestion' | 'selection';
  source_state: string;
}

/** Raw `reminder_sources` rows from main (a fresh task, F04-A2). */
export async function sourceRows(app: ElectronApplication): Promise<SourceRow[]> {
  return (await app.evaluate(() => globalThis.__infinityTest!.reminders())).sources as SourceRow[];
}

/** Raw `suggestion_dismissals` rows from main. */
export async function dismissalRows(app: ElectronApplication): Promise<Array<Record<string, unknown>>> {
  return (await app.evaluate(() => globalThis.__infinityTest!.reminders())).dismissals as Array<Record<string, unknown>>;
}

/**
 * Waits until the editor's own selection is at the end of the document. ProseMirror reads keyboard selection moves
 * on the asynchronous selectionchange event, so in a long note Ctrl+End must settle before Enter.
 */
export async function waitForCursorAtEnd(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.getByRole('textbox', { name: 'Note text', exact: true }).evaluate((el) => {
        const { state } = (el as unknown as { editor: { state: { doc: { content: { size: number } }; selection: { from: number } } } }).editor;
        return state.doc.content.size - state.selection.from;
      }),
    )
    .toBe(1);
}
