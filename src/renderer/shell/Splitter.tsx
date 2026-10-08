import { TREE_MAX, TREE_MIN } from '../state/layout-store';
import { useServices, useStore } from '../state/use-store';

export function Splitter() {
  const { layout } = useServices();
  const { treeWidth } = useStore(layout.store);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize notes tree"
      aria-valuemin={TREE_MIN}
      aria-valuemax={TREE_MAX}
      aria-valuenow={treeWidth}
      tabIndex={0}
      className="splitter"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          layout.setTreeWidth(treeWidth + (e.key === 'ArrowRight' ? 8 : -8), { persist: true });
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          layout.setTreeWidth(e.key === 'End' ? TREE_MAX : TREE_MIN, { persist: true });
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = treeWidth;
        let last = startWidth;
        const move = (ev: PointerEvent) => {
          last = startWidth + ev.clientX - startX;
          layout.setTreeWidth(last, { persist: false });
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          layout.setTreeWidth(last, { persist: true });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}
