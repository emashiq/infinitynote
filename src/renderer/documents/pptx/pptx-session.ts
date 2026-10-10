import {
  addEmptySlideFromLayout,
  addPicture,
  addTextBox,
  asEmu,
  deleteShape,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  updateShapeTransform,
  type PptxSourceModel,
  type SourceSlide,
} from '@pptx-glimpse/document';
import { createStore, type Store } from '../../state/store';
import { newestShapeId, slideNode, slideShapes, slideSize } from './pptx-model';
import { readAllNotes, writeSlideNotes } from './pptx-notes';
import { rewriteParts, settle, writePresentation } from './pptx-package';
import { readShapeText, setShapeBox, writeShapeText, type EditedParagraph, type RunFormat, type ShapeBox, type XmlTools } from './pptx-xml';

/** Draws slides of a model as SVG documents, by one-based slide number. */
export type SlideRenderer = (model: PptxSourceModel, slideNumbers: readonly number[]) => Promise<ReadonlyMap<number, string>>;

export interface SlideEntry {
  partPath: string;
  /** The slide drawn as an image URL (its last drawing while it is drawn again), or null until it is first drawn. */
  image: string | null;
  /** Speaker notes; empty when the slide has none. */
  notes: string;
}

export interface SessionState {
  model: PptxSourceModel;
  slides: readonly SlideEntry[];
  /** The slide shown (zero-based). */
  current: number;
  /** The selected drawing on the shown slide (its ID). */
  selection: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** The model differs from the one last saved (or opened). */
  dirty: boolean;
}

/** An operation the editor could not make; the model is unchanged. */
export class EditRefused extends Error {}

interface Snapshot {
  model: PptxSourceModel;
  current: number;
  selection: string | null;
}

interface Drawing {
  slide: SourceSlide;
  /** The slide part's bytes when they were the slide's content (no pending edits), else null. */
  bytes: Uint8Array | null;
  image: string;
}

const HISTORY_LIMIT = 100;
/** Slides drawn per pass, so a large deck does not hold the renderer for long. */
const RENDER_BATCH = 6;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** A slide part's bytes, when they are the slide's content: the model has no edits pending on top of them. */
function contentBytes(model: PptxSourceModel, part: string): Uint8Array | null {
  if (model.edits?.length) return null;
  const raw = model.packageGraph.rawParts?.find((p) => p.partPath === part);
  return raw?.kind === 'binary' ? raw.bytes : null;
}

/**
 * The editing session of one presentation (F5, D-149): the immutable source model of @pptx-glimpse/document, an
 * undo/redo history of models, slides drawn as SVG images, and the edits the editor offers. Library operations make
 * the shape, slide-list and insert changes; the OOXML layer makes text, notes and inherited-position changes on the
 * written parts and reads them back (D-150). Untouched parts keep their bytes through every edit and save.
 */
export class PptxSession {
  readonly store: Store<SessionState>;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private saved: PptxSourceModel;
  /** Drawn slides by part: valid for the same slide object, or for the same part bytes after a model is read back. */
  private drawn = new Map<string, Drawing>();
  private drawing = false;
  private disposed = false;

  constructor(
    model: PptxSourceModel,
    private readonly xml: XmlTools,
    private readonly render: SlideRenderer,
    private readonly onRenderError: (error: unknown) => void = () => {},
  ) {
    this.saved = model;
    this.store = createStore<SessionState>({ model, slides: this.entries(model), current: 0, selection: null, canUndo: false, canRedo: false, dirty: false });
    void this.drawPending();
  }

  get state(): SessionState {
    return this.store.getState();
  }

  dispose() {
    this.disposed = true;
  }

  goTo(index: number) {
    const current = Math.max(0, Math.min(this.state.slides.length - 1, index));
    if (current !== this.state.current) this.store.setState({ current, selection: null });
    void this.drawPending();
  }

  select(selection: string | null) {
    if (selection !== this.state.selection) this.store.setState({ selection });
  }

  // Shapes

  /** Moves or resizes a drawing on the shown slide. */
  setShapeBox(shapeId: string, box: ShapeBox) {
    this.edit((unsettled, at) => {
      const model = withoutTransformEdit(unsettled, slideNode(unsettled.slides[at.current]!, shapeId)?.handle);
      const shape = slideShapes(model, at.current).find((s) => s.id === shapeId);
      const node = slideNode(model.slides[at.current]!, shapeId);
      if (!shape || !node?.handle) throw new EditRefused('no such shape');
      const emu = { offsetX: asEmu(Math.round(box.offsetX)), offsetY: asEmu(Math.round(box.offsetY)), width: asEmu(Math.max(1, Math.round(box.width))), height: asEmu(Math.max(1, Math.round(box.height))) };
      if (shape.ownBox) return { model: updateShapeTransform(model, node.handle, emu) };
      const part = model.slides[at.current]!.partPath;
      return { model: this.rewritePart(model, part, (xml) => setShapeBox(xml, shapeId, emu, this.xml)) };
    });
  }

  deleteShape(shapeId: string) {
    this.edit((model, at) => {
      const node = slideNode(model.slides[at.current]!, shapeId);
      if (!node?.handle) throw new EditRefused('no such shape');
      return { model: deleteShape(model, node.handle), selection: null };
    });
  }

  /** The text of a drawing on the shown slide as it is now, for the text editor. */
  shapeText(shapeId: string) {
    const part = this.state.model.slides[this.state.current]!.partPath;
    return readShapeText(this.currentPartXml(part), shapeId, this.xml);
  }

  /** Replaces the text of a drawing on the shown slide (runs keep their formatting, D-150). */
  setShapeText(shapeId: string, paragraphs: readonly EditedParagraph[]) {
    this.edit((model, at) => ({ model: this.rewritePart(model, model.slides[at.current]!.partPath, (xml) => writeShapeText(xml, shapeId, paragraphs, this.xml)) }));
  }

  /** Sets character formatting on all the text of a drawing on the shown slide. */
  formatShape(shapeId: string, format: RunFormat) {
    this.edit((model, at) => ({
      model: this.rewritePart(model, model.slides[at.current]!.partPath, (xml) => {
        const paragraphs = readShapeText(xml, shapeId, this.xml).map((p, paragraph) => ({
          source: paragraph,
          items: p.items.map((item, index) => ({ kind: item.kind, text: item.kind === 'break' ? '' : item.text, source: { paragraph, item: index }, format: item.kind === 'run' ? format : {} })),
        }));
        return writeShapeText(xml, shapeId, paragraphs, this.xml);
      }),
    }));
  }

  /** Adds a text box in the middle of the shown slide and selects it; its ID. */
  addTextBox(text: string): string | null {
    return this.addOnSlide((model, slide) => {
      const size = slideSize(model);
      const width = Math.round(size.width * 0.4);
      const height = Math.round(size.height * 0.15);
      return addTextBox(model, slide.handle!, { offsetX: asEmu(Math.round((size.width - width) / 2)), offsetY: asEmu(Math.round((size.height - height) / 2)), width: asEmu(width), height: asEmu(height), text });
    });
  }

  /** Adds a picture in the middle of the shown slide, at most half the slide wide or high, and selects it; its ID. */
  addPicture(bytes: Uint8Array, pixelWidth: number, pixelHeight: number): string | null {
    return this.addOnSlide((model, slide) => {
      const size = slideSize(model);
      const scale = Math.min((size.width * 0.5) / pixelWidth, (size.height * 0.5) / pixelHeight);
      const width = Math.max(1, Math.round(pixelWidth * scale));
      const height = Math.max(1, Math.round(pixelHeight * scale));
      return addPicture(model, slide.handle!, { bytes, offsetX: asEmu(Math.round((size.width - width) / 2)), offsetY: asEmu(Math.round((size.height - height) / 2)), width: asEmu(width), height: asEmu(height) });
    });
  }

  // Slides

  /** Adds a slide with the shown slide's layout after it. */
  addSlide() {
    this.edit((model, at) => {
      const layoutPartPath = model.slides[at.current]!.layoutPartPath;
      const added = addEmptySlideFromLayout(model, { layoutPartPath });
      const slide = added.slides[added.slides.length - 1]!;
      return { model: moveSlide(added, slide.handle!, { toIndex: at.current + 1 }), current: at.current + 1, selection: null };
    });
  }

  duplicateSlide(index: number) {
    this.edit((model) => {
      // The library duplicates only slides without pending edits.
      const settled = settle(model);
      return { model: duplicateSlide(settled, settled.slides[index]!.handle!), current: index + 1, selection: null };
    });
  }

  /** Deletes a slide; the last one is kept, a presentation always shows one. */
  deleteSlide(index: number) {
    if (this.state.slides.length <= 1) throw new EditRefused('last slide');
    this.edit((model, at) => ({
      model: deleteSlide(model, model.slides[index]!.handle!),
      current: Math.min(index < at.current ? at.current - 1 : at.current, model.slides.length - 2),
      selection: null,
    }));
  }

  moveSlide(from: number, to: number) {
    const target = Math.max(0, Math.min(this.state.slides.length - 1, to));
    if (target === from) return;
    this.edit((model) => ({ model: moveSlide(model, model.slides[from]!.handle!, { toIndex: target }), current: target, selection: null }));
  }

  setNotes(index: number, text: string) {
    if ((this.state.slides[index]?.notes ?? '') === text) return;
    this.edit((model) => ({ model: rewriteParts(model, (parts) => writeSlideNotes(parts, model.slides[index]!.partPath, text, this.xml)) }));
  }

  // History and saving

  undo() {
    this.travel(this.undoStack, this.redoStack);
  }

  redo() {
    this.travel(this.redoStack, this.undoStack);
  }

  /** The package bytes to save. */
  bytes(): Uint8Array {
    return writePresentation(this.state.model);
  }

  /** The model that was saved becomes the clean state. */
  markSaved(model: PptxSourceModel) {
    this.saved = model;
    this.store.setState({ dirty: this.state.model !== model });
  }

  private travel(from: Snapshot[], to: Snapshot[]) {
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push(this.snapshot());
    this.show(snapshot);
  }

  private snapshot(): Snapshot {
    const { model, current, selection } = this.state;
    return { model, current, selection };
  }

  private show({ model, current, selection }: Snapshot) {
    this.store.setState({
      model,
      slides: this.entries(model),
      current: Math.min(current, model.slides.length - 1),
      selection,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirty: model !== this.saved,
    });
    void this.drawPending();
  }

  /** Makes one change as one history step; a refused or failed change leaves everything as it was. */
  private edit(change: (model: PptxSourceModel, at: Snapshot) => Partial<Snapshot> & { model: PptxSourceModel }) {
    const before = this.snapshot();
    let next: Partial<Snapshot> & { model: PptxSourceModel };
    try {
      next = change(before.model, before);
    } catch (err) {
      throw err instanceof EditRefused ? err : new EditRefused(err instanceof Error ? err.message : 'refused');
    }
    if (next.model === before.model) return;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.show({ current: before.current, selection: before.selection, ...next });
  }

  private addOnSlide(add: (model: PptxSourceModel, slide: SourceSlide) => PptxSourceModel): string | null {
    let added: string | null = null;
    this.edit((model, at) => {
      const slide = model.slides[at.current]!;
      const next = add(model, slide);
      added = newestShapeId(slide, next.slides[at.current]);
      return { model: next, selection: added };
    });
    return added;
  }

  /** Writes the model, changes one part's XML and reads it back; drawn slides of other parts stay valid. */
  private rewritePart(model: PptxSourceModel, part: string, change: (xml: string) => string): PptxSourceModel {
    return rewriteParts(model, (parts) => {
      const bytes = parts[part];
      if (!bytes) throw new EditRefused('missing part');
      return new Map([[part, encoder.encode(change(decoder.decode(bytes)))]]);
    });
  }

  /** The XML of a part as the model has it now, settling pending edits of the model first when there are any. */
  private currentPartXml(part: string): string {
    let model = this.state.model;
    // Edits name their part in different fields (a shape's handle, the slide of an added drawing), so any settles.
    if (model.edits?.length || !model.packageGraph.rawParts?.some((p) => p.partPath === part)) {
      model = settle(model);
      // The same content in a settled model: the step is no edit, so the history and the clean state follow it.
      const replace = (s: Snapshot) => (s.model === this.state.model ? { ...s, model } : s);
      this.undoStack = this.undoStack.map(replace);
      if (this.saved === this.state.model) this.saved = model;
      this.store.setState((s) => ({ ...s, model }));
    }
    const raw = model.packageGraph.rawParts?.find((p) => p.partPath === part);
    if (!raw || raw.kind !== 'binary') throw new EditRefused('missing part');
    return decoder.decode(raw.bytes);
  }

  /** Whether a slide's drawing shows it as the model has it; a slide read back with the same bytes is adopted. */
  private fresh(model: PptxSourceModel, index: number): boolean {
    const slide = model.slides[index]!;
    const drawing = this.drawn.get(slide.partPath);
    if (!drawing) return false;
    if (drawing.slide === slide) return true;
    const bytes = contentBytes(model, slide.partPath);
    if (!bytes || !drawing.bytes || !sameBytes(bytes, drawing.bytes)) return false;
    this.drawn.set(slide.partPath, { ...drawing, slide, bytes });
    return true;
  }

  private entries(model: PptxSourceModel): SlideEntry[] {
    const notes = readAllNotes(model, this.xml);
    // A slide being drawn again keeps showing its last drawing meanwhile.
    return model.slides.map((slide) => ({ partPath: slide.partPath, image: this.drawn.get(slide.partPath)?.image ?? null, notes: notes.get(slide.partPath) ?? '' }));
  }

  /**
   * Draws the slides whose drawing is missing or stale, the shown slide first, a few at a time. A slide object that is
   * unchanged across edits keeps its drawing; one edited meanwhile is drawn again by the next pass.
   */
  private async drawPending(): Promise<void> {
    if (this.drawing || this.disposed) return;
    this.drawing = true;
    try {
      for (;;) {
        const { model, current } = this.state;
        const order = [current, ...model.slides.map((_, i) => i).filter((i) => i !== current)].filter((i) => i < model.slides.length && !this.fresh(model, i));
        if (order.length === 0) return;
        const batch = order.slice(0, RENDER_BATCH);
        const svgs = await this.render(model, batch.map((i) => i + 1));
        if (this.disposed) return;
        for (const i of batch) {
          const svg = svgs.get(i + 1);
          const slide = model.slides[i]!;
          this.drawn.set(slide.partPath, { slide, bytes: contentBytes(model, slide.partPath), image: svg ? svgUrl(svg) : '' });
        }
        this.store.setState((s) => ({ ...s, slides: this.entries(s.model) }));
      }
    } catch (err) {
      this.onRenderError(err);
    } finally {
      this.drawing = false;
    }
  }
}

/**
 * The library writes one transform edit per shape: a model already moving the shape (an earlier drag or nudge not saved
 * yet) is written and read back first, so the next move is its own edit.
 */
function withoutTransformEdit(model: PptxSourceModel, handle: { partPath?: string; nodeId?: unknown } | undefined): PptxSourceModel {
  if (!handle) return model;
  const pending = model.edits?.some((edit) => edit.kind === 'updateShapeTransform' && edit.handle.partPath === handle.partPath && edit.handle.nodeId === handle.nodeId);
  return pending ? settle(model) : model;
}
