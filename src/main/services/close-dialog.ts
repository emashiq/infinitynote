import type { CapabilityStatusType } from '../../shared/contracts/app';

/** What the user chose in the main-window close dialog (D-066). */
export interface CloseChoice {
  choice: 'background' | 'quit' | 'cancel';
  remember: boolean;
}

export interface CloseDialogOptions {
  type: 'question';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  checkboxLabel: string;
  checkboxChecked: boolean;
  noLink: boolean;
}

/** Index-aligned with the dialog buttons. */
const CHOICES = ['background', 'quit', 'cancel'] as const;

export const CLOSE_DIALOG_COPY = {
  message: 'Keep Infinity Notes running in the background?',
  detail: 'Reminders and stickies only work while the app is running.',
  noTray: 'If no tray icon appears, launching Infinity Notes again brings this window back.',
  buttons: ['Keep running in background', 'Quit', 'Cancel'],
  remember: 'Remember my choice',
} as const;

/** The native message box options; Linux and desktops without a supported tray get the relaunch sentence. */
export function closeDialogOptions(input: { platform: string; trayStatus: CapabilityStatusType['status'] }): CloseDialogOptions {
  const relaunch = input.platform === 'linux' || input.trayStatus !== 'supported';
  return {
    type: 'question',
    title: 'Infinity Notes',
    message: CLOSE_DIALOG_COPY.message,
    detail: relaunch ? `${CLOSE_DIALOG_COPY.detail}\n\n${CLOSE_DIALOG_COPY.noTray}` : CLOSE_DIALOG_COPY.detail,
    buttons: [...CLOSE_DIALOG_COPY.buttons],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: CLOSE_DIALOG_COPY.remember,
    checkboxChecked: true,
    noLink: true,
  };
}

/** Maps a message box answer to a choice; any unexpected button index counts as Cancel. */
export function closeChoiceFrom(response: number, checkboxChecked: boolean): CloseChoice {
  return { choice: CHOICES[response] ?? 'cancel', remember: checkboxChecked };
}
