import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { IMPORT_MAX_PAYLOAD_BYTES, measureImport } from '../../src/main/ipc/handlers/attachment-handlers';
import { FlushCoordinator } from '../../src/main/services/flush-coordinator';
import { memoryLogger } from '../../src/main/services/logger';
import { textToDoc } from '../../src/shared/text/textarea-doc';
import { makePng } from '../support/png';
import { setupServices } from './hierarchy-helpers';
import { catalogueRouter } from './ipc-helpers';
import { randomIds } from './helpers';

const id = () => randomUUID();

async function setup() {
  const s = await setupServices();
  const opened: string[] = [];
  const flushSent: Array<{ webContentsId: number; flushId: string }> = [];
  const coordinator = new FlushCoordinator({ sendTo: (webContentsId, flushId) => flushSent.push({ webContentsId, flushId }), ids: randomIds(), logger: memoryLogger() });
  const app: AppHandlerDeps = {
    getInfo: () => {
      throw new Error('not used');
    },
    getCapabilities: () => {
      throw new Error('not used');
    },
    shell: {
      openPath: async () => '',
      openExternal: async (url) => {
        opened.push(url);
      },
    },
    dataDir: '/data',
    quit: () => {},
    flushed: (webContentsId, flushId) => coordinator.ack(webContentsId, flushId),
  };
  const r = catalogueRouter(s.services, app);
  /** A rich note with the lease held by window 1. */
  const editable = async (format: 'rich' | 'plain' = 'rich') => {
    const note = (await r.call('note:create', { location: { projectId: null, folderId: null }, sticky: false, format })).data.note;
    const viewId = id();
    const lease = (await r.call('lease:acquire', { noteId: note.id, viewId })).data;
    const op = (baseRevision: number) => ({ noteId: note.id, viewId, leaseToken: lease.leaseToken, baseRevision, requestId: id() });
    return { note, viewId, lease, op };
  };
  return { s, ...r, opened, coordinator, flushSent, editable };
}

describe('Phase 03 IPC handlers (D-052)', () => {
  it('every new channel rejects malformed requests without calling the service', async () => {
    const { call, s } = await setup();
    const spies = [
      vi.spyOn(s.leases, 'take'),
      vi.spyOn(s.formats, 'convert'),
      vi.spyOn(s.versions, 'list'),
      vi.spyOn(s.versions, 'restore'),
      vi.spyOn(s.drafts, 'list'),
      vi.spyOn(s.drafts, 'resolve'),
      vi.spyOn(s.attachments, 'importBytes'),
      vi.spyOn(s.attachments, 'importFromDialog'),
    ];
    const op = { noteId: id(), viewId: id(), leaseToken: id(), baseRevision: 0, requestId: id() };
    const bad: Array<[string, unknown]> = [
      ['lease:take', { noteId: id() }],
      ['lease:take', { noteId: id(), viewId: id(), extra: 1 }],
      ['note:convertFormat', { ...op, targetFormat: 'plain' }],
      ['note:convertFormat', { ...op, targetFormat: 'html' }],
      ['note:convertFormat', { ...op, targetFormat: 'rich', confirmLossy: false }],
      ['versions:list', { noteId: id(), limit: 0 }],
      ['versions:list', { noteId: id(), limit: 201 }],
      ['versions:restore', { ...op }],
      ['drafts:list', { noteId: 'x' }],
      ['drafts:resolve', { action: 'restore', noteId: id(), draftId: id() }],
      ['drafts:resolve', { action: 'delete', noteId: id(), draftId: id() }],
      ['drafts:resolve', { action: 'dismiss', noteId: id(), draftId: id(), extra: true }],
      ['attachment:importBytes', { kind: 'image', bytes: [137, 80, 78, 71] }],
      ['attachment:importBytes', { kind: 'image', bytes: 'iVBORw0KGgo=' }],
      ['attachment:importBytes', { kind: 'image', bytes: new Uint8Array() }],
      ['attachment:importBytes', { kind: 'video', bytes: new Uint8Array([1]) }],
      ['attachment:importBytes', { kind: 'image', bytes: new Uint8Array([1]), originalName: 'x'.repeat(256) }],
      ['attachment:importBytes', { kind: 'image', bytes: new Uint8Array([1]), path: 'C:/secret.png' }],
      ['attachment:importFromDialog', { kind: 'image', path: '/etc' }],
      ['shell:openExternal', { url: '' }],
      ['shell:openExternal', { url: 'https://example.com', extra: 1 }],
      ['app:flushed', { flushId: 'x' }],
      ['note:create', { location: { projectId: null, folderId: null }, sticky: false, format: 'markdown' }],
    ];
    for (const [channel, payload] of bad) {
      expect(await call(channel, payload), `${channel} ${String(JSON.stringify(payload))}`).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('note:create with format plain makes an empty plain note', async () => {
    const { call, s } = await setup();
    const note = (await call('note:create', { location: { projectId: null, folderId: null }, sticky: false, format: 'plain' })).data.note;
    expect(s.row('SELECT format, content_text, content_json FROM notes WHERE id = ?', note.id)).toEqual({ format: 'plain', content_text: '', content_json: null });
    expect(await call('note:open', { noteId: note.id })).toMatchObject({ ok: true, data: { format: 'plain', content: '' } });
  });

  it('lease:take, note:convertFormat, versions and drafts work through the router', async () => {
    const { call, editable, s } = await setup();
    const e = await editable('plain');
    expect(await call('note:save', { ...e.op(0), format: 'plain', content: 'line one' })).toMatchObject({ ok: true, data: { revision: 1 } });

    const toRich = await call('note:convertFormat', { ...e.op(1), targetFormat: 'rich' });
    expect(toRich).toMatchObject({ ok: true, data: { revision: 2, format: 'rich', versionId: expect.any(String) } });
    const toPlain = await call('note:convertFormat', { ...e.op(2), targetFormat: 'plain', confirmLossy: true });
    expect(toPlain).toMatchObject({ ok: true, data: { revision: 3, format: 'plain', content: 'line one' } });
    expect(await call('note:convertFormat', { ...e.op(1), targetFormat: 'rich' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { currentRevision: 3, reason: 'stale' } },
    });

    const versions = (await call('versions:list', { noteId: e.note.id })).data.versions;
    expect(versions.map((v: { reason: string }) => v.reason)).toEqual(['conversion', 'conversion']);
    const restored = await call('versions:restore', { ...e.op(3), versionId: toPlain.data.versionId });
    expect(restored).toMatchObject({ ok: true, data: { revision: 4, format: 'rich' } });

    // A stale save leaves a draft; list, then dismiss it through the router.
    const stale = await call('note:save', { ...e.op(0), format: 'rich', content: textToDoc('late') });
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT', details: { reason: 'stale' } } });
    const drafts = (await call('drafts:list', { noteId: e.note.id })).data.drafts;
    expect(drafts).toEqual([expect.objectContaining({ plainText: 'late', reason: 'conflict' })]);
    expect(await call('drafts:resolve', { action: 'dismiss', noteId: e.note.id, draftId: drafts[0].id })).toEqual({ ok: true, data: { resolved: true, content: null } });

    // Another window takes edit control; the holder gets the release request.
    const other = id();
    const taking = call('lease:take', { noteId: e.note.id, viewId: other }, 2);
    expect(s.releaseRequests).toEqual([{ holder: { viewId: e.viewId, webContentsId: 1 }, noteId: e.note.id }]);
    await call('lease:release', { noteId: e.note.id, viewId: e.viewId, leaseToken: e.lease.leaseToken });
    expect(await taking).toMatchObject({ ok: true, data: { leaseToken: expect.any(String) } });
    expect(s.leases.holderOf(e.note.id)).toBe(other);
    expect(s.revisions.map((x) => x.revision)).toEqual([1, 2, 3, 4]);
  });

  it('attachment:importBytes accepts a Uint8Array, measures binary size and enforces the ceiling', async () => {
    const { call, s } = await setup();
    const png = makePng(3, 2);
    const ok = await call('attachment:importBytes', { kind: 'image', originalName: 'p.png', bytes: new Uint8Array(png) });
    expect(ok).toMatchObject({ ok: true, data: { attachment: { kind: 'image', width: 3, height: 2, originalName: 'p.png' } } });

    expect(measureImport({ kind: 'image', bytes: new Uint8Array(1000) })).toBe(1000 + Buffer.byteLength('{"kind":"image","bytes":null}'));
    expect(IMPORT_MAX_PAYLOAD_BYTES).toBe(200 * 1024 * 1024 + 64 * 1024);
    const spy = vi.spyOn(s.attachments, 'importBytes');
    const tooBig = new Uint8Array(IMPORT_MAX_PAYLOAD_BYTES);
    expect(await call('attachment:importBytes', { kind: 'document', bytes: tooBig })).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
    // A payload JSON cannot encode is a validation failure, not a crash.
    expect(await call('attachment:importBytes', { kind: 'image', bytes: new Uint8Array([1]), originalName: 10n })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(spy).not.toHaveBeenCalled();
    // The service limit (20 MB default for images) is below the router ceiling.
    const overLimit = new Uint8Array(20 * 1024 * 1024 + 1);
    overLimit.set(png);
    expect(await call('attachment:importBytes', { kind: 'image', bytes: overLimit })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', message: 'This image is larger than 20 MB. Use a smaller image.' },
    });
  });

  it('attachment:importFromDialog passes the sender window to the dialog', async () => {
    const { call, s } = await setup();
    expect(await call('attachment:importFromDialog', { kind: 'document' }, 2)).toEqual({ ok: true, data: { canceled: true, imported: [], rejected: [] } });
    expect(s.dialogCalls).toEqual([{ webContentsId: 2, kind: 'document' }]);
  });

  it('shell:openExternal opens only http(s) addresses', async () => {
    const { call, opened } = await setup();
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'mailto:a@b.c', 'vbscript:x', '/relative', 'https://u:p@example.com/']) {
      expect(await call('shell:openExternal', { url }), url).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'This link cannot be opened' } });
    }
    expect(opened).toEqual([]);
    expect(await call('shell:openExternal', { url: 'https://example.com/docs' })).toEqual({ ok: true, data: { opened: true } });
    expect(opened).toEqual(['https://example.com/docs']);
  });

  it('app:flushed accepts only the window the flush was sent to', async () => {
    const { call, coordinator, flushSent } = await setup();
    expect(await call('app:flushed', { flushId: id() })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const pending = coordinator.flush([1]);
    const { flushId } = flushSent[0]!;
    expect(await call('app:flushed', { flushId }, 2)).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await call('app:flushed', { flushId }, 1)).toEqual({ ok: true, data: {} });
    expect(await pending).toEqual({ acked: [1], timedOut: [] });
  });

  it('new storage channels report storage-unavailable when the database failed to open', async () => {
    const none = catalogueRouter(null, {
      getInfo: () => {
        throw new Error('not used');
      },
      getCapabilities: () => {
        throw new Error('not used');
      },
      shell: { openPath: async () => '', openExternal: async () => {} },
      dataDir: '/data',
      quit: () => {},
      flushed: () => false,
    });
    const op ={ noteId: id(), viewId: id(), leaseToken: id(), baseRevision: 0, requestId: id() };
    const valid: Array<[string, unknown]> = [
      ['lease:take', { noteId: id(), viewId: id() }],
      ['note:convertFormat', { ...op, targetFormat: 'rich' }],
      ['versions:list', { noteId: id() }],
      ['versions:restore', { ...op, versionId: id() }],
      ['drafts:list', { noteId: id() }],
      ['drafts:resolve', { action: 'dismiss', noteId: id(), draftId: id() }],
      ['attachment:importBytes', { kind: 'image', bytes: new Uint8Array([1]) }],
      ['attachment:importFromDialog', { kind: 'image' }],
    ];
    for (const [channel, payload] of valid) {
      expect(await none.call(channel, payload), channel).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Storage is unavailable' } });
    }
    expect(await none.call('shell:openExternal', { url: 'https://example.com/' })).toEqual({ ok: true, data: { opened: true } });
  });
});
