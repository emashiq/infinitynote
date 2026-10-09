import { describe, expect, it } from 'vitest';
import type { CloseBehaviorType } from '../../src/shared/contracts/windows';
import { closeDialogOptions, type CloseChoice, type CloseDialogOptions } from '../../src/main/services/close-dialog';
import { memoryLogger } from '../../src/main/services/logger';
import { MainWindowController, type MainWindowEvents, type MainWindowHandle } from '../../src/main/windows/main-window-controller';

const NOTE_A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOTE_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

class FakeMainWindow implements MainWindowHandle {
  minimized = false;
  visible = false;
  focused = false;
  destroyed = false;
  calls: string[] = [];
  constructor(
    readonly webContentsId: number,
    readonly events: MainWindowEvents,
  ) {}
  /** Loading reports its start at once, like a dev-server URL does. */
  load(): void {
    this.calls.push('load');
    this.events.onLoadStarted();
  }
  show(): void {
    this.visible = true;
    this.calls.push('show');
  }
  focus(): void {
    this.focused = true;
    this.calls.push('focus');
  }
  restore(): void {
    this.minimized = false;
    this.calls.push('restore');
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  isFocused(): boolean {
    return this.focused;
  }
  flashFrame(on: boolean): void {
    this.calls.push(`flash:${on}`);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  /** BrowserWindow.close(): emits close, and the window goes away unless a listener prevented it. */
  close(): boolean {
    let prevented = false;
    this.events.onClose({ preventDefault: () => (prevented = true) });
    if (!prevented) {
      this.destroyed = true;
      this.events.onClosed();
    }
    return !prevented;
  }
}

const settle = () => new Promise((r) => setImmediate(r));

function setup(opts: { behavior?: CloseBehaviorType; answers?: CloseChoice[]; askClose?: () => Promise<CloseChoice>; onFirstLoad?: () => void } = {}) {
  const windows: FakeMainWindow[] = [];
  const log: string[] = [];
  const sent: Array<{ webContentsId: number; noteId: string; takeEdit: boolean; blockId: string | null }> = [];
  const views: Array<{ webContentsId: number; view: string }> = [];
  const dialogs: Array<{ parent: number; options: CloseDialogOptions }> = [];
  const answers = [...(opts.answers ?? [])];
  const ctl = { behavior: opts.behavior ?? ('ask' as CloseBehaviorType), quitting: false, saved: true };
  const logger = memoryLogger();
  const controller = new MainWindowController({
    factory: {
      create(events) {
        const win = new FakeMainWindow(windows.length + 1, events);
        windows.push(win);
        return win;
      },
    },
    sendOpenNote: (webContentsId, e) => sent.push({ webContentsId, ...e }),
    sendOpenReminders: (webContentsId, e) => views.push({ webContentsId, ...e }),
    closeBehavior: () => ctl.behavior,
    rememberCloseBehavior: (v) => {
      log.push(`remember:${v}`);
      ctl.behavior = v;
    },
    closeDialogOptions: () => closeDialogOptions({ platform: 'win32', trayStatus: 'supported' }),
    askClose: async (parent, options) => {
      dialogs.push({ parent, options });
      return opts.askClose ? opts.askClose() : (answers.shift() ?? { choice: 'cancel', remember: false });
    },
    flush: async (ids) => {
      log.push(`flush:${ids.join(',')}`);
      return ctl.saved;
    },
    quit: () => log.push('quit'),
    isQuitting: () => ctl.quitting,
    onFirstLoad: opts.onFirstLoad,
    logger,
  });
  return { controller, windows, log, sent, views, dialogs, ctl, logger, last: () => windows[windows.length - 1]! };
}

describe('MainWindowController reminder opens and attention (D-074, D-076)', () => {
  const BLOCK = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';

  it('a note open carries the block to reveal; the queue keeps the latest block per note', () => {
    const t = setup();
    t.controller.openNote(NOTE_A, false, BLOCK);
    t.controller.openNote(NOTE_A, false, null);
    t.controller.openNote(NOTE_B, false, BLOCK);
    expect(t.controller.rendererReady(1).openNotes).toEqual([
      { noteId: NOTE_A, takeEdit: false, blockId: null },
      { noteId: NOTE_B, takeEdit: false, blockId: BLOCK },
    ]);
    t.controller.openNote(NOTE_A, false, BLOCK);
    expect(t.sent).toEqual([{ webContentsId: 1, noteId: NOTE_A, takeEdit: false, blockId: BLOCK }]);
  });

  it('a Reminders view waits for the renderer (one pending view), then goes as an event; the window is shown', () => {
    const t = setup();
    t.controller.openReminders('today');
    t.controller.openReminders('overdue');
    expect(t.windows).toHaveLength(1);
    expect(t.views).toEqual([]);
    expect(t.controller.rendererReady(1)).toEqual({ openNotes: [], openReminders: 'overdue' });
    expect(t.controller.rendererReady(1).openReminders).toBeNull();
    t.controller.openReminders('overdue');
    expect(t.views).toEqual([{ webContentsId: 1, view: 'overdue' }]);
    expect(t.last().visible).toBe(true);
  });

  it('attention flashes an unfocused main window until it is focused; none without a window', async () => {
    const t = setup({ behavior: 'background' });
    t.controller.ensure();
    const win = t.last();
    win.focused = false;
    t.controller.requestAttention();
    expect(win.calls).toContain('flash:true');
    win.events.onFocus();
    expect(win.calls.at(-1)).toBe('flash:false');
    win.focused = true;
    win.calls.length = 0;
    t.controller.requestAttention();
    expect(win.calls).toEqual([]);
    win.close();
    await settle();
    t.controller.requestAttention();
    expect(t.windows).toHaveLength(1);
  });
});

describe('MainWindowController windows and note opens (D-071)', () => {
  it('queues note opens until the renderer asks for its state, de-duplicated by note, then sends events', () => {
    const t = setup();
    t.controller.ensure();
    t.controller.openNote(NOTE_A, false);
    t.controller.openNote(NOTE_B, true);
    t.controller.openNote(NOTE_A, true);
    expect(t.sent).toEqual([]);
    expect(t.controller.rendererReady(99)).toEqual({ openNotes: [], openReminders: null });
    expect(t.controller.rendererReady(1)).toEqual({
      openNotes: [
        { noteId: NOTE_B, takeEdit: true, blockId: null },
        { noteId: NOTE_A, takeEdit: true, blockId: null },
      ],
      openReminders: null,
    });
    t.controller.openNote(NOTE_B, false);
    expect(t.sent).toEqual([{ webContentsId: 1, noteId: NOTE_B, takeEdit: false, blockId: null }]);
    expect(t.windows).toHaveLength(1);
  });

  it('keeps at most 50 queued opens', () => {
    const t = setup();
    for (let i = 0; i < 60; i += 1) t.controller.openNote(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, false);
    const drained = t.controller.rendererReady(1).openNotes;
    expect(drained).toHaveLength(50);
    expect(drained[0]!.noteId).toBe('00000000-0000-4000-8000-000000000010');
  });

  it('a reload makes the renderer not ready again', () => {
    const t = setup();
    t.controller.ensure();
    t.controller.rendererReady(1);
    t.last().events.onLoadStarted();
    t.controller.openNote(NOTE_A, true);
    expect(t.sent).toEqual([]);
    expect(t.controller.rendererReady(1).openNotes).toEqual([{ noteId: NOTE_A, takeEdit: true, blockId: null }]);
  });

  it('the first-load callback runs once per run, not for reloads or recreated windows', async () => {
    let loads = 0;
    const t = setup({ behavior: 'background', onFirstLoad: () => (loads += 1) });
    t.controller.ensure();
    t.last().events.onLoaded();
    t.last().events.onLoaded();
    t.last().close();
    await settle();
    t.controller.show();
    t.last().events.onLoaded();
    expect(t.windows).toHaveLength(2);
    expect(loads).toBe(1);
  });

  it('show focuses the existing window (restoring a minimized one) and recreates a closed one', async () => {
    const t = setup({ behavior: 'background' });
    t.controller.ensure();
    const first = t.last();
    first.minimized = true;
    t.controller.show();
    expect(first.calls).toEqual(['load', 'restore', 'show', 'focus']);

    first.close();
    await settle();
    expect(first.destroyed).toBe(true);
    expect(t.controller.webContentsId()).toBeNull();
    t.controller.openNote(NOTE_A, true);
    expect(t.windows).toHaveLength(2);
    expect(t.controller.isReady()).toBe(false);
    expect(t.controller.rendererReady(2).openNotes).toEqual([{ noteId: NOTE_A, takeEdit: true, blockId: null }]);
    expect(t.logger.lines.some((l) => l.includes('window: main recreated'))).toBe(true);
  });
});

describe('MainWindowController close policy (INF-DESK-01, INF-STKY-12, D-066)', () => {
  it('ask: the dialog is shown with the options; Cancel keeps the window', async () => {
    const t = setup({ answers: [{ choice: 'cancel', remember: true }] });
    t.controller.ensure();
    expect(t.last().close()).toBe(false);
    await settle();
    expect(t.dialogs).toEqual([{ parent: 1, options: closeDialogOptions({ platform: 'win32', trayStatus: 'supported' }) }]);
    expect(t.last().destroyed).toBe(false);
    expect(t.log).toEqual([]);
  });

  it('ask + background without remember: flush, then the window closes; the next close asks again', async () => {
    const t = setup({ answers: [{ choice: 'background', remember: false }] });
    t.controller.ensure();
    t.last().close();
    await settle();
    expect(t.log).toEqual(['flush:1']);
    expect(t.last().destroyed).toBe(true);
    expect(t.ctl.behavior).toBe('ask');
    expect(t.logger.lines.some((l) => l.includes('window: main closed to background'))).toBe(true);
    t.controller.show();
    t.last().close();
    await settle();
    expect(t.dialogs).toHaveLength(2);
  });

  it('background keeps the window open when its text is not saved (D-055, D-072)', async () => {
    const t = setup({ behavior: 'background' });
    t.controller.ensure();
    t.ctl.saved = false;
    t.last().close();
    await settle();
    expect(t.log).toEqual(['flush:1']);
    expect(t.last().destroyed).toBe(false);
    expect(t.logger.lines.some((l) => l.includes('window: main kept open (text not saved)'))).toBe(true);
    t.ctl.saved = true;
    t.last().close();
    await settle();
    expect(t.last().destroyed).toBe(true);
  });

  it('ask + remember stores the choice before running it; a remembered choice shows no dialog', async () => {
    const t = setup({ answers: [{ choice: 'background', remember: true }] });
    t.controller.ensure();
    t.last().close();
    await settle();
    expect(t.log).toEqual(['remember:background', 'flush:1']);
    t.controller.show();
    t.last().close();
    await settle();
    expect(t.dialogs).toHaveLength(1);
    expect(t.last().destroyed).toBe(true);

    const q = setup({ answers: [{ choice: 'quit', remember: true }] });
    q.controller.ensure();
    q.last().close();
    await settle();
    expect(q.log).toEqual(['remember:quit', 'quit']);
    expect(q.last().destroyed).toBe(false);
  });

  it('quit asks the app to quit; quitting lets the window close without any dialog', async () => {
    const t = setup({ behavior: 'quit' });
    t.controller.ensure();
    expect(t.last().close()).toBe(false);
    await settle();
    expect(t.log).toEqual(['quit']);
    t.ctl.quitting = true;
    expect(t.last().close()).toBe(true);
    expect(t.dialogs).toEqual([]);
  });

  it('a second close while the dialog is open is ignored (one dialog at a time)', async () => {
    let answer!: (c: CloseChoice) => void;
    const t = setup({ askClose: () => new Promise<CloseChoice>((r) => (answer = r)) });
    t.controller.ensure();
    const win = t.last();
    win.close();
    win.close();
    await settle();
    expect(t.dialogs).toHaveLength(1);
    answer({ choice: 'cancel', remember: false });
    await settle();
    win.close();
    await settle();
    expect(t.dialogs).toHaveLength(2);
  });
});
