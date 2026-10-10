import { describe, expect, it } from 'vitest';
import { DocumentController } from '../../../src/renderer/documents/document-controller';
import { DOCUMENT_LOCK_MESSAGES } from '../../../src/shared/contracts/locks';
import { createFakeBridge } from './support/fake-bridge';

describe('edits of a save refused because the document locked again (D-185, B1)', () => {
  it('are kept, saved again on request, or discarded; other failures keep nothing', async () => {
    const fake = createFakeBridge();
    const d = fake.addDocument({ projectId: null, folderId: null, title: 'Plan', kind: 'docx', storage: 'managed', sizeBytes: 10 });
    const controller = new DocumentController(fake.bridge, d.id);
    await controller.open();
    const edits = new Uint8Array([1, 2, 3]);

    fake.failNext('document:save', { code: 'FORBIDDEN', message: DOCUMENT_LOCK_MESSAGES.lockedDuringSave, details: { locked: true } });
    expect(await controller.save(edits)).toMatchObject({ ok: false, message: DOCUMENT_LOCK_MESSAGES.lockedDuringSave });
    expect(controller.store.getState().heldEdits).toBe(true);

    const loads = controller.store.getState().loads;
    expect(await controller.saveHeld()).toEqual({ ok: true });
    expect(controller.store.getState()).toMatchObject({ heldEdits: false, loads: loads + 1 });
    expect(d.saves.at(-1)).toEqual(edits);

    fake.failNext('document:save', { code: 'FORBIDDEN', message: DOCUMENT_LOCK_MESSAGES.lockedDuringSave, details: { locked: true } });
    await controller.save(edits);
    controller.discardHeld();
    expect(controller.store.getState().heldEdits).toBe(false);
    expect(await controller.saveHeld()).toEqual({ ok: true });
    expect(d.saves).toHaveLength(1);

    fake.failNext('document:save', { code: 'INTERNAL', message: 'The document could not be saved.' });
    await controller.save(edits);
    expect(controller.store.getState().heldEdits).toBe(false);
  });
});
