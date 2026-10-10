// @vitest-environment jsdom
import { readPptx } from '@pptx-glimpse/document';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { findInSlides } from '../../../src/renderer/documents/pptx/pptx-find';
import { slideImage } from '../../../src/renderer/documents/pptx/pptx-image';
import { contentNotShown, slideShapes } from '../../../src/renderer/documents/pptx/pptx-model';
import { readAllNotes, writeSlideNotes } from '../../../src/renderer/documents/pptx/pptx-notes';
import { readPresentation, repack } from '../../../src/renderer/documents/pptx/pptx-package';
import { renderSlides } from '../../../src/renderer/documents/pptx/pptx-render';
import { EditRefused, PptxSession } from '../../../src/renderer/documents/pptx/pptx-session';
import { browserXml, readShapeText, setShapeBox, writeShapeText } from '../../../src/renderer/documents/pptx/pptx-xml';
import { documentFixture } from './support/fixtures';

const rich = () => documentFixture('sample-rich.pptx');
const small = () => documentFixture('sample.pptx');

function open(bytes: Uint8Array) {
  const read = readPresentation(bytes);
  if (!read.ok) throw new Error(read.reason);
  return new PptxSession(read.model, browserXml, renderSlides);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The parts whose bytes differ between two packages, with + for added and - for removed parts. */
function changedParts(before: Uint8Array, after: Uint8Array): string[] {
  const a = unzipSync(before);
  const b = unzipSync(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((name) => !a[name] || !b[name] || !sameBytes(a[name], b[name]))
    .map((name) => (!a[name] ? `+${name}` : !b[name] ? `-${name}` : name))
    .sort();
}

const slideXml = (bytes: Uint8Array, part: string) => strFromU8(unzipSync(bytes)[part]!);

describe('presentation packages (F5, D-150, D-153)', () => {
  it('reads the rich fixture and refuses what is out of bounds or carries macros', () => {
    expect(readPresentation(rich()).ok).toBe(true);
    expect(readPresentation(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, reason: 'notPresentation' });
    const parts = unzipSync(rich());
    const types = strFromU8(parts['[Content_Types].xml']!).replace('presentation.main+xml', 'presentation.macroEnabled.main+xml');
    expect(readPresentation(repack(parts, new Map([['[Content_Types].xml', strToU8(types)]])))).toEqual({ ok: false, reason: 'macros' });
    // A highly compressible entry over 1 MiB is a zip bomb shape, whatever its name.
    expect(readPresentation(zipSync({ ...parts, 'ppt/media/fill.bin': new Uint8Array(8 * 1024 * 1024) }))).toEqual({ ok: false, reason: 'notPresentation' });
  });

  it('lists the content it does not show', () => {
    const read = readPresentation(rich());
    expect(read.ok && contentNotShown(read.model)).toEqual(['transitions', 'charts (drawn simplified)']);
  });
});

describe('the OOXML layer (D-150)', () => {
  const slide1 = () => slideXml(rich(), 'ppt/slides/slide1.xml');

  it('reads a placeholder text with its runs and formatting', () => {
    expect(readShapeText(slide1(), '3', browserXml)).toEqual([
      {
        items: [
          { kind: 'run', text: 'Revenue grew ', format: {} },
          { kind: 'run', text: 'strongly', format: { bold: true } },
          { kind: 'run', text: ' this quarter', format: {} },
        ],
      },
    ]);
  });

  it('writes edited text keeping run formatting, adding paragraphs and formatting a new run', () => {
    const xml = writeShapeText(
      slide1(),
      '3',
      [
        {
          source: 0,
          items: [
            { kind: 'run', text: 'Revenue grew ', source: { paragraph: 0, item: 0 }, format: {} },
            { kind: 'run', text: 'very strongly', source: { paragraph: 0, item: 1 }, format: {} },
          ],
        },
        { source: 0, items: [{ kind: 'run', text: 'Next year', source: null, format: { italic: true, sizePt: 20, color: 'C00000' } }] },
      ],
      browserXml,
    );
    const body = readShapeText(xml, '3', browserXml);
    expect(body).toEqual([
      {
        items: [
          { kind: 'run', text: 'Revenue grew ', format: {} },
          { kind: 'run', text: 'very strongly', format: { bold: true } },
        ],
      },
      // A new run is formatted like its paragraph's first run, then as the edit says.
      { items: [{ kind: 'run', text: 'Next year', format: { italic: true, sizePt: 20, color: 'C00000' } }] },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    // The rest of the slide is untouched: the title and the picture keep their XML.
    expect(xml).toContain('<a:t>Quarterly review</a:t>');
    expect(xml).toContain('<a:blip r:embed="rId2"/>');
  });

  it('gives a placeholder its own position', () => {
    const xml = setShapeBox(slide1(), '2', { offsetX: 100, offsetY: 200, width: 3000, height: 4000 }, browserXml);
    expect(xml).toContain('<p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="3000" cy="4000"/></a:xfrm></p:spPr>');
  });

  it('reads speaker notes and writes them into existing and new notes slides', () => {
    const read = readPresentation(rich());
    if (!read.ok) throw new Error();
    expect([...readAllNotes(read.model, browserXml)]).toEqual([
      ['ppt/slides/slide1.xml', 'Thank the team first'],
      ['ppt/slides/slide2.xml', 'Mention the timeline'],
    ]);
    const parts = unzipSync(rich());
    const edited = writeSlideNotes(parts, 'ppt/slides/slide1.xml', 'First line\nSecond line', browserXml);
    expect([...edited.keys()]).toEqual(['ppt/notesSlides/notesSlide1.xml']);
    const added = writeSlideNotes(parts, 'ppt/slides/slide3.xml', 'Closing note', browserXml);
    expect([...added.keys()].sort()).toEqual([
      '[Content_Types].xml',
      'ppt/notesSlides/_rels/notesSlide3.xml.rels',
      'ppt/notesSlides/notesSlide3.xml',
      'ppt/slides/_rels/slide3.xml.rels',
    ]);
    const model = readPptx(repack(parts, added));
    expect(readAllNotes(model, browserXml).get('ppt/slides/slide3.xml')).toBe('Closing note');
  });

  it('makes a notes master when a presentation has none', () => {
    const parts = unzipSync(small());
    const changes = writeSlideNotes(parts, 'ppt/slides/slide2.xml', 'Only notes', browserXml);
    expect([...changes.keys()].sort()).toEqual([
      '[Content_Types].xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      'ppt/notesMasters/notesMaster1.xml',
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
      'ppt/notesSlides/notesSlide1.xml',
      'ppt/presentation.xml',
      'ppt/slides/_rels/slide2.xml.rels',
      'ppt/theme/theme2.xml',
    ]);
    const presentation = strFromU8(changes.get('ppt/presentation.xml')!);
    expect(presentation).toMatch(/<\/p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId\d+"\/><\/p:notesMasterIdLst><p:sldIdLst>/);
    const model = readPptx(repack(parts, changes));
    expect(readAllNotes(model, browserXml).get('ppt/slides/slide2.xml')).toBe('Only notes');
  });
});

describe('the editing session (D-149)', () => {
  it('draws every slide as an SVG image', async () => {
    const session = open(rich());
    await vi_waitFor(() => session.state.slides.every((s) => s.image !== null));
    expect(session.state.slides[0]!.image).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    expect(decodeURIComponent(session.state.slides[0]!.image!)).toContain('Quarterly review');
  });

  it('an untouched save keeps every part; a text edit changes only its slide', () => {
    const original = rich();
    const session = open(original);
    expect(changedParts(original, session.bytes())).toEqual([]);
    const text = session.shapeText('3');
    session.setShapeText('3', [{ source: 0, items: [{ kind: 'run', text: `${(text[0]!.items[0] as { text: string }).text}fast`, source: { paragraph: 0, item: 0 }, format: {} }] }]);
    expect(session.state.dirty).toBe(true);
    expect(changedParts(original, session.bytes())).toEqual(['ppt/slides/slide1.xml']);
    session.undo();
    expect(session.state.dirty).toBe(false);
    expect(changedParts(original, session.bytes())).toEqual([]);
    session.redo();
    expect(slideXml(session.bytes(), 'ppt/slides/slide1.xml')).toContain('<a:t>Revenue grew fast</a:t>');
  });

  it('moves a placeholder and a picture, and only the slide changes', () => {
    const original = rich();
    const session = open(original);
    const [title, , picture] = slideShapes(session.state.model, 0);
    expect(title).toMatchObject({ id: '2', ownBox: false, text: true, placeholder: true });
    expect(picture).toMatchObject({ id: '4', ownBox: true, kind: 'image' });
    session.setShapeBox('2', { ...title!.box, offsetX: title!.box.offsetX + 95250 });
    session.setShapeBox('4', { ...picture!.box, width: picture!.box.width / 2 });
    expect(changedParts(original, session.bytes())).toEqual(['ppt/slides/slide1.xml']);
    const moved = slideShapes(session.state.model, 0);
    expect(moved[0]!.box.offsetX).toBe(title!.box.offsetX + 95250);
    expect(moved[0]!.ownBox).toBe(true);
    expect(moved[2]!.box.width).toBe(picture!.box.width / 2);
  });

  it('moves the same picture again (a drag, then nudges) and saves the last place', () => {
    const original = rich();
    const session = open(original);
    const box = () => slideShapes(session.state.model, 0)[2]!.box;
    const start = box();
    session.setShapeBox('4', { ...start, offsetX: start.offsetX - 1_143_000, offsetY: start.offsetY - 571_500 });
    session.setShapeBox('4', { ...box(), offsetX: box().offsetX - 95_250 });
    session.setShapeBox('4', { ...box(), width: box().width + 95_250 });
    expect(changedParts(original, session.bytes())).toEqual(['ppt/slides/slide1.xml']);
    const saved = slideShapes(open(session.bytes()).state.model, 0)[2]!.box;
    expect(saved).toEqual({ offsetX: start.offsetX - 1_238_250, offsetY: start.offsetY - 571_500, width: start.width + 95_250, height: start.height });
  });

  it('adds, duplicates, reorders and deletes slides; only slide-list parts and the slides involved change', () => {
    const original = rich();
    const session = open(original);
    session.duplicateSlide(0);
    expect(session.state.current).toBe(1);
    expect(session.state.slides.map((s) => s.notes)).toEqual(['Thank the team first', 'Thank the team first', 'Mention the timeline', '']);
    expect(changedParts(original, session.bytes())).toEqual([
      '+ppt/notesSlides/_rels/notesSlide3.xml.rels',
      '+ppt/notesSlides/notesSlide3.xml',
      '+ppt/slides/_rels/slide4.xml.rels',
      '+ppt/slides/slide4.xml',
      '[Content_Types].xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/presentation.xml',
    ]);
    session.moveSlide(1, 3);
    session.goTo(0);
    session.addSlide();
    expect(session.state.current).toBe(1);
    expect(session.state.slides).toHaveLength(5);
    session.deleteSlide(1);
    session.deleteSlide(3);
    expect(session.state.slides.map((s) => s.partPath)).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml']);
    // Back to the original slides in their order: the package is the original part for part.
    expect(changedParts(original, session.bytes())).toEqual([]);
  });

  it('keeps one slide and refuses changes the package cannot take', () => {
    const session = open(small());
    session.deleteSlide(0);
    expect(() => session.deleteSlide(0)).toThrow(EditRefused);
    expect(() => session.setShapeBox('99', { offsetX: 0, offsetY: 0, width: 1, height: 1 })).toThrow(EditRefused);
    expect(session.state.canUndo).toBe(true);
  });

  it('edits notes, inserts a text box and a picture, and formats a whole shape', () => {
    const original = rich();
    const session = open(original);
    session.goTo(2);
    session.setNotes(2, 'Wrap up');
    expect(session.state.slides[2]!.notes).toBe('Wrap up');
    const box = session.addTextBox('Hello');
    expect(box).toBe('3');
    expect(session.state.selection).toBe('3');
    // The new box's text is readable at once, for the editor that opens on it.
    expect(session.shapeText('3')).toEqual([{ items: [{ kind: 'run', text: 'Hello', format: {} }] }]);
    session.formatShape('3', { bold: true, color: '1F4E79' });
    expect(session.shapeText('3')).toEqual([{ items: [{ kind: 'run', text: 'Hello', format: { bold: true, color: '1F4E79' } }] }]);
    const png = unzipSync(original)['ppt/media/image1.png']!;
    const picture = session.addPicture(png, 2, 2);
    expect(picture).toBe('4');
    const changed = changedParts(original, session.bytes());
    expect(changed).toContain('ppt/slides/slide3.xml');
    expect(changed).not.toContain('ppt/slides/slide1.xml');
    expect(changed).not.toContain('ppt/slides/slide2.xml');
    expect(changed).not.toContain('ppt/notesSlides/notesSlide1.xml');
  });
});

describe('find and pictures', () => {
  it('finds text in drawings and notes with case and whole-word options', () => {
    const session = open(rich());
    const notes = session.state.slides.map((s) => s.notes);
    expect(findInSlides(session.state.model, notes, 'the', { caseSensitive: false, wholeWord: true })).toEqual([
      { slide: 0, shapeId: null, start: 6, length: 3 },
      { slide: 1, shapeId: null, start: 8, length: 3 },
    ]);
    expect(findInSlides(session.state.model, notes, 'quarter', { caseSensitive: false, wholeWord: true })).toEqual([{ slide: 0, shapeId: '3', start: 27, length: 7 }]);
    expect(findInSlides(session.state.model, notes, 'quarter', { caseSensitive: false, wholeWord: false })).toHaveLength(2);
    expect(findInSlides(session.state.model, notes, 'QUARTERLY', { caseSensitive: true, wholeWord: false })).toEqual([]);
  });

  it('reads the size of PNG and JPEG pictures and refuses other bytes', () => {
    const png = unzipSync(rich())['ppt/media/image1.png']!;
    expect(slideImage(png)).toEqual({ type: 'png', width: 2, height: 2 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 30, 0, 40, 1, 1, 0x11, 0]);
    expect(slideImage(jpeg)).toEqual({ type: 'jpeg', width: 40, height: 30 });
    expect(slideImage(strToU8('GIF89a'))).toBeNull();
    expect(slideImage(new Uint8Array(0))).toBeNull();
  });
});

async function vi_waitFor(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}
