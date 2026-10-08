/** Shown in the toolbar row while the selection is inside a link: the address and its actions (INF-SEC-01). */
export function LinkBar({
  href,
  editable,
  onOpen,
  onEdit,
  onRemove,
}: {
  href: string;
  editable: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="link-bar" role="group" aria-label="Link">
      <span className="link-bar-address" title={href}>
        {href}
      </span>
      <button type="button" className="btn btn-small" onClick={onOpen}>
        Open link
      </button>
      {editable ? (
        <>
          <button type="button" className="btn btn-small" onClick={onEdit}>
            Edit link
          </button>
          <button type="button" className="btn btn-small" onClick={onRemove}>
            Remove link
          </button>
        </>
      ) : null}
    </div>
  );
}
