import { z } from 'zod';
import { DEFAULT_DOCUMENT_MAX_MB, DEFAULT_IMAGE_MAX_MB, DOCUMENT_MAX_MB_RANGE, IMAGE_MAX_MB_RANGE } from '../attachments/limits';
import { isKnownZone } from '../time/zones';
import { HomeScope } from './home';
import { FollowupInterval, FollowupMax, LocalTime, REMINDER_MESSAGES, ZoneId } from './reminders';
import { DEFAULT_SESSION, TabSession } from './session';
import { CloseBehavior } from './windows';

export const ThemeSetting = z.enum(['system', 'light', 'dark']);

const EXPANDED_KEY_RE =
  /^(common|projects|favorites|trash|(project|folder):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const TreeExpandedSetting = z.array(z.string().regex(EXPANDED_KEY_RE)).max(5000);

/** Follow-ups new reminders start with (D-083); off by default, 15 minutes twice when switched on. */
export const FollowupDefaultSetting = z.strictObject({ enabled: z.boolean(), intervalMinutes: FollowupInterval, maxFollowups: FollowupMax });

/** Quiet hours in an explicit zone (INF-SCHED-06); the zone is stored when they are switched on. */
export const QuietHoursSetting = z
  .strictObject({ enabled: z.boolean(), start: LocalTime, end: LocalTime, zoneId: ZoneId.nullable() })
  .refine((q) => q.start !== q.end, 'Quiet hours must start and end at different times')
  .refine((q) => !q.enabled || q.zoneId !== null, 'Quiet hours need a time zone');

/** Settings registry (D-041, D-045). Stored as {"v":<version>,"value":<value>}. `public: false` keys are main-only. */
export const SETTINGS = {
  'appearance.theme': { version: 1, schema: ThemeSetting, default: 'system', public: true },
  'layout.treeOpen': { version: 1, schema: z.boolean(), default: true, public: true },
  'layout.treeWidth': { version: 1, schema: z.number().int().min(220).max(280), default: 248, public: true },
  'layout.panelOpen': { version: 1, schema: z.boolean(), default: true, public: true },
  'home.scope': { version: 1, schema: HomeScope, default: { kind: 'all' }, public: true },
  'tree.expanded': { version: 1, schema: TreeExpandedSetting, default: ['common', 'projects'], public: true },
  'session.tabs': { version: 1, schema: TabSession, default: DEFAULT_SESSION, public: false },
  // Public so Phase 08 adds only the Settings control (INF-PREF-05).
  'attachments.imageMaxMb': {
    version: 1,
    schema: z.number().int().min(IMAGE_MAX_MB_RANGE.min).max(IMAGE_MAX_MB_RANGE.max),
    default: DEFAULT_IMAGE_MAX_MB,
    public: true,
  },
  'attachments.documentMaxMb': {
    version: 1,
    schema: z.number().int().min(DOCUMENT_MAX_MB_RANGE.min).max(DOCUMENT_MAX_MB_RANGE.max),
    default: DEFAULT_DOCUMENT_MAX_MB,
    public: true,
  },
  'app.closeBehavior': { version: 1, schema: CloseBehavior, default: 'ask', public: true },
  'stickies.restoreOnStartup': { version: 1, schema: z.boolean(), default: false, public: true },
  // Null follows the computer's zone (D-083).
  'reminders.defaultZone': { version: 1, schema: ZoneId.nullable(), default: null, public: true },
  'reminders.followupDefault': {
    version: 1,
    schema: FollowupDefaultSetting,
    default: { enabled: false, intervalMinutes: 15, maxFollowups: 2 },
    public: true,
  },
  'reminders.quietHours': {
    version: 1,
    schema: QuietHoursSetting,
    default: { enabled: false, start: '22:00', end: '07:00', zoneId: null },
    public: true,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;

/**
 * Checks a schema-valid value against the runtime: a zone must be in the app's zone list (D-079). Returns the message
 * to show, or null when the value is usable. Kept apart from the schemas so the refusal names the problem.
 */
export function settingValueProblem(key: SettingKey, value: unknown): string | null {
  const zone = key === 'reminders.defaultZone' ? value : key === 'reminders.quietHours' ? (value as { zoneId?: unknown }).zoneId : null;
  return typeof zone === 'string' && !isKnownZone(zone) ? REMINDER_MESSAGES.chooseZone : null;
}
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export type PublicSettingKey = {
  [K in SettingKey]: (typeof SETTINGS)[K]['public'] extends true ? K : never;
}[SettingKey];
export const PUBLIC_SETTING_KEYS = SETTING_KEYS.filter((k) => SETTINGS[k].public) as PublicSettingKey[];

export const SettingKeySchema = z.enum(PUBLIC_SETTING_KEYS as [PublicSettingKey, ...PublicSettingKey[]]);

export const SettingsGetRequest = z.strictObject({
  keys: z
    .array(SettingKeySchema)
    .min(1)
    .max(50)
    .refine((keys) => new Set(keys).size === keys.length, 'Keys must be unique'),
});
export const SettingsGetResponse = z.strictObject({ values: z.record(z.string(), z.unknown()) });

function variant<K extends PublicSettingKey>(key: K) {
  return z.strictObject({ key: z.literal(key), value: SETTINGS[key].schema });
}
type Variant = ReturnType<typeof variant<PublicSettingKey>>;
const variants = PUBLIC_SETTING_KEYS.map((k) => variant(k));
export const SettingsSetRequest = z.discriminatedUnion('key', variants as unknown as [Variant, ...Variant[]]);

export const SettingsSetResponse = z.strictObject({
  key: SettingKeySchema,
  value: z.unknown(),
  updatedAt: z.number().int(),
});

export const SettingsChangedEvent = SettingsSetResponse;
export type SettingsChangedPayload = z.infer<typeof SettingsChangedEvent>;
