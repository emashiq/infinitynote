import type { NoteColorType } from '../../shared/contracts/hierarchy';
import { isPresetColor } from '../../shared/sticky-colors';

/** The small dot that marks a sticky in lists, tabs and the tree: a preset's dot color, or a custom color as chosen. */
export function ColorDot({ color }: { color: NoteColorType }) {
  return isPresetColor(color) ? <span className={`dot dot-${color}`} aria-hidden /> : <span className="dot" style={{ background: color }} aria-hidden />;
}
