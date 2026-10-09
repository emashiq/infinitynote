import { z } from 'zod';
import { CapabilityStatus } from './app';

/** The optional global quick-sticky shortcut (INF-KEY-05, D-099): off by default, one of a few presets. */
export const GLOBAL_SHORTCUT_PRESETS = ['CommandOrControl+Alt+N', 'CommandOrControl+Shift+Alt+N', 'CommandOrControl+Alt+Space'] as const;
export const GlobalAccelerator = z.enum(GLOBAL_SHORTCUT_PRESETS);
export type GlobalAcceleratorType = z.infer<typeof GlobalAccelerator>;

export const QuickStickySetting = z.strictObject({ enabled: z.boolean(), accelerator: GlobalAccelerator });
export type QuickStickySettingType = z.infer<typeof QuickStickySetting>;

/** What Settings shows: the stored choice, whether the OS accepted it, and why not. */
export const ShortcutState = z.strictObject({
  enabled: z.boolean(),
  accelerator: GlobalAccelerator,
  registered: z.boolean(),
  error: z.string().nullable(),
  capability: CapabilityStatus,
});
export type ShortcutStateType = z.infer<typeof ShortcutState>;
export const ShortcutSetRequest = QuickStickySetting;

export const SHORTCUT_MESSAGES = {
  taken: 'This shortcut is used by another app. Choose another one.',
  unsupported: 'Not supported by this desktop',
} as const;

/** "CommandOrControl+Alt+N" reads "Ctrl+Alt+N" on Windows and Linux. */
export function acceleratorLabel(accelerator: GlobalAcceleratorType): string {
  return accelerator.replace('CommandOrControl', 'Ctrl');
}
