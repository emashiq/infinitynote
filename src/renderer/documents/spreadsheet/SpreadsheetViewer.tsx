import '@fortune-sheet/react/dist/index.css';
import { COMMENT_MESSAGES, MAX_COMMENT_QUOTE } from '../../../shared/contracts/comments';
import '../../styles/spreadsheet.css';
import { locale, type Context, type Sheet as GridSheet } from '@fortune-sheet/core';
import { Workbook as Grid, type WorkbookInstance } from '@fortune-sheet/react';
import { Save, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { DocumentReadWorkbookResponseType } from '../../../shared/contracts/documents';
import { Workbook, WORKBOOK_FEATURE_LABELS, WORKBOOK_LIMITS } from '../../../shared/documents/workbook';
import { WORKBOOK_MESSAGES } from '../../../shared/documents/workbook-messages';
import { Dialog } from '../../ui/Dialog';
import { DocumentFindBar } from '../DocumentFindBar';
import type { DocumentViewerProps } from '../viewer-registry';
import { fromGridSheets, GRID_FONTS, toGridSheets } from './fortune-model';

// New cells and font 0 of the font menu use the app's sans font, not Times New Roman (D-164).
locale({ lang: 'en' } as Context).fontarray.splice(0, GRID_FONTS.length, ...GRID_FONTS);
import { findInSheets, stepMatch, type SheetMatch } from './sheet-find';
import { gridMenus, modelProblem } from './spreadsheet-config';

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; read: DocumentReadWorkbookResponseType; sheets: GridSheet[] };

/**
 * The spreadsheet viewer and editor (F3, D-140): FortuneSheet's grid with sheets, formulas, formatting, merges, sizes,
 * frozen panes, sort, filter, notes, copy and paste, undo and redo, on the workbook main read from the file. Save
 * (Ctrl+S) sends the edited model back, and main writes the xlsx or csv and saves it like any document (revision,
 * versions, linked originals). Before the first save of a file with parts the model does not keep, the user sees what
 * saving removes. Leaving or closing the tab saves first.
 */
export default function SpreadsheetViewer({ document, host, target, findRequests, readOnly }: DocumentViewerProps) {
  const grid = useRef<WorkbookInstance>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  // Edits counted since opening, and the count the last save wrote; edits during a save stay unsaved.
  const [edits, setEdits] = useState(0);
  const [savedEdits, setSavedEdits] = useState(0);
  const editCount = useRef(0);
  // Operations the grid reports before the user touches it (opening, recalculation) are not edits.
  const touched = useRef(false);
  const [saving, setSaving] = useState(false);
  const [simplified, setSimplified] = useState<DocumentReadWorkbookResponseType['simplified']>([]);
  const [confirm, setConfirm] = useState<((save: boolean) => void) | null>(null);
  const [findToggle, setFindToggle] = useState(() => ({ open: false, at: findRequests }));
  const findOpen = findRequests > findToggle.at || findToggle.open;
  const [find, setFind] = useState({ query: '', caseSensitive: false, wholeCell: false });
  const [matches, setMatches] = useState<{ list: SheetMatch[]; current: number }>({ list: [], current: -1 });
  const csv = document.kind === 'csv';
  const dirty = edits !== savedEdits;
  const ready = loaded.status === 'ready';

  useEffect(() => {
    let live = true;
    void host.readWorkbook().then((res) => {
      if (!live) return;
      if (!res.ok) return setLoaded({ status: 'error', message: res.message });
      setSimplified(res.data.simplified);
      setLoaded({ status: 'ready', read: res.data, sheets: toGridSheets(res.data.workbook, WORKBOOK_LIMITS.maxGridCells) });
    });
    return () => {
      live = false;
    };
  }, [host]);

  // Formulas saved without a result (by other apps) are calculated once the grid exists.
  useEffect(() => {
    if (loaded.status !== 'ready') return;
    const needsResults = loaded.read.workbook.sheets.some((s) => s.cells.some((c) => c.f !== undefined && c.v === undefined));
    if (needsResults) grid.current?.calculateFormula();
  }, [loaded]);

  const show = useCallback((match: { sheetId: string; r: number; c: number }) => {
    const api = grid.current;
    if (!api) return;
    api.activateSheet({ id: match.sheetId });
    // The sheet becomes current in the grid's next render.
    setTimeout(() => {
      api.setSelection([{ row: [match.r, match.r], column: [match.c, match.c] }], { id: match.sheetId });
      api.scroll({ targetRow: match.r, targetColumn: match.c });
    });
  }, []);

  useEffect(() => {
    if (!ready || !target || !('sheet' in target.target)) return;
    const { sheet, row = 0, col = 0 } = target.target;
    const found = grid.current?.getAllSheets().find((s) => s.name.toLowerCase() === sheet.toLowerCase());
    if (found?.id) show({ sheetId: found.id, r: row, c: col });
    else host.notify(WORKBOOK_MESSAGES.sheetMissing(sheet), 'error');
  }, [ready, target, show, host]);

  // Comments on cells (D-165): the selected cell is the anchor; the sidebar opens the sheet at it.
  useEffect(() => {
    if (!ready) return undefined;
    return host.comments({
      current: () => {
        const api = grid.current;
        const range = api?.getSelection()?.[0];
        const sheet = api?.getSheet();
        const row = range?.row[0];
        const col = range?.column[0];
        if (!api || !sheet?.name || row === undefined || col === undefined) return { error: COMMENT_MESSAGES.selectCell };
        const value = api.getCellValue(row, col);
        return { anchor: { type: 'cell', sheet: sheet.name, row, col }, quote: value === null || value === undefined ? '' : String(value).slice(0, MAX_COMMENT_QUOTE) };
      },
    });
  }, [ready, host]);

  const askSimplify = useCallback(() => new Promise<boolean>((resolve) => setConfirm(() => resolve)), []);

  const save = useCallback(async (): Promise<boolean> => {
    const api = grid.current;
    if (!api || loaded.status !== 'ready' || readOnly) return false;
    if (simplified.length > 0 && !(await askSimplify())) return false;
    const at = editCount.current;
    const checked = Workbook.safeParse(fromGridSheets(api.getAllSheets()));
    if (!checked.success) {
      host.notify(modelProblem(checked.error), 'error');
      return false;
    }
    setSaving(true);
    try {
      if (!(await host.saveWorkbook(checked.data, loaded.read.csv))) return false;
      setSavedEdits(at);
      setSimplified([]);
      return true;
    } finally {
      setSaving(false);
    }
  }, [loaded, readOnly, simplified, askSimplify, host]);

  useEffect(() => {
    host.setUnsaved(dirty && !readOnly ? save : null);
  }, [dirty, readOnly, save, host]);
  useEffect(() => () => host.setUnsaved(null), [host]);

  const onOp = useCallback(() => {
    if (!touched.current) return;
    editCount.current += 1;
    setEdits(editCount.current);
  }, []);

  const runFind = (next: typeof find, step: 'first' | 'next' | 'previous') => {
    setFind(next);
    const api = grid.current;
    if (!api) return;
    const list = step === 'first' || matches.list.length === 0 ? findInSheets(api.getAllSheets(), next.query, next) : matches.list;
    const current = step === 'first' ? (list.length > 0 ? 0 : -1) : stepMatch(list.length, matches.current, step === 'previous');
    setMatches({ list, current });
    const match = list[current];
    if (match) show(match);
  };

  const onKeyDownCapture = (e: KeyboardEvent) => {
    touched.current = true;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      if (dirty && !saving) void save();
    }
  };

  const menus = useMemo(() => gridMenus(csv), [csv]);
  const summary = find.query === '' ? '' : matches.list.length === 0 ? WORKBOOK_MESSAGES.noMatches : `${matches.current + 1} of ${matches.list.length}`;

  return (
    <div className="spreadsheet-viewer" onKeyDownCapture={onKeyDownCapture} onPointerDownCapture={() => (touched.current = true)} onPasteCapture={() => (touched.current = true)}>
      <div className="document-toolbar spreadsheet-toolbar" role="toolbar" aria-label="Spreadsheet">
        {readOnly ? null : (
          <button type="button" className="btn btn-small" disabled={!ready || !dirty || saving} onClick={() => void save()} title="Save (Ctrl+S)">
            <Save size={14} aria-hidden="true" />
            Save
          </button>
        )}
        <button type="button" className="btn btn-small" disabled={!ready} aria-pressed={findOpen} onClick={() => setFindToggle({ open: !findOpen, at: findRequests })} title="Find (Ctrl+F)">
          <Search size={14} aria-hidden="true" />
          Find
        </button>
        <span className="save-status" role="status">
          {readOnly ? 'Read-only' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : ''}
        </span>
        {csv && !readOnly ? <span className="muted spreadsheet-hint">{WORKBOOK_MESSAGES.csvValuesOnly}</span> : null}
      </div>
      {simplified.length > 0 && !readOnly ? (
        <p role="status" className="banner spreadsheet-simplified">
          {WORKBOOK_MESSAGES.simplifiedBanner(simplified.length)} {simplified.map((f) => WORKBOOK_FEATURE_LABELS[f]).join(', ')}.
        </p>
      ) : null}
      {findOpen && ready ? (
        <DocumentFindBar
          subject="spreadsheet"
          initialQuery={find.query}
          summary={summary}
          focusRequests={findRequests}
          onQuery={(query) => runFind({ ...find, query }, 'first')}
          onStep={(previous) => runFind(find, previous ? 'previous' : 'next')}
          onClose={() => setFindToggle({ open: false, at: findRequests })}
          options={[
            { label: 'Match case', checked: find.caseSensitive, onChange: (caseSensitive) => runFind({ ...find, caseSensitive }, 'first') },
            { label: 'Whole cell', checked: find.wholeCell, onChange: (wholeCell) => runFind({ ...find, wholeCell }, 'first') },
          ]}
        />
      ) : null}
      <div className="spreadsheet-grid" role="application" aria-label={`${document.title} (spreadsheet)`}>
        {loaded.status === 'loading' ? (
          <span className="muted spreadsheet-message" aria-busy="true">
            Opening spreadsheet…
          </span>
        ) : loaded.status === 'error' ? (
          <p role="alert" className="spreadsheet-message">
            {loaded.message}
          </p>
        ) : (
          <Grid
            ref={grid}
            data={loaded.sheets}
            onOp={onOp}
            lang="en"
            allowEdit={!readOnly}
            showToolbar={!readOnly}
            showSheetTabs={!csv}
            defaultFontSize={11}
            currency="$"
            generateSheetId={() => crypto.randomUUID()}
            {...menus}
          />
        )}
      </div>
      {confirm ? (
        <Dialog
          title={WORKBOOK_MESSAGES.simplifiedTitle}
          onClose={() => {
            confirm(false);
            setConfirm(null);
          }}
        >
          <p className="dialog-body">{WORKBOOK_MESSAGES.simplifiedIntro}</p>
          <ul className="spreadsheet-feature-list">
            {simplified.map((f) => (
              <li key={f}>{WORKBOOK_FEATURE_LABELS[f]}</li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                confirm(true);
                setConfirm(null);
              }}
            >
              Save without them
            </button>
            <button
              type="button"
              className="btn"
              data-autofocus=""
              onClick={() => {
                confirm(false);
                setConfirm(null);
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
