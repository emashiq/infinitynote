import { relsPartOf, resolveTarget } from '../../../shared/documents/opc-paths';
import { decodeXmlEntities } from './entities';

const PRESENTATION = 'ppt/presentation.xml';
const PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels';
const SLIDE_TYPE = /\/relationships\/slide$/;
const NOTES_TYPE = /\/relationships\/notesSlide$/;

/** Reads an XML part of the package as text; null when it is missing or too large to read. */
export type PartReader = (part: string) => Promise<string | null>;

interface Relationship {
  id: string;
  type: string;
  target: string;
}

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(m[1]!, decodeXmlEntities(m[2] ?? m[3]!));
  return out;
}

function relationships(xml: string): Relationship[] {
  return [...xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)].flatMap((m) => {
    const attrs = attributes(m[1]!);
    const id = attrs.get('Id');
    const type = attrs.get('Type');
    const target = attrs.get('Target');
    return id && type && target && attrs.get('TargetMode') !== 'External' ? [{ id, type, target }] : [];
  });
}

/** The relationship IDs of the presentation's slide list, in its order (`p:sldIdLst`). */
function slideListIds(presentationXml: string): string[] {
  const list = /<(?:\w+:)?sldIdLst\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sldIdLst>/.exec(presentationXml)?.[1] ?? '';
  return [...list.matchAll(/<(?:\w+:)?sldId\b([^>]*)>/g)].flatMap((m) => {
    // The relationship ID is the namespaced `r:id`; the plain `id` is the slide's number.
    const id = [...attributes(m[1]!)].find(([name]) => name.endsWith(':id'))?.[1];
    return id ? [id] : [];
  });
}

/**
 * The parts of a presentation to read for search, in reading order (F5, D-152): each slide of the presentation's slide
 * list, then its speaker notes. Null when the slide list cannot be read, so the caller falls back to part numbers.
 */
export async function presentationReadingOrder(read: PartReader): Promise<string[] | null> {
  const [presentation, presentationRels] = await Promise.all([read(PRESENTATION), read(PRESENTATION_RELS)]);
  if (presentation === null || presentationRels === null) return null;
  const targets = new Map(relationships(presentationRels).filter((r) => SLIDE_TYPE.test(r.type)).map((r) => [r.id, resolveTarget(PRESENTATION, r.target)]));
  const slides = slideListIds(presentation).flatMap((id) => {
    const part = targets.get(id);
    return part ? [part] : [];
  });
  const out: string[] = [];
  for (const slide of slides) {
    out.push(slide);
    const rels = await read(relsPartOf(slide));
    const notes = rels === null ? undefined : relationships(rels).find((r) => NOTES_TYPE.test(r.type));
    if (notes) out.push(resolveTarget(slide, notes.target));
  }
  return out;
}
