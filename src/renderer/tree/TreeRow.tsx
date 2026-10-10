import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Link2, Pin, Star, StickyNote, Trash } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { TreeNode, VisibleRow } from '../../shared/tree/tree-model';
import { ColorDot } from '../ui/ColorDot';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';
import { LockMark } from '../ui/LockMark';
import { RenameInput } from '../ui/RenameInput';

function NodeIcon({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  const props = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;
  // Documents, and favorites and trash entries of documents, show their kind (D-118).
  if (node.documentKind) return <DocumentKindIcon kind={node.documentKind} />;
  switch (node.kind) {
    case 'folder':
      return expanded ? <FolderOpen {...props} /> : <Folder {...props} />;
    case 'note':
      return node.sticky ? <StickyNote {...props} /> : <FileText {...props} />;
    case 'trashItem':
      return node.trash?.kind === 'note' ? <FileText {...props} /> : <Folder {...props} />;
    case 'favorite':
      return node.entity === 'note' ? <FileText {...props} /> : <Folder {...props} />;
    case 'group':
      return node.key === 'trash' ? <Trash {...props} /> : node.key === 'favorites' ? <Star {...props} /> : <Folder {...props} />;
    case 'empty':
      return null;
    default:
      return <Folder {...props} />;
  }
}

export function TreeRow({
  node,
  row,
  selected,
  rovingFocus,
  renaming,
  renameInitial,
  onRenameCommit,
  onRenameCancel,
  onClick,
  onContextMenu,
}: {
  node: TreeNode;
  row: VisibleRow;
  selected: boolean;
  rovingFocus: boolean;
  renaming: boolean;
  renameInitial: string;
  onRenameCommit: (value: string) => Promise<string | null>;
  onRenameCancel: () => void;
  onClick: (e: MouseEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  return (
    <li
      id={`tree-${node.key}`}
      role="treeitem"
      data-key={node.key}
      aria-level={row.level}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      tabIndex={rovingFocus ? 0 : -1}
      className={`tree-row ${selected ? 'is-selected' : ''} ${node.kind === 'empty' ? 'is-empty' : ''}`}
      style={{ paddingLeft: (row.level - 1) * 16 + 8 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="tree-chevron" aria-hidden>
        {row.hasChildren ? <Chevron size={14} strokeWidth={1.75} /> : null}
      </span>
      <NodeIcon node={node} expanded={row.expanded} />
      {node.sticky && node.color ? <ColorDot color={node.color} /> : null}
      {renaming ? (
        <RenameInput initial={renameInitial} onCommit={onRenameCommit} onCancel={onRenameCancel} />
      ) : (
        <span className="tree-label">{node.label}</span>
      )}
      {node.locked ? <LockMark /> : null}
      {node.linked && node.kind === 'document' ? <Link2 size={12} strokeWidth={1.75} aria-label="Linked file" className="tree-pin" /> : null}
      {node.pinned ? <Pin size={12} strokeWidth={1.75} aria-label="Pinned" className="tree-pin" /> : null}
    </li>
  );
}
