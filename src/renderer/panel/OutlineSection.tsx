import { outlineOf, revealHeading } from '../editor/outline';
import { useEditorDoc } from '../editor/use-editor-doc';
import { useServices } from '../state/use-store';
import { PanelSection } from './PanelSection';

/** The headings of the open note (D-162), live while it is edited; a click moves the cursor to the heading. */
export function OutlineSection() {
  const { noteEditor } = useServices();
  const { value: items, editor } = useEditorDoc(noteEditor, (e) => outlineOf(e.state.doc));
  return (
    <PanelSection title="Outline" className="outline-section">
      {items && items.length === 0 ? <p className="muted">Headings in this note appear here</p> : null}
      <ul className="outline-list" aria-label="Outline">
        {items?.map((item) => (
          <li key={item.pos} className={`outline-item outline-level-${item.level}`}>
            <button type="button" className="outline-open" onClick={() => editor && revealHeading(editor, item.pos)}>
              {item.text === '' ? <span className="muted">Empty heading</span> : item.text}
            </button>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}
