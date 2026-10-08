import { z } from 'zod';

export const ThemeSetting = z.enum(['system', 'light', 'dark']);

/** Settings registry (D-041). Add new keys here; stored as {"v":<version>,"value":<value>}. */
export const SETTINGS = {
  'appearance.theme': { version: 1, schema: ThemeSetting, default: 'system' },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const SettingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

export const SettingsGetRequest = z.strictObject({
  keys: z
    .array(SettingKeySchema)
    .min(1)
    .max(50)
    .refine((keys) => new Set(keys).size === keys.length, 'Keys must be unique'),
});
export const SettingsGetResponse = z.strictObject({ values: z.record(z.string(), z.unknown()) });

function variant<K extends SettingKey>(key: K) {
  return z.strictObject({ key: z.literal(key), value: SETTINGS[key].schema });
}
type ThemeVariant = ReturnType<typeof variant<'appearance.theme'>>;
const variants = SETTING_KEYS.map((k) => variant(k));
export const SettingsSetRequest = z.discriminatedUnion('key', variants as unknown as [ThemeVariant]);

export const SettingsSetResponse = z.strictObject({
  key: SettingKeySchema,
  value: z.unknown(),
  updatedAt: z.number().int(),
});

export const SettingsChangedEvent = SettingsSetResponse;
export type SettingsChangedPayload = z.infer<typeof SettingsChangedEvent>;
