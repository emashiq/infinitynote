import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppFlushedRequest, AppFlushRequestEvent, ShellOpenExternalRequest } from '../../src/shared/contracts/app';
import { AttachmentDto, AttachmentImportBytesRequest, AttachmentImportDialogResponse } from '../../src/shared/contracts/attachments';
import { CHANNEL_SCHEMAS } from '../../src/shared/contracts/channels';
import {
  ConflictDetails,
  DraftsResolveRequest,
  DraftSummary,
  NoteContentResponse,
  NoteConvertRequest,
  VersionsListRequest,
  VersionSummary,
} from '../../src/shared/contracts/notes';
import { SETTINGS, SettingsSetRequest } from '../../src/shared/contracts/settings';

const op = () => ({ noteId: randomUUID(), viewId: randomUUID(), baseRevision: 3, requestId: randomUUID() });

describe('Phase 03 contracts (plan section 6.1)', () => {
  it('conversion to plain text must be confirmed; to rich text needs nothing', () => {
    expect(NoteConvertRequest.safeParse({ ...op(), targetFormat: 'plain', confirmLossy: true }).success).toBe(true);
    expect(NoteConvertRequest.safeParse({ ...op(), targetFormat: 'plain' }).success).toBe(false);
    expect(NoteConvertRequest.safeParse({ ...op(), targetFormat: 'rich' }).success).toBe(true);
    expect(NoteConvertRequest.safeParse({ ...op(), targetFormat: 'rich', extra: 1 }).success).toBe(false);
    expect(NoteConvertRequest.safeParse({ ...op(), baseRevision: -1, targetFormat: 'rich' }).success).toBe(false);
  });

  it('content responses carry the format, content and the saved version', () => {
    const base = { noteId: randomUUID(), revision: 2, versionId: null, updatedAt: 5 };
    expect(NoteContentResponse.safeParse({ ...base, format: 'plain', content: 'x' }).success).toBe(true);
    expect(NoteContentResponse.safeParse({ ...base, format: 'rich', content: { type: 'doc' }, versionId: randomUUID() }).success).toBe(true);
    expect(NoteContentResponse.safeParse({ ...base, format: 'rich' }).success).toBe(false);
  });

  it('conflict details: draftId is optional because content operations keep no draft', () => {
    expect(ConflictDetails.safeParse({ currentRevision: 4, reason: 'stale' }).success).toBe(true);
    expect(ConflictDetails.safeParse({ currentRevision: 4, reason: 'trashed', draftId: randomUUID() }).success).toBe(true);
    expect(ConflictDetails.safeParse({ currentRevision: 4, reason: 'other' }).success).toBe(false);
  });

  it('versions and drafts', () => {
    expect(VersionsListRequest.safeParse({ noteId: randomUUID() }).success).toBe(true);
    expect(VersionsListRequest.safeParse({ noteId: randomUUID(), limit: 200 }).success).toBe(true);
    expect(VersionsListRequest.safeParse({ noteId: randomUUID(), limit: 201 }).success).toBe(false);
    const version = { id: randomUUID(), revision: 1, format: 'rich', reason: 'auto', createdAt: 1, preview: 'p', attachmentCount: 0 };
    expect(VersionSummary.safeParse(version).success).toBe(true);
    expect(VersionSummary.safeParse({ ...version, preview: 'x'.repeat(201) }).success).toBe(false);
    // Drafts kept before live sync (D-103) may still carry the old lease_lost reason.
    const draft = { id: randomUUID(), reason: 'lease_lost', baseRevision: 0, format: 'plain', title: null, createdAt: 1, plainText: 't', truncated: false };
    expect(DraftSummary.safeParse(draft).success).toBe(true);
    expect(DraftSummary.safeParse({ ...draft, plainText: 'x'.repeat(20_001) }).success).toBe(false);
    expect(DraftsResolveRequest.safeParse({ action: 'restore', ...op(), draftId: randomUUID() }).success).toBe(true);
    expect(DraftsResolveRequest.safeParse({ action: 'dismiss', noteId: randomUUID(), draftId: randomUUID() }).success).toBe(true);
    expect(DraftsResolveRequest.safeParse({ action: 'dismiss', ...op(), draftId: randomUUID() }).success).toBe(false);
  });

  it('attachments: bytes must be a non-empty Uint8Array', () => {
    expect(AttachmentImportBytesRequest.safeParse({ kind: 'image', bytes: new Uint8Array([1, 2]) }).success).toBe(true);
    expect(AttachmentImportBytesRequest.safeParse({ kind: 'document', originalName: 'a.pdf', bytes: Buffer.from('x') }).success).toBe(true);
    for (const bytes of [new Uint8Array(), [1, 2], 'AAE=', new ArrayBuffer(2), null]) {
      expect(AttachmentImportBytesRequest.safeParse({ kind: 'image', bytes }).success).toBe(false);
    }
    const dto = { id: randomUUID(), kind: 'image', mime: 'image/png', sizeBytes: 10, originalName: null, width: 1, height: 1 };
    expect(AttachmentDto.safeParse(dto).success).toBe(true);
    expect(AttachmentDto.safeParse({ ...dto, width: 0 }).success).toBe(false);
    expect(
      AttachmentImportDialogResponse.safeParse({ canceled: false, imported: Array.from({ length: 21 }, () => dto), rejected: [] }).success,
    ).toBe(false);
  });

  it('app flush and shell', () => {
    const flushId = randomUUID();
    expect(AppFlushRequestEvent.safeParse({ flushId, reason: 'close' }).success).toBe(true);
    expect(AppFlushRequestEvent.safeParse({ flushId, reason: 'quit' }).success).toBe(true);
    expect(AppFlushRequestEvent.safeParse({ flushId }).success).toBe(false);
    expect(AppFlushRequestEvent.safeParse({ flushId, reason: 'hide' }).success).toBe(false);
    expect(AppFlushedRequest.safeParse({ flushId, saved: true }).success).toBe(true);
    expect(AppFlushedRequest.safeParse({ flushId }).success).toBe(false);
    expect(AppFlushedRequest.safeParse({ flushId, saved: true, extra: 1 }).success).toBe(false);
    expect(ShellOpenExternalRequest.safeParse({ url: 'https://example.com' }).success).toBe(true);
    expect(ShellOpenExternalRequest.safeParse({ url: 'x'.repeat(2049) }).success).toBe(false);
  });

  it('note:create takes an optional format', () => {
    const req = CHANNEL_SCHEMAS['note:create'].request;
    const location = { projectId: null, folderId: null };
    expect(req.safeParse({ location, sticky: false, format: 'plain' }).success).toBe(true);
    expect(req.safeParse({ location, sticky: false }).success).toBe(true);
    expect(req.safeParse({ location, sticky: false, format: 'html' }).success).toBe(false);
  });

  it('attachment limit settings: public, defaults 20 and 50 MB, ranges 1-100 and 1-200', () => {
    expect(SETTINGS['attachments.imageMaxMb']).toMatchObject({ default: 20, public: true });
    expect(SETTINGS['attachments.documentMaxMb']).toMatchObject({ default: 50, public: true });
    expect(SettingsSetRequest.safeParse({ key: 'attachments.imageMaxMb', value: 100 }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'attachments.imageMaxMb', value: 101 }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'attachments.documentMaxMb', value: 200 }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'attachments.documentMaxMb', value: 0 }).success).toBe(false);
    expect(SettingsSetRequest.safeParse({ key: 'attachments.documentMaxMb', value: 1.5 }).success).toBe(false);
  });
});
