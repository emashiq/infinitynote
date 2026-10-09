import { useId, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { DEFAULT_TABLE, MAX_TABLE, type TableSize } from './table-actions';

/** A whole number from 1 to `max` typed in a field, or null. */
function count(text: string, max: number): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

/**
 * "Insert table": rows, columns and a header row (3 x 3 with a header row to start). The editor gets the focus back
 * on close, in the new table's first cell after Insert.
 */
export function InsertTableDialog({ onInsert, onClose }: { onInsert: (size: TableSize) => void; onClose: () => void }) {
  const id = useId();
  const [rows, setRows] = useState(String(DEFAULT_TABLE.rows));
  const [cols, setCols] = useState(String(DEFAULT_TABLE.cols));
  const [withHeaderRow, setWithHeaderRow] = useState<boolean>(DEFAULT_TABLE.withHeaderRow);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const r = count(rows, MAX_TABLE.rows);
    const c = count(cols, MAX_TABLE.cols);
    if (r === null || c === null) {
      setError(`Use 1 to ${MAX_TABLE.rows} rows and 1 to ${MAX_TABLE.cols} columns.`);
      return;
    }
    onInsert({ rows: r, cols: c, withHeaderRow });
  };
  return (
    <Dialog title="Insert table" onClose={onClose} returnFocus={false}>
      <form
        className="insert-table"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="insert-table-size">
          <span className="form-field">
            <label htmlFor={`${id}-rows`} className="field-label">
              Rows
            </label>
            <input
              id={`${id}-rows`}
              type="number"
              className="text-input number-input"
              min={1}
              max={MAX_TABLE.rows}
              value={rows}
              data-autofocus=""
              data-select=""
              onChange={(e) => {
                setRows(e.target.value);
                setError(null);
              }}
            />
          </span>
          <span className="form-field">
            <label htmlFor={`${id}-cols`} className="field-label">
              Columns
            </label>
            <input
              id={`${id}-cols`}
              type="number"
              className="text-input number-input"
              min={1}
              max={MAX_TABLE.cols}
              value={cols}
              onChange={(e) => {
                setCols(e.target.value);
                setError(null);
              }}
            />
          </span>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={withHeaderRow} onChange={(e) => setWithHeaderRow(e.target.checked)} />
          Header row
        </label>
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary">
            Insert
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
