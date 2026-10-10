// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentViewerProps } from '../../../src/renderer/documents/viewer-registry';
import type { DocumentReadWorkbookResponseType } from '../../../src/shared/contracts/documents';
import { createFakeBridge } from './support/fake-bridge';
import { setupDom } from './support/dom';

// The real grid needs a canvas; the stub shows what the tab gives the viewer (D-141), and the E2E spec runs the grid.
const viewer = vi.hoisted(() => ({ props: null as DocumentViewerProps | null }));
vi.mock('../../../src/renderer/documents/spreadsheet/SpreadsheetViewer', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: DocumentViewerProps) => {
      viewer.props = props;
      return createElement('div', { className: 'stub-viewer', 'data-readonly': String(props.readOnly), 'data-source': props.sourceUrl });
    },
  };
});

const dom = setupDom();
afterEach(() => {
  vi.unstubAllGlobals();
  viewer.props = null;
});

const WORKBOOK: DocumentReadWorkbookResponseType = {
  workbook: {
    activeSheet: 0,
    styles: [],
    sheets: [
      {
        name: 'Sheet1',
        hidden: false,
        tabColor: null,
        rowCount: 1,
        colCount: 1,
        cells: [{ r: 0, c: 0, v: 1 }],
        merges: [],
        colWidths: [],
        rowHeights: [],
        hiddenRows: [],
        hiddenCols: [],
        frozen: { rows: 0, cols: 0 },
        filter: null,
      },
    ],
  },
  simplified: [],
  csv: null,
};

/** A spreadsheet saved twice, so it has two earlier versions. */
async function openSpreadsheet() {
  const fake = createFakeBridge();
  const doc = fake.addDocument({ projectId: null, folderId: null, title: 'Budget', kind: 'xlsx', storage: 'managed', sizeBytes: 4096 });
  doc.workbook = WORKBOOK;
  const { el } = await dom.mount(fake);
  for (let i = 0; i < 2; i += 1) await fake.bridge.document.saveWorkbook({ documentId: doc.id, baseRevision: doc.revision, workbook: WORKBOOK.workbook });
  await dom.click(el.querySelector(`[id="tree-document:${doc.id}"]`));
  await dom.settle(10);
  return { fake, doc, el, view: () => el.querySelector('.document-view')! };
}

const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('document versions (D-141)', () => {
  it('lists versions newest first with revision, reason and size', async () => {
    const { view } = await openSpreadsheet();
    await dom.click(button(view(), 'Versions'));
    await dom.settle();
    const rows = [...view().querySelectorAll('.document-versions .version-row')].map((r) => r.querySelector('.version-meta')!.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Revision 1 · ');
    expect(rows[0]).toContain('Replaced by a save · ');
    expect(rows[1]).toMatch(/^Revision 0 · /);
  });

  it('opens a version read-only from its own bytes, reads its workbook, and goes back to the current one', async () => {
    const { fake, doc, view } = await openSpreadsheet();
    expect(viewer.props?.readOnly).toBe(false);
    await dom.click(button(view(), 'Versions'));
    await dom.settle();
    const version = doc.versions[1]!;
    await dom.click(button(view().querySelectorAll('.document-versions .version-row')[1]!, 'Open'));
    await dom.settle();
    expect(view().querySelector('.document-version-banner')?.textContent).toContain('Revision 0 from');
    expect(viewer.props?.readOnly).toBe(true);
    expect(viewer.props?.sourceUrl).toBe(`infinity-document://${doc.id}/?version=${version.id}`);
    await act(async () => void (await viewer.props!.host.readWorkbook()));
    expect(fake.callsTo('document:readWorkbook').at(-1)?.req).toEqual({ documentId: doc.id, versionId: version.id });
    await dom.click(button(view(), 'Back to the current version'));
    expect(viewer.props?.readOnly).toBe(false);
    expect(view().querySelector('.document-version-banner')).toBeNull();
  });

  it('saves edits before opening a version, and stays when they cannot be saved', async () => {
    const { view } = await openSpreadsheet();
    const flush = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    act(() => viewer.props!.host.setUnsaved(flush));
    await dom.click(button(view(), 'Versions'));
    await dom.settle();
    await dom.click(button(view().querySelector('.document-versions .version-row')!, 'Open'));
    await dom.settle();
    expect(viewer.props?.readOnly).toBe(false);
    await dom.click(button(view().querySelector('.document-versions .version-row')!, 'Open'));
    await dom.settle();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(viewer.props?.readOnly).toBe(true);
  });

  it('restores a version as the next revision and mounts the viewer on it', async () => {
    const { fake, doc, view } = await openSpreadsheet();
    await dom.click(button(view(), 'Versions'));
    await dom.settle();
    const before = viewer.props;
    await dom.click(button(view().querySelectorAll('.document-versions .version-row')[1]!, 'Restore'));
    await dom.settle();
    expect(fake.callsTo('document:restoreVersion').at(-1)?.req).toMatchObject({ documentId: doc.id, versionId: doc.versions[2]!.id, baseRevision: 2 });
    expect(doc.revision).toBe(3);
    expect(viewer.props).not.toBe(before);
    expect(document.body.textContent).toContain('Restored revision 0.');
    // The list is read again: the replaced revision 2 is now the newest version.
    expect(view().querySelector('.document-versions .version-meta')?.textContent).toMatch(/^Revision 2 · .*Replaced by a restore/);
  });

  it('saves a version as a new document and opens it, and exports a copy of the saved bytes or of the version shown', async () => {
    const { fake, doc, el, view } = await openSpreadsheet();
    await dom.click(button(view(), 'Export a copy…'));
    await dom.settle();
    expect(fake.data.documentHandoffs).toEqual([`export:${doc.id}:current`]);
    await dom.click(button(view(), 'Versions'));
    await dom.settle();
    await dom.click(button(view().querySelector('.document-versions .version-row')!, 'Open'));
    await dom.settle();
    await dom.click(button(view(), 'Export a copy…'));
    await dom.settle();
    expect(fake.data.documentHandoffs.at(-1)).toBe(`export:${doc.id}:${doc.versions[0]!.id}`);
    await dom.click(button(view(), 'Save as copy'));
    await dom.settle(10);
    const copy = fake.data.documents.find((d) => d.title === 'Budget (revision 1)');
    expect(copy).toBeDefined();
    expect(el.querySelector(`[id="tab-document:${copy!.id}"]`)?.getAttribute('aria-selected')).toBe('true');
  });

  it('saves a workbook through the tab with its revision, and reports a conflict', async () => {
    const { fake, doc } = await openSpreadsheet();
    let ok = false;
    await act(async () => void (ok = await viewer.props!.host.saveWorkbook(WORKBOOK.workbook, null)));
    expect(ok).toBe(true);
    expect(fake.callsTo('document:saveWorkbook').at(-1)?.req).toMatchObject({ documentId: doc.id, baseRevision: 2 });
    doc.revision = 9;
    await act(async () => void (ok = await viewer.props!.host.saveWorkbook(WORKBOOK.workbook, null)));
    expect(ok).toBe(false);
    expect(document.querySelector('.document-conflict')?.textContent).toContain('Reload');
  });
});
