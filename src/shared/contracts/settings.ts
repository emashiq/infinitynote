import { z } from 'zod';
import { ADD_FILES_MODES } from '../attachments/file-choice';
import { DEFAULT_DOCUMENT_MAX_MB, DEFAULT_IMAGE_MAX_MB, DOCUMENT_MAX_MB_RANGE, IMAGE_MAX_MB_RANGE } from '../attachments/limits';
import { isKnownZone } from '../time/zones';
import { AUTO_VERSION_DAYS_RANGE, AUTO_VERSION_MAX_RANGE, DEFAULT_AUTO_VERSION_DAYS, DEFAULT_AUTO_VERSION_MAX } from '../versions/retention';
import { HomeScope } from './home';
import { AUTO_LOCK_MINUTES, BLUR_STICKY_SECONDS, DEFAULT_AUTO_LOCK_MINUTES, DEFAULT_BLUR_STICKY_SECONDS } from './locks';
import { AutoBackupSetting, LastAutoBackup } from './portability';
import { FollowupInterval, FollowupMax, LocalTime, REMINDER_MESSAGES, ZoneId } from './reminders';
import { DEFAULT_SESSION, TabSession } from './session';
import { QuickStickySetting } from './shortcuts';
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

/** Days after which Trash is emptied automatically; null keeps it until the user empties it (D-034). */
export const TRASH_RETENTION_DAYS = [30, 90] as const;
export const TrashRetentionSetting = z.literal(TRASH_RETENTION_DAYS).nullable();

/**
 * Settings registry (D-041, D-045). Stored as {"v":<version>,"value":<value>}. `public: false` keys are main-only. A key
 * whose stored form changed has a newer version and an `upgrade` that turns an older stored value into the current one.
 */
export const SETTINGS = {
  'appearance.theme': { version: 1, schema: ThemeSetting, default: 'system', public: true },
  'layout.treeOpen': { version: 1, schema: z.boolean(), default: true, public: true },
  'layout.treeWidth': { version: 1, schema: z.number().int().min(220).max(280), default: 248, public: true },
  // The Details panel starts closed: the note view is only the text until it is opened (D-102).
  'layout.panelOpen': { version: 1, schema: z.boolean(), default: false, public: true },
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
  // The copy limit: version 2 (v0.2.0, D-108) caps it at 25 MB; larger version 1 values become 25.
  'attachments.documentMaxMb': {
    version: 2,
    schema: z.number().int().min(DOCUMENT_MAX_MB_RANGE.min).max(DOCUMENT_MAX_MB_RANGE.max),
    default: DEFAULT_DOCUMENT_MAX_MB,
    public: true,
    upgrade: (value: unknown): unknown => (typeof value === 'number' ? Math.min(value, DOCUMENT_MAX_MB_RANGE.max) : value),
  },
  'attachments.addFiles': { version: 1, schema: z.enum(ADD_FILES_MODES), default: 'ask', public: true },
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
  // Reminder suggestions from note text (D-094): the disclosed default times and the detection switch.
  'reminders.endOfDayTime': { version: 1, schema: LocalTime, default: '17:00', public: true },
  'reminders.dateOnlyTime': { version: 1, schema: LocalTime, default: '09:00', public: true },
  'reminders.suggestFromText': { version: 1, schema: z.boolean(), default: true, public: true },
  // Retention (INF-PORT-07, D-034, D-099).
  'retention.trashDays': { version: 1, schema: TrashRetentionSetting, default: null, public: true },
  'retention.autoVersionDays': {
    version: 1,
    schema: z.number().int().min(AUTO_VERSION_DAYS_RANGE.min).max(AUTO_VERSION_DAYS_RANGE.max),
    default: DEFAULT_AUTO_VERSION_DAYS,
    public: true,
  },
  'retention.autoVersionMax': {
    version: 1,
    schema: z.number().int().min(AUTO_VERSION_MAX_RANGE.min).max(AUTO_VERSION_MAX_RANGE.max),
    default: DEFAULT_AUTO_VERSION_MAX,
    public: true,
  },
  // Unlocked notes lock again after this many minutes without use (D-111).
  'locks.autoLockMinutes': { version: 1, schema: z.literal(AUTO_LOCK_MINUTES), default: DEFAULT_AUTO_LOCK_MINUTES, public: true },
  // A revealed locked sticky is blurred again after this many seconds without interaction in it (D-172).
  'locks.blurStickySeconds': { version: 1, schema: z.literal(BLUR_STICKY_SECONDS), default: DEFAULT_BLUR_STICKY_SECONDS, public: true },
  // Main-only: the folder comes from main's folder dialog, never from a renderer (backup:* channels, D-099).
  'backup.auto': { version: 1, schema: AutoBackupSetting, default: { enabled: false, directory: null, intervalDays: 7, keep: 5 }, public: false },
  'backup.lastAuto': { version: 1, schema: LastAutoBackup, default: null, public: false },
  // Main-only: written through shortcut:setGlobal, which registers it with the OS first (INF-KEY-05).
  'shortcut.quickSticky': { version: 1, schema: QuickStickySetting, default: { enabled: false, accelerator: 'CommandOrControl+Alt+N' }, public: false },
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
