import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { createStore, type Store } from '../../state/store';
import { pdfLoadError, PDF_MESSAGES } from './pdf-messages';
import { documentParams, type PdfRuntime, type PdfSource } from './pdfjs';

export type PdfTool = 'select' | 'highlight' | 'text' | 'draw' | 'image';
/** A zoom preset of pdf.js, or a scale factor (1 = 100 %). */
export type PdfZoom = 'page-width' | 'page-fit' | 'auto' | number;
/** Tools whose color can be chosen. */
export type PdfColorTool = 'highlight' | 'text' | 'draw';

export interface PdfFindState {
  query: string;
  status: 'idle' | 'pending' | 'found' | 'notFound';
  current: number;
  total: number;
  /** The search went past the end (or start) and continued from the other side. */
  wrapped: boolean;
}

export interface PdfSessionState {
  /** `password`: pdf.js asks for one; `locked`: the user canceled that prompt. */
  status: 'loading' | 'ready' | 'password' | 'locked' | 'error';
  wrongPassword: boolean;
  error: string | null;
  pageCount: number;
  page: number;
  zoom: PdfZoom;
  scale: number;
  rotation: number;
  tool: PdfTool;
  /** Annotations or form fields were changed in this load (written by saveDocument). */
  annotationsChanged: boolean;
  find: PdfFindState;
  /** Counts loaded documents; thumbnails and the outline read the document again when it changes. */
  generation: number;
}

const IDLE_FIND: PdfFindState = { query: '', status: 'idle', current: 0, total: 0, wrapped: false };

/** pdf.js FindState: FOUND, NOT_FOUND, WRAPPED, PENDING. */
const FIND_STATUS = ['found', 'notFound', 'found', 'pending'] as const;
/** pdf.js PasswordResponses.INCORRECT_PASSWORD. */
const INCORRECT_PASSWORD = 2;
const HIGHLIGHT_COLORS = 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F';

/** The state of a viewer before its session exists (pdf.js loads first). */
export function createPdfSessionStore(): Store<PdfSessionState> {
  return createStore<PdfSessionState>({
    status: 'loading',
    wrongPassword: false,
    error: null,
    pageCount: 0,
    page: 1,
    zoom: 'auto',
    scale: 1,
    rotation: 0,
    tool: 'select',
    annotationsChanged: false,
    find: IDLE_FIND,
    generation: 0,
  });
}

interface View {
  page: number;
  zoom: PdfZoom;
  rotation: number;
  tool: PdfTool;
}

/**
 * One PDF in a tab (F2, D-130): the pdf.js viewer (continuous scroll, text layer, find, links that open nothing) with its
 * annotation editor, and the view state the React toolbar and sidebar render from. Loading new bytes (after page
 * changes or a save) keeps the page, zoom, rotation and tool. A password is asked through the state and kept only in
 * memory, so saved bytes of the same file open again without asking.
 */
export class PdfSession {
  private readonly eventBus: EventBus;
  private readonly linkService: PDFLinkService;
  private readonly findController: PDFFindController;
  private readonly viewer: PDFViewer;
  private readonly abort = new AbortController();
  private task: PDFDocumentLoadingTask | null = null;
  private pdf: PDFDocumentProxy | null = null;
  private password: string | null = null;
  private triedPassword: string | null = null;
  private answerPassword: ((password: string) => void) | null = null;
  private canceled = false;
  /** Applied once the pages of the next document exist. */
  private restore: View | null = null;
  private pendingPage: number | null = null;
  /** Whether the annotation editor has an edit to undo in the document shown. */
  private canUndo = false;

  constructor(
    private readonly runtime: PdfRuntime,
    container: HTMLDivElement,
    readonly store: Store<PdfSessionState>,
  ) {
    const { EventBus, PDFFindController, PDFLinkService, PDFViewer } = runtime.viewer;
    this.eventBus = new EventBus();
    this.linkService = new PDFLinkService({ eventBus: this.eventBus });
    // Links inside a PDF open nothing, like links in the HTML viewer (D-130).
    this.linkService.externalLinkEnabled = false;
    this.findController = new PDFFindController({ eventBus: this.eventBus, linkService: this.linkService, updateMatchesCountOnProgress: true });
    this.viewer = new PDFViewer({
      container,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      annotationEditorMode: runtime.lib.AnnotationEditorType.NONE,
      annotationEditorHighlightColors: HIGHLIGHT_COLORS,
    });
    this.linkService.setViewer(this.viewer);
    this.listen();
  }

  get document(): PDFDocumentProxy | null {
    return this.pdf;
  }

  private listen(): void {
    const on = (name: string, fn: (e: Record<string, unknown>) => void) => this.eventBus.on(name, fn, { signal: this.abort.signal });
    on('pagesinit', () => this.applyView());
    on('pagechanging', (e) => this.store.setState({ page: e.pageNumber as number }));
    on('scalechanging', (e) => this.store.setState({ scale: e.scale as number, zoom: (e.presetValue as PdfZoom | undefined) ?? (e.scale as number) }));
    on('rotationchanging', (e) => this.store.setState({ rotation: e.pagesRotation as number }));
    on('annotationeditormodechanged', (e) => this.store.setState({ tool: this.toolOf(e.mode as number) }));
    on('annotationeditorstateschanged', (e) => this.onEditorStates(e.details as { hasSomethingToUndo?: boolean }));
    on('editorsrendered', () => this.dropUnchangedEditors());
    on('updatefindmatchescount', (e) => this.setFind(e.matchesCount as { current: number; total: number }));
    on('updatefindcontrolstate', (e) => {
      const state = e.state as number;
      this.setFind(e.matchesCount as { current: number; total: number }, FIND_STATUS[state] ?? 'idle', state === 2);
    });
  }

  private setFind(count: { current: number; total: number } | undefined, status?: PdfFindState['status'], wrapped?: boolean): void {
    const find = this.store.getState().find;
    if (find.status === 'idle') return;
    this.store.setState({
      find: { ...find, current: count?.current ?? find.current, total: count?.total ?? find.total, ...(status ? { status, wrapped: wrapped ?? false } : {}) },
    });
  }

  // Annotation changes -------------------------------------------------------------
  /**
   * Editing an annotation already in the file changes no storage entry, so it counts as a change once it can be
   * undone.
   */
  private onEditorStates(details: { hasSomethingToUndo?: boolean }): void {
    if (details.hasSomethingToUndo === undefined) return;
    this.canUndo = details.hasSomethingToUndo;
    if (this.canUndo) this.store.setState({ annotationsChanged: true });
  }

  /**
   * Turning a tool on gives the annotations already in a page editors, which pdf.js stores as a change although they
   * save as nothing until edited. Once a page's editors exist, that change is dropped when nothing would be saved, so
   * the next real change reports itself again.
   */
  private dropUnchangedEditors(): void {
    const storage = this.pdf?.annotationStorage;
    if (storage && !this.canUndo && storage.serializable.map === null) storage.resetModified();
  }

  // Loading ------------------------------------------------------------------------
  /** Loads `source`, keeping the view of the document shown so far; `page` (1-based) is shown instead of its page. */
  async open(source: PdfSource, page?: number): Promise<void> {
    const s = this.store.getState();
    this.restore = this.pdf ? { page: s.page, zoom: s.zoom, rotation: s.rotation, tool: s.tool } : null;
    if (page !== undefined) this.pendingPage = page;
    await this.close();
    this.canceled = false;
    this.canUndo = false;
    this.store.setState({ status: 'loading', error: null, wrongPassword: false, find: IDLE_FIND });
    const task = this.runtime.lib.getDocument(documentParams(source, this.password));
    this.task = task;
    task.onPassword = (answer: (password: string) => void, reason: number) => {
      this.answerPassword = answer;
      this.store.setState({ status: 'password', wrongPassword: reason === INCORRECT_PASSWORD });
    };
    try {
      const pdf = await task.promise;
      if (this.task !== task) return;
      if (this.triedPassword !== null) this.password = this.triedPassword;
      this.triedPassword = null;
      this.pdf = pdf;
      // The storage's change callbacks are typed as unset placeholders; pdf.js calls them when they are functions.
      Object.assign(pdf.annotationStorage, {
        onSetModified: () => this.store.setState({ annotationsChanged: true }),
        onResetModified: () => this.store.setState({ annotationsChanged: false }),
      });
      this.viewer.setDocument(pdf);
      this.linkService.setDocument(pdf);
      this.store.setState({ status: 'ready', pageCount: pdf.numPages, annotationsChanged: false, generation: s.generation + 1 });
    } catch (err) {
      if (this.task !== task) return;
      this.store.setState(this.canceled ? { status: 'locked', error: PDF_MESSAGES.locked } : { status: 'error', error: pdfLoadError(err) });
    }
  }

  submitPassword(password: string): void {
    const answer = this.answerPassword;
    if (!answer) return;
    this.answerPassword = null;
    this.triedPassword = password;
    this.store.setState({ status: 'loading' });
    answer(password);
  }

  cancelPassword(): void {
    this.canceled = true;
    this.answerPassword = null;
    this.triedPassword = null;
    void this.task?.destroy();
  }

  private async close(): Promise<void> {
    const task = this.task;
    this.task = null;
    this.answerPassword = null;
    if (this.pdf) {
      this.viewer.setDocument(null as unknown as PDFDocumentProxy);
      this.linkService.setDocument(null);
      this.pdf = null;
    }
    await task?.destroy();
  }

  private applyView(): void {
    const view = this.restore;
    this.restore = null;
    this.setZoom(view?.zoom ?? 'auto');
    if (view?.rotation) this.viewer.pagesRotation = view.rotation;
    const page = this.pendingPage ?? view?.page ?? 1;
    this.pendingPage = null;
    this.viewer.currentPageNumber = Math.min(Math.max(1, page), this.viewer.pagesCount);
    this.store.setState({ page: this.viewer.currentPageNumber, rotation: this.viewer.pagesRotation });
    if (view && view.tool !== 'select') this.setTool(view.tool);
  }

  destroy(): void {
    this.abort.abort();
    void this.close();
    this.viewer.cleanup();
  }

  // Overlays -----------------------------------------------------------------------
  /** The element of page `n` (1-based) once the pages exist, for overlays such as comment markers (D-165). */
  pageElement(n: number): HTMLElement | null {
    return this.pdf && n >= 1 && n <= this.viewer.pagesCount ? (this.viewer.getPageView(n - 1)?.div ?? null) : null;
  }

  /** Calls `fn` with the page number each time pdf.js has drawn a page (scrolling, zoom and rotation redraw pages). */
  onPageRendered(fn: (page: number) => void): () => void {
    const listener = (e: { pageNumber: number }) => fn(e.pageNumber);
    this.eventBus.on('pagerendered', listener);
    return () => this.eventBus.off('pagerendered', listener);
  }

  // Navigation and view ------------------------------------------------------------
  /** Shows page `n` (1-based); before the pages exist, once they do. */
  goToPage(n: number): void {
    if (!this.pdf || this.viewer.pagesCount === 0) {
      this.pendingPage = n;
      return;
    }
    this.viewer.currentPageNumber = Math.min(Math.max(1, Math.round(n)), this.viewer.pagesCount);
  }

  goToDestination(dest: unknown): void {
    void this.linkService.goToDestination(dest as string | unknown[]);
  }

  setZoom(zoom: PdfZoom): void {
    if (typeof zoom === 'number') this.viewer.currentScale = zoom;
    else this.viewer.currentScaleValue = zoom;
  }

  zoomBy(steps: 1 | -1): void {
    if (steps > 0) this.viewer.increaseScale();
    else this.viewer.decreaseScale();
  }

  /** Turns the view of every page; the file is not changed (page rotation is a page operation). */
  rotateView(delta: 90 | -90): void {
    this.viewer.pagesRotation = (this.viewer.pagesRotation + delta + 360) % 360;
  }

  // Find ---------------------------------------------------------------------------
  find(query: string, options: { previous?: boolean; again?: boolean; caseSensitive: boolean; entireWord: boolean }): void {
    if (query === '') {
      this.closeFind();
      return;
    }
    this.store.setState({ find: { ...this.store.getState().find, query, status: 'pending' } });
    this.eventBus.dispatch('find', {
      source: this,
      type: options.again ? 'again' : '',
      query,
      caseSensitive: options.caseSensitive,
      entireWord: options.entireWord,
      highlightAll: true,
      findPrevious: options.previous ?? false,
      matchDiacritics: false,
    });
  }

  closeFind(): void {
    this.store.setState({ find: IDLE_FIND });
    this.eventBus.dispatch('findbarclose', { source: this });
  }

  // Annotation editing --------------------------------------------------------------
  private modeOf(tool: PdfTool): number {
    const t = this.runtime.lib.AnnotationEditorType;
    return { select: t.NONE, highlight: t.HIGHLIGHT, text: t.FREETEXT, draw: t.INK, image: t.STAMP }[tool];
  }

  private toolOf(mode: number): PdfTool {
    const t = this.runtime.lib.AnnotationEditorType;
    return mode === t.HIGHLIGHT ? 'highlight' : mode === t.FREETEXT ? 'text' : mode === t.INK ? 'draw' : mode === t.STAMP ? 'image' : 'select';
  }

  /** The editor exists once the first page has loaded; until then the mode reads DISABLE and cannot be set. */
  private editorReady(): boolean {
    // The getter returns the mode number; the typings give it the setter's object type.
    const mode = this.viewer.annotationEditorMode as unknown as number;
    return this.pdf !== null && mode !== this.runtime.lib.AnnotationEditorType.DISABLE;
  }

  setTool(tool: PdfTool): void {
    if (!this.editorReady()) return;
    this.viewer.annotationEditorMode = { mode: this.modeOf(tool) };
  }

  /** Adds an image: the image tool, then pdf.js asks for the file with the system file chooser (D-130). */
  async addImage(): Promise<void> {
    if (!this.editorReady()) return;
    if (this.store.getState().tool !== 'image') {
      const changed = new Promise<void>((resolve) => this.eventBus.on('annotationeditormodechanged', () => resolve(), { once: true, signal: this.abort.signal }));
      this.setTool('image');
      await changed;
    }
    this.eventBus.dispatch('switchannotationeditorparams', { source: this, type: this.runtime.lib.AnnotationEditorParamsType.CREATE, value: {} });
  }

  /** The color of new marks of a tool, and of the selected marks of that kind. */
  setColor(tool: PdfColorTool, color: string): void {
    const p = this.runtime.lib.AnnotationEditorParamsType;
    const type = { highlight: p.HIGHLIGHT_COLOR, text: p.FREETEXT_COLOR, draw: p.INK_COLOR }[tool];
    this.eventBus.dispatch('switchannotationeditorparams', { source: this, type, value: color });
  }

  /**
   * The document's bytes with every annotation and form change written in (pdf.js saveDocument), or the bytes as loaded
   * when nothing changed. A text box still being typed in is finished first.
   */
  async currentBytes(container: HTMLElement): Promise<Uint8Array> {
    const pdf = this.pdf;
    if (!pdf) throw new Error('no document');
    const active = document.activeElement;
    if (active instanceof HTMLElement && container.contains(active)) active.blur();
    return this.store.getState().annotationsChanged ? pdf.saveDocument() : pdf.getData();
  }
}
