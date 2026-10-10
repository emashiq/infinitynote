import fs from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { readPresentation } from '../../src/renderer/documents/pptx/pptx-package';
import { PptxSession } from '../../src/renderer/documents/pptx/pptx-session';
import type { XmlTools } from '../../src/renderer/documents/pptx/pptx-xml';
import { DOCUMENT_MESSAGES } from '../../src/shared/documents/messages';
import { fixtureBytes, rejection, setupDocuments } from './document-helpers';

/** The editor reads OOXML with the browser's XML parser; under Node the test hands it jsdom's (D-150). */
const window = new JSDOM('').window;
const xml: XmlTools = {
  parse: (text) => new window.DOMParser().parseFromString(text, 'application/xml'),
  serialize: (node) => new window.XMLSerializer().serializeToString(node),
};

/** An editing session as the viewer opens it; drawing is not under test here. */
function sessionOf(bytes: Uint8Array): PptxSession {
  const read = readPresentation(bytes);
  if (!read.ok) throw new Error(read.reason);
  return new PptxSession(read.model, xml, async () => new Map());
}

const parts = (bytes: Uint8Array) => unzipSync(bytes);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** Part names whose bytes differ, `+name` for added and `-name` for removed parts. */
function changed(before: Uint8Array, after: Uint8Array): string[] {
  const a = parts(before);
  const b = parts(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((name) => !a[name] || !b[name] || !same(a[name], b[name]))
    .map((name) => (!a[name] ? `+${name}` : !b[name] ? `-${name}` : name))
    .sort();
}

const storedBytes = async (s: Awaited<ReturnType<typeof setupDocuments>>['s'], id: string, versionId?: string) => new Uint8Array(fs.readFileSync((await s.documents.fileOf(id, versionId)).file));

describe('PowerPoint documents saved from the editor (F5, D-149, D-150)', () => {
  it('an edited text run changes only its slide; every other part keeps its bytes', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Review.pptx', fixtureBytes('sample-rich.pptx')), 'copy');
    const opened = await storedBytes(s, doc.id);
    const session = sessionOf(opened);
    session.setShapeText('3', [
      {
        source: 0,
        items: [
          { kind: 'run', text: 'Revenue grew ', source: { paragraph: 0, item: 0 }, format: {} },
          { kind: 'run', text: 'remarkably', source: { paragraph: 0, item: 1 }, format: {} },
          { kind: 'run', text: ' this quarter', source: { paragraph: 0, item: 2 }, format: {} },
        ],
      },
    ]);
    const saved = await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: session.bytes() });
    expect(saved.document.revision).toBe(1);
    const stored = await storedBytes(s, doc.id);
    expect(changed(opened, stored)).toEqual(['ppt/slides/slide1.xml']);
    expect(strFromU8(parts(stored)['ppt/slides/slide1.xml']!)).toContain('<a:rPr lang="en-US" b="1"/><a:t>remarkably</a:t>');
    // Reopened, the session shows the edit and an untouched save writes the same parts again.
    expect(changed(stored, sessionOf(stored).bytes())).toEqual([]);
  });

  it('slide list changes touch only the slide list, the content types and the slides and notes involved', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Review.pptx', fixtureBytes('sample-rich.pptx')), 'copy');
    const opened = await storedBytes(s, doc.id);
    const session = sessionOf(opened);
    session.duplicateSlide(1);
    session.moveSlide(2, 0);
    session.setShapeBox('2', { offsetX: 0, offsetY: 0, width: 4_572_000, height: 914_400 });
    session.setNotes(3, 'Last words');
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: session.bytes() });
    const stored = await storedBytes(s, doc.id);
    expect(changed(opened, stored)).toEqual([
      '+ppt/notesSlides/_rels/notesSlide3.xml.rels',
      '+ppt/notesSlides/_rels/notesSlide4.xml.rels',
      '+ppt/notesSlides/notesSlide3.xml',
      '+ppt/notesSlides/notesSlide4.xml',
      '+ppt/slides/_rels/slide4.xml.rels',
      '+ppt/slides/slide4.xml',
      '[Content_Types].xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/presentation.xml',
      'ppt/slides/_rels/slide3.xml.rels',
    ]);
    const reopened = sessionOf(stored);
    expect(reopened.state.slides.map((slide) => [slide.partPath, slide.notes])).toEqual([
      ['ppt/slides/slide4.xml', 'Mention the timeline'],
      ['ppt/slides/slide1.xml', 'Thank the team first'],
      ['ppt/slides/slide2.xml', 'Mention the timeline'],
      ['ppt/slides/slide3.xml', 'Last words'],
    ]);
    // The moved copy of slide 2 is the shape that was moved: its text box has its own new position.
    expect(strFromU8(parts(stored)['ppt/slides/slide4.xml']!)).toContain('<a:off x="0" y="0"/><a:ext cx="4572000" cy="914400"/>');
    // Search reads the slides in their new order with each one's notes.
    expect((await s.documents.open(doc.id)).document.revision).toBe(1);
    expect(s.search.query({ query: '"last words"' }).documents.map((r) => r.document.title)).toEqual(['Review']);
  });

  it('keeps the replaced revision as a version, reads it back, restores it, and searches the saved text and notes', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const doc = await importFile(original('Review.pptx', fixtureBytes('sample-rich.pptx')), 'copy');
    const first = await storedBytes(s, doc.id);
    const session = sessionOf(first);
    session.setNotes(0, 'Zephyrine timeline');
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: session.bytes() });
    expect(documentRow(doc.id)!.body_text).toContain('Zephyrine timeline');
    expect(s.search.query({ query: 'zephyrine' }).documents.map((r) => r.document.title)).toEqual(['Review']);

    const [version] = s.documents.versionsOf(doc.id).versions;
    expect(version).toMatchObject({ revision: 0, reason: 'save' });
    expect(sessionOf(await storedBytes(s, doc.id, version!.id)).state.slides[0]!.notes).toBe('Thank the team first');

    await s.documents.restoreVersion({ documentId: doc.id, versionId: version!.id, baseRevision: 1 });
    expect(changed(first, await storedBytes(s, doc.id))).toEqual([]);
    expect(s.search.query({ query: 'zephyrine' }).documents).toEqual([]);
  });

  it('notes on a presentation without a notes master make one that later slide changes keep', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Small.pptx', fixtureBytes('sample.pptx')), 'copy');
    const session = sessionOf(await storedBytes(s, doc.id));
    session.setNotes(1, 'Speaker notes');
    session.duplicateSlide(1);
    session.addSlide();
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: session.bytes() });
    const stored = parts(await storedBytes(s, doc.id));
    const presentation = strFromU8(stored['ppt/presentation.xml']!);
    expect(presentation).toMatch(/<p:notesMasterIdLst><p:notesMasterId r:id="rId\d+"\/><\/p:notesMasterIdLst>/);
    expect(presentation.match(/<p:sldId /g)).toHaveLength(4);
    expect(stored['ppt/notesMasters/notesMaster1.xml']).toBeDefined();
    expect(sessionOf(await storedBytes(s, doc.id)).state.slides.map((slide) => slide.notes)).toEqual(['', 'Speaker notes', 'Speaker notes', '']);
  });

  it('a linked presentation is saved back to its original in place', async () => {
    const { s, importFile, original } = await setupDocuments();
    const file = original('Linked.pptx', fixtureBytes('sample-rich.pptx'));
    const doc = await importFile(file, 'link');
    const opened = await s.documents.open(doc.id);
    const session = sessionOf(new Uint8Array(fs.readFileSync(file)));
    session.deleteSlide(2);
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: session.bytes(), expectedFile: { sizeBytes: opened.file!.sizeBytes!, modifiedAt: opened.file!.modifiedAt! } });
    expect(sessionOf(new Uint8Array(fs.readFileSync(file))).state.slides).toHaveLength(2);
  });

  it('refuses bytes that are not a presentation, or that carry macros, before anything is replaced (D-136, D-143)', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Review.pptx', fixtureBytes('sample-rich.pptx')), 'copy');
    expect(await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: new Uint8Array(fixtureBytes('sample.docx')) }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: DOCUMENT_MESSAGES.damaged('pptx'),
    });
    const package_ = parts(new Uint8Array(fixtureBytes('sample-rich.pptx')));
    const types = strFromU8(package_['[Content_Types].xml']!).replace('presentationml.presentation.main+xml', 'presentationml.presentation.macroEnabled.main+xml');
    const macro = zipSync({ ...package_, '[Content_Types].xml': strToU8(types) });
    expect(await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: macro }))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await s.documents.open(doc.id)).document.revision).toBe(0);
  });
});
