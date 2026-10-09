import { dueLines } from '../../shared/time/format';

/** The due time in the reminder's zone and, when the computer's wall clock reads differently, "Your time: …" (INF-REM-03). */
export function DueTime({ instant, zoneId, displayZone }: { instant: number; zoneId: string; displayZone: string | null }) {
  const lines = dueLines(instant, zoneId, displayZone);
  return (
    <span className="due-time">
      <span className="due-primary">{lines.primary}</span>
      {lines.local ? <span className="due-local muted">{lines.local}</span> : null}
    </span>
  );
}
