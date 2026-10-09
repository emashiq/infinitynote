import { inkFor, type HexColor } from '../../shared/color';
import type { NoteColorType } from '../../shared/contracts/hierarchy';
import { isPresetColor } from '../../shared/sticky-colors';

/**
 * Paints the sticky's colors on the page root, so html and body show the sticky color too and nothing else shows at
 * the window's edges (stickies.css). A preset has its own light and dark variant (CSS); a custom color is set as is,
 * with the dark or light ink that reads on it. A default text color replaces the ink. Returns the cleanup.
 */
export function applyStickyAppearance(root: HTMLElement, look: { color: NoteColorType; textColor: HexColor | null }): () => void {
  const custom = !isPresetColor(look.color);
  root.dataset.stickyColor = custom ? 'custom' : look.color;
  if (custom) {
    root.dataset.stickyInk = inkFor(look.color);
    root.style.setProperty('--sticky-bg', look.color);
  } else {
    delete root.dataset.stickyInk;
    root.style.removeProperty('--sticky-bg');
  }
  if (look.textColor) root.style.setProperty('--sticky-text', look.textColor);
  else root.style.removeProperty('--sticky-text');
  return () => {
    delete root.dataset.stickyColor;
    delete root.dataset.stickyInk;
    root.style.removeProperty('--sticky-bg');
    root.style.removeProperty('--sticky-text');
  };
}
