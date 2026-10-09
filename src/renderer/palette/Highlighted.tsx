import type { Segment } from '../../shared/search/segments';

/** Search text with its hits marked; every segment is a text node, so note content is never parsed as markup. */
export function Highlighted({ segments, className }: { segments: readonly Segment[]; className?: string }) {
  return (
    <span className={className}>
      {segments.map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </span>
  );
}
