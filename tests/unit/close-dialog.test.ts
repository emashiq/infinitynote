import { describe, expect, it } from 'vitest';
import { closeChoiceFrom, closeDialogOptions } from '../../src/main/services/close-dialog';

const RELAUNCH = 'If no tray icon appears, launching Infinity Notes again brings this window back.';

describe('close dialog (INF-DESK-01, D-066)', () => {
  it('has the exact UX_SPEC copy, buttons, default, cancel and checkbox', () => {
    expect(closeDialogOptions({ platform: 'win32', trayStatus: 'supported' })).toEqual({
      type: 'question',
      title: 'Infinity Notes',
      message: 'Keep Infinity Notes running in the background?',
      detail: 'Reminders and stickies only work while the app is running.',
      buttons: ['Keep running in background', 'Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: 'Remember my choice',
      checkboxChecked: true,
      noLink: true,
    });
  });

  it('adds the relaunch sentence on Linux and wherever the tray is not supported', () => {
    const detail = (platform: string, trayStatus: 'supported' | 'unsupported' | 'unknown') => closeDialogOptions({ platform, trayStatus }).detail;
    expect(detail('linux', 'supported')).toBe(`Reminders and stickies only work while the app is running.\n\n${RELAUNCH}`);
    expect(detail('linux', 'unsupported')).toContain(RELAUNCH);
    expect(detail('win32', 'unsupported')).toContain(RELAUNCH);
    expect(detail('win32', 'unknown')).toContain(RELAUNCH);
    expect(detail('win32', 'supported')).not.toContain(RELAUNCH);
  });

  it('maps the button index and checkbox to a choice; unknown answers cancel', () => {
    expect(closeChoiceFrom(0, true)).toEqual({ choice: 'background', remember: true });
    expect(closeChoiceFrom(1, false)).toEqual({ choice: 'quit', remember: false });
    expect(closeChoiceFrom(2, true)).toEqual({ choice: 'cancel', remember: true });
    expect(closeChoiceFrom(7, true)).toEqual({ choice: 'cancel', remember: true });
  });
});
