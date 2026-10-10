import type { PptxSourceModel } from '@pptx-glimpse/document';
import { relativeTarget, relsPartOf, resolveTarget } from '../../../shared/documents/opc-paths';
import { notesBodyId, PRESENTATIONML, plainParagraphs, plainText, readShapeText, writeShapeText, XmlPartError, type XmlTools } from './pptx-xml';

/**
 * Speaker notes (F5, D-150). @pptx-glimpse/document keeps notes slides as raw parts, so the editor reads their body
 * placeholder itself and writes notes into the package: into the slide's notes slide, or into a new notes slide (and a
 * notes master with its own theme, when the presentation has none yet) linked the way PowerPoint links them.
 */

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CONTENT_TYPES = '[Content_Types].xml';
const PRESENTATION = 'ppt/presentation.xml';
const TYPE = { notesSlide: `${REL}/notesSlide`, notesMaster: `${REL}/notesMaster`, slide: `${REL}/slide`, theme: `${REL}/theme` } as const;
const MEDIA = {
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
} as const;
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NOTES_NAMESPACES = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:p="${PRESENTATIONML}"`;
const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const NOTES_BODY =
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
const NEW_NOTES_SLIDE = `${XML_DECLARATION}<p:notes ${NOTES_NAMESPACES}><p:cSld><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>${NOTES_BODY}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
const NEW_NOTES_MASTER = `${XML_DECLARATION}<p:notesMaster ${NOTES_NAMESPACES}><p:cSld><p:spTree>${GROUP}${NOTES_BODY.replace(
  '<p:spPr/>',
  '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>',
)}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The notes slide part of a slide in the model, or null when it has none. */
function notesPartOf(model: PptxSourceModel, slidePart: string): string | null {
  const rels = model.packageGraph.relationships.find((r) => r.sourcePartPath === slidePart);
  const rel = rels?.relationships.find((r) => r.type === TYPE.notesSlide && r.targetMode !== 'External');
  return rel ? resolveTarget(slidePart, rel.target) : null;
}

/** The speaker notes of every slide that has some, by slide part, read from the model's raw parts. */
export function readAllNotes(model: PptxSourceModel, tools: XmlTools): Map<string, string> {
  const raw = new Map((model.packageGraph.rawParts ?? []).map((p) => [p.partPath as string, p]));
  const out = new Map<string, string>();
  for (const slide of model.slides) {
    const part = notesPartOf(model, slide.partPath);
    const stored = part ? raw.get(part) : undefined;
    if (!stored || stored.kind !== 'binary') continue;
    try {
      const xml = decoder.decode(stored.bytes);
      const id = notesBodyId(xml, tools);
      if (id) out.set(slide.partPath, plainText(readShapeText(xml, id, tools)));
    } catch (err) {
      // A notes slide the parser cannot read shows as empty; writing notes for it is refused below.
      if (!(err instanceof XmlPartError)) throw err;
    }
  }
  return out;
}

type Parts = Record<string, Uint8Array>;

class PackageEdit {
  readonly changes = new Map<string, Uint8Array | null>();
  constructor(
    private readonly parts: Parts,
    private readonly tools: XmlTools,
  ) {}

  has(part: string): boolean {
    return this.changes.has(part) ? this.changes.get(part) !== null : part in this.parts;
  }

  text(part: string): string | null {
    const bytes = this.changes.has(part) ? this.changes.get(part) : this.parts[part];
    return bytes ? decoder.decode(bytes) : null;
  }

  bytes(part: string): Uint8Array | undefined {
    return this.changes.get(part) ?? this.parts[part];
  }

  put(part: string, text: string) {
    this.changes.set(part, encoder.encode(text));
  }

  /** A part name in `folder` like `prefix<n>.xml` with the next free number. */
  freeName(folder: string, prefix: string): string {
    const taken = new Set([...Object.keys(this.parts), ...this.changes.keys()]);
    let n = 1;
    while (taken.has(`${folder}/${prefix}${n}.xml`)) n += 1;
    return `${folder}/${prefix}${n}.xml`;
  }

  /** The relationships of a part (type and resolved target). */
  relationships(part: string): Array<{ id: string; type: string; target: string }> {
    const xml = this.text(relsPartOf(part));
    if (xml === null) return [];
    return Array.from(this.tools.parse(xml).getElementsByTagNameNS(PACKAGE_RELS, 'Relationship'))
      .filter((r) => r.getAttribute('TargetMode') !== 'External')
      .map((r) => ({ id: r.getAttribute('Id') ?? '', type: r.getAttribute('Type') ?? '', target: resolveTarget(part, r.getAttribute('Target') ?? '') }));
  }

  /** Adds a relationship from `part` to `target`; its new ID. */
  relate(part: string, type: string, target: string): string {
    const relsPart = relsPartOf(part);
    const doc = this.tools.parse(this.text(relsPart) ?? `<Relationships xmlns="${PACKAGE_RELS}"/>`);
    const root = doc.documentElement;
    const ids = new Set(Array.from(root.getElementsByTagNameNS(PACKAGE_RELS, 'Relationship')).map((r) => r.getAttribute('Id')));
    let n = 1;
    while (ids.has(`rId${n}`)) n += 1;
    const rel = doc.createElementNS(PACKAGE_RELS, 'Relationship');
    rel.setAttribute('Id', `rId${n}`);
    rel.setAttribute('Type', type);
    rel.setAttribute('Target', relativeTarget(part, target));
    root.appendChild(rel);
    this.put(relsPart, XML_DECLARATION + this.tools.serialize(root));
    return `rId${n}`;
  }

  declare(part: string, contentType: string) {
    const doc = this.tools.parse(this.text(CONTENT_TYPES) ?? '');
    const override = doc.createElementNS(CONTENT_TYPES_NS, 'Override');
    override.setAttribute('PartName', `/${part}`);
    override.setAttribute('ContentType', contentType);
    doc.documentElement.appendChild(override);
    this.put(CONTENT_TYPES, XML_DECLARATION + this.tools.serialize(doc.documentElement));
  }
}

/** The presentation's notes master, made (with a copy of the slide master's theme) when there is none. */
function ensureNotesMaster(edit: PackageEdit, tools: XmlTools): string {
  const existing = edit.relationships(PRESENTATION).find((r) => r.type === TYPE.notesMaster);
  if (existing && edit.has(existing.target)) return existing.target;
  const slideMaster = edit.relationships(PRESENTATION).find((r) => r.type.endsWith('/slideMaster'));
  const theme = slideMaster ? edit.relationships(slideMaster.target).find((r) => r.type === TYPE.theme) : undefined;
  const themeBytes = theme ? edit.bytes(theme.target) : undefined;
  if (!themeBytes) throw new XmlPartError('the presentation has no theme to give its notes');

  const master = edit.freeName('ppt/notesMasters', 'notesMaster');
  const masterTheme = edit.freeName('ppt/theme', 'theme');
  edit.changes.set(masterTheme, themeBytes);
  edit.declare(masterTheme, MEDIA.theme);
  edit.put(master, NEW_NOTES_MASTER);
  edit.declare(master, MEDIA.notesMaster);
  edit.relate(master, TYPE.theme, masterTheme);
  const id = edit.relate(PRESENTATION, TYPE.notesMaster, master);

  const presentationXml = edit.text(PRESENTATION);
  if (presentationXml === null) throw new XmlPartError('no presentation part');
  const doc = tools.parse(presentationXml);
  const list = doc.createElementNS(PRESENTATIONML, 'p:notesMasterIdLst');
  const entry = doc.createElementNS(PRESENTATIONML, 'p:notesMasterId');
  entry.setAttributeNS(REL, 'r:id', id);
  list.appendChild(entry);
  // ECMA-376 CT_Presentation: the notes master list follows the slide master list.
  const masters = doc.documentElement.getElementsByTagNameNS(PRESENTATIONML, 'sldMasterIdLst')[0];
  doc.documentElement.insertBefore(list, masters ? masters.nextSibling : doc.documentElement.firstChild);
  const declaration = /^\s*<\?xml[^>]*\?>\r?\n?/.exec(presentationXml)?.[0] ?? '';
  edit.put(PRESENTATION, declaration + tools.serialize(doc.documentElement));
  return master;
}

/**
 * The part changes that give a slide these speaker notes (D-150): its notes slide's body placeholder gets one paragraph
 * per line, formatted like its first run; a slide without notes gets a new notes slide.
 */
export function writeSlideNotes(parts: Parts, slidePart: string, text: string, tools: XmlTools): Map<string, Uint8Array | null> {
  const edit = new PackageEdit(parts, tools);
  let notesPart = edit.relationships(slidePart).find((r) => r.type === TYPE.notesSlide)?.target;
  if (!notesPart || !edit.has(notesPart)) {
    const master = ensureNotesMaster(edit, tools);
    notesPart = edit.freeName('ppt/notesSlides', 'notesSlide');
    edit.put(notesPart, NEW_NOTES_SLIDE);
    edit.declare(notesPart, MEDIA.notesSlide);
    edit.relate(notesPart, TYPE.notesMaster, master);
    edit.relate(notesPart, TYPE.slide, slidePart);
    edit.relate(slidePart, TYPE.notesSlide, notesPart);
  }
  const xml = edit.text(notesPart) ?? '';
  const id = notesBodyId(xml, tools);
  if (!id) throw new XmlPartError('the notes slide has no notes placeholder');
  const hasParagraph = readShapeText(xml, id, tools).length > 0;
  edit.put(notesPart, writeShapeText(xml, id, plainParagraphs(text, hasParagraph), tools));
  return edit.changes;
}
