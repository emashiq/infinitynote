import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

/** One collapsible section of the context panel: a compact disclosure heading over its body. */
export function PanelSection({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className={`info-section ${className ?? ''}`.trim()}>
      <h2 className="panel-heading">
        <button type="button" className="disclosure" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <Chevron size={14} strokeWidth={1.75} aria-hidden />
          {title}
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
