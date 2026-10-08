import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Result } from '../../src/shared/contracts/envelope';

/**
 * Seeding goes through the real bridge (window.infinity), never straight into the database. The UI picks up
 * bridge mutations through tree:changed; call `reloadUi` after a seeding batch to get a deterministic, fully
 * loaded renderer (session tabs persist in the database, so the tab strip is restored).
 */

export interface Loc {
  projectId: string | null;
  folderId: string | null;
}

export const COMMON: Loc = { projectId: null, folderId: null };

function unwrap<T>(res: Result<T>, what: string): T {
  if (!res.ok) throw new Error(`${what} failed: ${res.error.code} ${res.error.message}`);
  return res.data;
}

export async function createProject(page: Page, name: string): Promise<string> {
  const r = await page.evaluate((n) => window.infinity.project.create({ name: n }), name);
  return unwrap(r, 'project.create').project.id;
}

export async function createFolder(page: Page, parent: { projectId: string | null; parentId: string | null }, name: string): Promise<string> {
  const r = await page.evaluate(([l, n]) => window.infinity.folder.create({ location: l as { projectId: string | null; parentId: string | null }, name: n as string }), [parent, name] as const);
  return unwrap(r, 'folder.create').folder.id;
}

export async function createNote(page: Page, location: Loc, title: string, opts: { sticky?: boolean; format?: 'rich' | 'plain' } = {}): Promise<string> {
  const r = await page.evaluate(
    ([l, t, s, f]) => window.infinity.note.create({ location: l as Loc, sticky: s as boolean, title: t as string, format: f as 'rich' | 'plain' }),
    [location, title, opts.sticky ?? false, opts.format ?? 'rich'] as const,
  );
  return unwrap(r, 'note.create').note.id;
}

export async function trashNote(page: Page, noteId: string): Promise<void> {
  unwrap(await page.evaluate((id) => window.infinity.note.trash({ noteId: id }), noteId), 'note.trash');
}
export async function trashFolder(page: Page, folderId: string): Promise<void> {
  unwrap(await page.evaluate((id) => window.infinity.folder.trash({ folderId: id }), folderId), 'folder.trash');
}
export async function trashProject(page: Page, projectId: string): Promise<void> {
  unwrap(await page.evaluate((id) => window.infinity.project.trash({ projectId: id }), projectId), 'project.trash');
}

export async function pin(page: Page, noteId: string, pinned = true): Promise<void> {
  unwrap(await page.evaluate(([id, p]) => window.infinity.note.setPinned({ noteId: id as string, pinned: p as boolean }), [noteId, pinned] as const), 'note.setPinned');
}

export async function favorite(page: Page, kind: 'project' | 'folder' | 'note', id: string, on = true): Promise<void> {
  unwrap(await page.evaluate(([k, i, f]) => window.infinity.item.setFavorite({ kind: k as 'note', id: i as string, favorite: f as boolean }), [kind, id, on] as const), 'item.setFavorite');
}

/** note:open + lease:acquire + note:save + lease:release, as a separate view so the open UI never holds the lease. */
export async function saveDoc(page: Page, noteId: string, doc: { type: 'doc'; content?: unknown[] }, plainText?: string): Promise<number> {
  const viewId = randomUUID();
  const requestId = randomUUID();
  const r = await page.evaluate(
    async ([id, view, req, body, plain]) => {
      const bridge = window.infinity;
      const opened = await bridge.note.open({ noteId: id as string });
      if (!opened.ok) return opened;
      const lease = await bridge.lease.acquire({ noteId: id as string, viewId: view as string });
      if (!lease.ok) return lease;
      if (!lease.data.granted) return { ok: false as const, error: { code: 'LEASE_REQUIRED', message: 'lease held elsewhere' } };
      const saved = await bridge.note.save({
        noteId: id as string,
        viewId: view as string,
        leaseToken: lease.data.leaseToken,
        baseRevision: opened.data.revision,
        requestId: req as string,
        // A plain-text note stores the text itself (saveText passes it).
        ...(opened.data.format === 'plain' ? { format: 'plain' as const, content: plain as string } : { format: 'rich' as const, content: body as { type: 'doc' } }),
      });
      await bridge.lease.release({ noteId: id as string, viewId: view as string, leaseToken: lease.data.leaseToken });
      return saved;
    },
    [noteId, viewId, requestId, doc, plainText ?? ''] as const,
  );
  return unwrap(r as Result<{ revision: number }>, 'saveDoc').revision;
}

/** Saves text as one paragraph per line (see saveDoc). */
export function saveText(page: Page, noteId: string, text: string): Promise<number> {
  const content = text.split('\n').map((line) => (line === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: line }] }));
  return saveDoc(page, noteId, { type: 'doc', content }, text);
}

/** Imports image bytes through the real bridge (attachment:importBytes) and returns the attachment. */
export async function importImage(page: Page, png: Buffer, originalName = 'seed.png'): Promise<{ id: string; width: number | null; height: number | null }> {
  const r = await page.evaluate(
    async ([b64, name]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      return window.infinity.attachment.importBytes({ kind: 'image', originalName: name as string, bytes });
    },
    [png.toString('base64'), originalName] as const,
  );
  return unwrap(r, 'attachment.importBytes').attachment;
}

/** Reloads the renderer and waits for the shell to be ready again (fresh listeners, fresh stores). */
export async function reloadUi(page: Page): Promise<void> {
  await page.reload();
  await page.waitForSelector('#app-shell[data-ready="true"], [role="alert"]', { timeout: 30_000 });
}

export interface Notebook {
  alpha: string;
  beta: string;
  l1: string;
  l2: string;
  l3: string;
  c1: string;
  planA: string;
  planB: string;
  pinned: string;
  sticky: string;
  common: string;
  deep: string;
}

/** Synthetic notebook for the visual specs: 2 projects, nested folders, 6 notes, 1 pinned, 1 sticky. */
export async function seedNotebook(page: Page): Promise<Notebook> {
  const alpha = await createProject(page, 'Alpha');
  const beta = await createProject(page, 'Beta');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'Specs');
  const l2 = await createFolder(page, { projectId: alpha, parentId: l1 }, 'Drafts');
  const l3 = await createFolder(page, { projectId: alpha, parentId: l2 }, 'Archive');
  const c1 = await createFolder(page, { projectId: null, parentId: null }, 'Inbox');
  const planA = await createNote(page, { projectId: alpha, folderId: l1 }, 'Launch plan');
  const planB = await createNote(page, { projectId: beta, folderId: null }, 'Budget plan');
  const pinned = await createNote(page, { projectId: alpha, folderId: null }, 'Weekly review');
  const sticky = await createNote(page, { projectId: null, folderId: c1 }, 'Call Maya', { sticky: true });
  const common = await createNote(page, COMMON, 'Reading list');
  const deep = await createNote(page, { projectId: alpha, folderId: l3 }, 'Old meeting notes');
  await saveText(page, planA, 'Goals\nShip the shell, tree and tabs.\nThen the editor.');
  await saveText(page, pinned, 'Check progress against the plan.');
  await pin(page, pinned);
  return { alpha, beta, l1, l2, l3, c1, planA, planB, pinned, sticky, common, deep };
}
