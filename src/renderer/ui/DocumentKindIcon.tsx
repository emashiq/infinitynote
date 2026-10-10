import { File, FileCode, FileSpreadsheet, FileType, Presentation, Sheet, type LucideIcon } from 'lucide-react';
import type { DocumentKind } from '../../shared/documents/kinds';

const ICONS: Record<DocumentKind, LucideIcon> = {
  pdf: File,
  docx: FileType,
  pptx: Presentation,
  xlsx: FileSpreadsheet,
  csv: Sheet,
  html: FileCode,
};

/** The icon of a document kind (D-118) in the tree, tabs, Home and search. */
export function DocumentKindIcon({ kind, size = 16 }: { kind: DocumentKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} strokeWidth={1.75} aria-hidden data-document-kind={kind} />;
}
