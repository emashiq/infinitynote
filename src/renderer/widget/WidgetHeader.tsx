import { ChevronDown, ChevronUp, Pin, X } from 'lucide-react';
import { REMINDER_MESSAGES } from '../../shared/contracts/reminders';
import type { WidgetStateType } from '../../shared/contracts/widget';
import { IconButton } from '../ui/IconButton';

export interface WidgetHeaderActions {
  togglePinned(): void;
  toggleCollapsed(): void;
  hide(): void;
}

/**
 * The 36 px widget header (D-081): "Reminders", Keep on top (unavailable where the desktop cannot keep windows on
 * top), Collapse or Expand, and Hide. The window keeps its native frame.
 */
export function WidgetHeader({ state, pinSupported, actions }: { state: WidgetStateType; pinSupported: boolean; actions: WidgetHeaderActions }) {
  return (
    <div className="widget-header" role="toolbar" aria-label="Reminder widget">
      <h1 className="widget-title">Reminders</h1>
      <IconButton
        label="Keep on top"
        icon={Pin}
        size={14}
        aria-pressed={state.alwaysOnTop}
        aria-disabled={pinSupported ? undefined : true}
        title={pinSupported ? 'Keep on top' : REMINDER_MESSAGES.unsupported}
        onClick={() => {
          if (pinSupported) actions.togglePinned();
        }}
      />
      <IconButton
        label={state.collapsed ? 'Expand widget' : 'Collapse widget'}
        icon={state.collapsed ? ChevronDown : ChevronUp}
        size={14}
        aria-expanded={!state.collapsed}
        onClick={actions.toggleCollapsed}
      />
      <IconButton label="Hide widget" icon={X} size={14} onClick={actions.hide} />
    </div>
  );
}
