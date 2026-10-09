import { Bell, ChevronLeft, ChevronRight, FileText, House, Settings, StickyNote, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { displayTitle } from '../../shared/names';
import type { TabType } from '../../shared/contracts/session';
import type { AppServices } from '../state/app-services';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';
import { scrollBehavior } from '../ui/motion';
import { AllTabsMenu } from './AllTabsMenu';

export interface TabView {
  tab: TabType;
  label: string;
  sticky: boolean;
  color: string | null;
}

export function tabViews(services: AppServices, tabs: TabType[]): TabView[] {
  const notes = services.tree.store.getState().snapshot.notes;
  return tabs.map((tab) => {
    switch (tab.kind) {
      case 'home':
        return { tab, label: 'Home', sticky: false, color: null };
      case 'stickies':
        return { tab, label: 'Stickies', sticky: false, color: null };
      case 'reminders':
        return { tab, label: 'Reminders', sticky: false, color: null };
      case 'settings':
        return { tab, label: 'Settings', sticky: false, color: null };
      default: {
        const note = notes.find((n) => n.id === tab.noteId);
        return { tab, label: displayTitle(note?.title ?? ''), sticky: !!note?.sticky, color: note?.color ?? null };
      }
    }
  });
}

function TabIcon({ view }: { view: TabView }) {
  const props = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;
  switch (view.tab.kind) {
    case 'home':
      return <House {...props} />;
    case 'stickies':
      return <StickyNote {...props} />;
    case 'reminders':
      return <Bell {...props} />;
    case 'settings':
      return <Settings {...props} />;
    default:
      return (
        <>
          {view.sticky ? <StickyNote {...props} /> : <FileText {...props} />}
          {view.sticky && view.color ? <span className={`dot dot-${view.color}`} aria-hidden /> : null}
        </>
      );
  }
}

export function TabStrip() {
  const services = useServices();
  const { tabs: tabsStore } = services;
  const { session } = useStore(tabsStore.store);
  useStore(services.tree.store);
  const views = tabViews(services, session.tabs);
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const roving = views.some((v) => v.tab.id === focusId) ? focusId : session.activeTabId;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [views.length]);

  useEffect(() => {
    document.getElementById(`tab-${session.activeTabId}`)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [session.activeTabId]);

  const focusTab = (id: string) => {
    setFocusId(id);
    document.getElementById(`tab-${id}`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = views.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      focusTab(views[(i + views.length) % views.length]!.tab.id);
    };
    const id = views[index]!.tab.id;
    switch (e.key) {
      case 'ArrowRight':
        move(index === last ? 0 : index + 1);
        break;
      case 'ArrowLeft':
        move(index === 0 ? last : index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        void tabsStore.activate(id);
        break;
      case 'Delete':
        if (id !== 'home') {
          e.preventDefault();
          void tabsStore.close(id);
        }
        break;
      default:
    }
  };

  const scrollBy = (dx: number) => listRef.current?.scrollBy?.({ left: dx, behavior: scrollBehavior() });

  return (
    <div className="tab-strip">
      {overflow ? <IconButton label="Scroll tabs left" icon={ChevronLeft} onClick={() => scrollBy(-200)} /> : null}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Open tabs"
        className="tab-list"
        onWheel={(e) => {
          if (listRef.current && e.deltaY !== 0) listRef.current.scrollLeft += e.deltaY;
        }}
      >
        {views.map((view, index) => {
          const id = view.tab.id;
          const active = id === session.activeTabId;
          return (
            <div key={id} role="presentation" className={`tab ${active ? 'is-active' : ''} ${id === 'home' ? 'tab-home' : ''}`}>
              <div
                role="tab"
                id={`tab-${id}`}
                aria-selected={active}
                aria-controls="tabpanel"
                tabIndex={roving === id ? 0 : -1}
                className="tab-main"
                onClick={() => void tabsStore.activate(id)}
                onFocus={() => setFocusId(id)}
                onMouseDown={(e: MouseEvent) => {
                  if (e.button === 1) e.preventDefault();
                }}
                onAuxClick={(e: MouseEvent) => {
                  if (e.button === 1 && id !== 'home') {
                    e.preventDefault();
                    void tabsStore.close(id);
                  }
                }}
                onKeyDown={(e) => onKeyDown(e, index)}
              >
                <TabIcon view={view} />
                <span className="tab-label">{view.label}</span>
              </div>
              {id !== 'home' ? (
                <button type="button" tabIndex={-1} className="tab-close" aria-label={`Close ${view.label}`} onClick={() => void tabsStore.close(id)}>
                  <X size={12} strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {overflow ? <IconButton label="Scroll tabs right" icon={ChevronRight} onClick={() => scrollBy(200)} /> : null}
      <AllTabsMenu views={views} activeId={session.activeTabId} />
    </div>
  );
}
