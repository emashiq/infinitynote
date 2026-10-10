import { describe, expect, it } from 'vitest';
import { relativeTarget, relsPartOf, resolveTarget } from '../../src/shared/documents/opc-paths';
import { MAX_PRESENTATION_SLIDES } from '../../src/shared/documents/presentation';
import { DocumentTarget } from '../../src/shared/documents/targets';

describe('places to open a document at (D-132, D-152)', () => {
  it('accepts a page, a sheet and cell, a heading, a paragraph and a slide', () => {
    for (const target of [{ page: 2 }, { sheet: 'Budget', row: 0, col: 3 }, { heading: 'Intro' }, { paragraph: 0 }, { slide: 1 }, { slide: MAX_PRESENTATION_SLIDES }]) {
      expect(DocumentTarget.parse(target)).toEqual(target);
    }
  });

  it('refuses a slide outside the presentation limits and mixed places', () => {
    for (const target of [{ slide: 0 }, { slide: MAX_PRESENTATION_SLIDES + 1 }, { slide: 1.5 }, { slide: '2' }, { slide: 1, page: 1 }]) {
      expect(DocumentTarget.safeParse(target).success).toBe(false);
    }
  });
});

describe('Office package part names', () => {
  it('names relationship parts and resolves targets relative to their source or from the root', () => {
    expect(relsPartOf('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels');
    expect(relsPartOf('ppt/presentation.xml')).toBe('ppt/_rels/presentation.xml.rels');
    expect(resolveTarget('ppt/slides/slide1.xml', '../notesSlides/notesSlide1.xml')).toBe('ppt/notesSlides/notesSlide1.xml');
    expect(resolveTarget('ppt/presentation.xml', 'slides/./slide2.xml')).toBe('ppt/slides/slide2.xml');
    expect(resolveTarget('ppt/slides/slide1.xml', '/ppt/media/image1.png')).toBe('ppt/media/image1.png');
  });

  it('writes the relative target Office writes', () => {
    expect(relativeTarget('ppt/slides/slide3.xml', 'ppt/notesSlides/notesSlide3.xml')).toBe('../notesSlides/notesSlide3.xml');
    expect(relativeTarget('ppt/presentation.xml', 'ppt/notesMasters/notesMaster1.xml')).toBe('notesMasters/notesMaster1.xml');
    expect(relativeTarget('ppt/notesMasters/notesMaster1.xml', 'ppt/theme/theme2.xml')).toBe('../theme/theme2.xml');
    for (const [from, to] of [['ppt/slides/slide1.xml', 'ppt/media/a.png'], ['a/b/c.xml', 'x/y.xml']] as const) expect(resolveTarget(from, relativeTarget(from, to))).toBe(to);
  });
});
