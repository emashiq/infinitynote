/** A floating note that went to Trash: recoverable, with no editor mounted (INF-STKY-08). */
export function StickyTrashState({ onRestore, onClose }: { onRestore: () => void; onClose: () => void }) {
  return (
    <div className="sticky-trash">
      <h2 className="view-title">This note is in Trash</h2>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={onRestore}>
          Restore
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close window
        </button>
      </div>
    </div>
  );
}
