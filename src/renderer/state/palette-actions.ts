import type { CommandId } from './commands';

export interface PaletteAction {
  id: CommandId;
  label: string;
  /** More words the palette matches. */
  keywords?: string;
  shortcut?: string;
  /** Listed only while Office documents are on (D-187). */
  office?: true;
  /** Listed only while AI actions are on (D-190). */
  ai?: true;
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: 'note.new', label: 'New note', shortcut: 'Ctrl+N' },
  { id: 'note.newPlain', label: 'New plain-text note' },
  { id: 'sticky.new', label: 'New sticky', shortcut: 'Ctrl+Shift+N' },
  { id: 'note.newLocked', label: 'New locked note…', keywords: 'password encrypted secret private' },
  { id: 'sticky.newLocked', label: 'New locked sticky…', keywords: 'password encrypted secret private pin' },
  { id: 'project.new', label: 'New project' },
  { id: 'document.import', label: 'Import file…', keywords: 'document pdf word excel powerpoint csv html add' },
  { id: 'document.newDocx', label: 'New Word document', keywords: 'docx document', office: true },
  { id: 'document.newXlsx', label: 'New spreadsheet', keywords: 'xlsx excel workbook', office: true },
  { id: 'document.newPptx', label: 'New presentation', keywords: 'pptx powerpoint slides deck', office: true },
  { id: 'folder.new', label: 'New folder' },
  { id: 'go.home', label: 'Go to Home' },
  { id: 'go.stickies', label: 'Open Stickies' },
  { id: 'go.reminders', label: 'Open Reminders' },
  { id: 'go.settings', label: 'Open Settings' },
  { id: 'go.graph', label: 'Open graph', keywords: 'relation map connections' },
  { id: 'view.toggleTree', label: 'Toggle notes tree', shortcut: 'Ctrl+\\' },
  { id: 'view.togglePanel', label: 'Toggle details panel', shortcut: 'Ctrl+Shift+\\' },
  { id: 'view.zoomIn', label: 'Zoom in', keywords: 'bigger larger magnify', shortcut: 'Ctrl+=' },
  { id: 'view.zoomOut', label: 'Zoom out', keywords: 'smaller', shortcut: 'Ctrl+-' },
  { id: 'view.zoomReset', label: 'Actual size', keywords: 'zoom reset 100%', shortcut: 'Ctrl+0' },
  { id: 'tab.close', label: 'Close tab', shortcut: 'Ctrl+W' },
  { id: 'tab.next', label: 'Next tab', shortcut: 'Ctrl+Tab' },
  { id: 'tab.prev', label: 'Previous tab', shortcut: 'Ctrl+Shift+Tab' },
  { id: 'note.find', label: 'Find in note', shortcut: 'Ctrl+F' },
  { id: 'note.insertReference', label: 'Link to note or document…' },
  { id: 'note.insertDiagram', label: 'Insert diagram', keywords: 'mermaid flowchart chart sequence gantt' },
  { id: 'comment.add', label: 'Add comment', keywords: 'comment annotate note selection', shortcut: 'Ctrl+Alt+M' },
  { id: 'ai.ask', label: 'Ask AI about the selection…', keywords: 'ai claude openai codex analyze summarize action items problems', shortcut: 'Ctrl+Shift+I', ai: true },
  { id: 'note.float', label: 'Float current note' },
  { id: 'note.exportMarkdown', label: 'Export note as Markdown…' },
  { id: 'note.exportHtml', label: 'Export note as HTML…' },
  { id: 'note.exportPdf', label: 'Export note as PDF…' },
  { id: 'note.print', label: 'Print note…' },
  { id: 'note.lock', label: 'Lock note…', keywords: 'password encrypt windows hello lock settings' },
  { id: 'note.lockNow', label: 'Lock note now' },
  { id: 'notes.lockAll', label: 'Lock all notes and documents', keywords: 'locked files password' },
  { id: 'backup.create', label: 'Back up now…' },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', shortcut: 'Ctrl+/' },
];

/** The palette's actions with the features as they are: no "New Word document" while Office documents are off, no Ask AI while AI actions are off. */
export function paletteActions(features: { officeDocuments: boolean; aiActions: boolean }): PaletteAction[] {
  return PALETTE_ACTIONS.filter((a) => (features.officeDocuments || !a.office) && (features.aiActions || !a.ai));
}

/**
 * Case-insensitive substring or word-prefix match on the label and the optional keywords; keeps list order. An empty
 * query returns everything. The palette and the editor's insert menu share it.
 */
export function filterActions<T extends { label: string; keywords?: string }>(actions: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...actions];
  const tokens = q.split(/\s+/);
  return actions.filter((a) => {
    const label = (a.keywords ? `${a.label} ${a.keywords}` : a.label).toLowerCase();
    if (label.includes(q)) return true;
    const words = label.split(/\s+/);
    return tokens.every((t) => words.some((w) => w.startsWith(t)));
  });
}
