import { List } from 'lucide-react';
import { useRef, useState } from 'react';
import { useServices } from '../state/use-store';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import type { TabView } from './TabStrip';

export function AllTabsMenu({ views, activeId }: { views: TabView[]; activeId: string }) {
  const { tabs } = useServices();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        label="All tabs"
        icon={List}
        buttonRef={buttonRef}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          setAnchor(anchor ? null : { x: (rect?.right ?? 240) - 220, y: (rect?.bottom ?? 40) + 4 });
        }}
      />
      {anchor ? (
        <Menu
          label="All tabs"
          itemRole="menuitemradio"
          anchor={anchor}
          onClose={() => setAnchor(null)}
          items={views.map((v) => ({ id: v.tab.id, label: v.label, checked: v.tab.id === activeId, onSelect: () => void tabs.activate(v.tab.id) }))}
        />
      ) : null}
    </>
  );
}
