import type { InfinityBridge } from '../../shared/contracts/bridge';
import { SETTINGS } from '../../shared/contracts/settings';
import type { DismissalDtoType, SuggestionDismissRequestType, SuggestionListDismissedResponseType } from '../../shared/contracts/suggestions';
import { createStore, type Store } from '../state/store';
import { SuggestionMemory } from './suggestion-memory';

/** The settings detection and the card follow (D-094). */
export interface SuggestionSettings {
  suggestFromText: boolean;
  endOfDayTime: string;
  dateOnlyTime: string;
}

const SETTING_FIELDS = {
  'reminders.suggestFromText': 'suggestFromText',
  'reminders.endOfDayTime': 'endOfDayTime',
  'reminders.dateOnlyTime': 'dateOnlyTime',
} as const;
type SuggestionSettingKey = keyof typeof SETTING_FIELDS;

export const DISMISS_FAILED = 'Could not dismiss this suggestion.';

/**
 * What every window reads phrases with (D-089, D-091): main's reference instant and zones with the note's dismissals
 * (`suggestion:listDismissed`, at most one call in flight per note), the suggestion settings, and dismissals made here.
 * The renderer's own clock and zone are never used, so the E2E clock and zone seams apply.
 */
export class SuggestionContext {
  readonly settings: Store<SuggestionSettings> = createStore<SuggestionSettings>({
    suggestFromText: SETTINGS['reminders.suggestFromText'].default,
    endOfDayTime: SETTINGS['reminders.endOfDayTime'].default,
    dateOnlyTime: SETTINGS['reminders.dateOnlyTime'].default,
  });
  /** Phrases detected per note in this window session (D-091). */
  readonly memory = new SuggestionMemory();
  private readonly inFlight = new Map<string, Promise<SuggestionListDismissedResponseType | null>>();
  private readonly known = new Map<string, DismissalDtoType[]>();

  constructor(private readonly bridge: Pick<InfinityBridge, 'suggestion'>) {}

  /** A public setting value from `settings:get` or `settings:changed`; other keys and invalid values are ignored. */
  applySetting(key: string, value: unknown): void {
    if (!(key in SETTING_FIELDS)) return;
    const settingKey = key as SuggestionSettingKey;
    const parsed = SETTINGS[settingKey].schema.safeParse(value);
    if (parsed.success) this.settings.setState({ [SETTING_FIELDS[settingKey]]: parsed.data });
  }

  /** Main's reference context and the note's dismissals, read now (a call already in flight is shared). */
  load(noteId: string): Promise<SuggestionListDismissedResponseType | null> {
    const running = this.inFlight.get(noteId);
    if (running) return running;
    const call = this.bridge.suggestion
      .listDismissed({ noteId })
      .then((res) => {
        if (!res.ok) return null;
        // A dismissal made while this read was in flight is kept.
        const local = this.dismissalsOf(noteId).filter((d) => !res.data.dismissals.some((s) => sameDismissal(s, d)));
        this.known.set(noteId, [...local, ...res.data.dismissals]);
        return { ...res.data, dismissals: this.dismissalsOf(noteId) };
      })
      .finally(() => this.inFlight.delete(noteId));
    this.inFlight.set(noteId, call);
    return call;
  }

  /** The dismissals known for a note (the last read plus those made since). */
  dismissalsOf(noteId: string): DismissalDtoType[] {
    return this.known.get(noteId) ?? [];
  }

  /** Dismisses a phrase; it is suppressed here at once. False when main refused it. */
  async dismiss(req: SuggestionDismissRequestType): Promise<boolean> {
    const res = await this.bridge.suggestion.dismiss(req);
    if (!res.ok) return false;
    const list = this.dismissalsOf(req.noteId);
    if (!list.some((d) => sameDismissal(d, res.data.dismissal))) this.known.set(req.noteId, [res.data.dismissal, ...list]);
    return true;
  }
}

function sameDismissal(a: DismissalDtoType, b: DismissalDtoType): boolean {
  return a.blockId === b.blockId && a.text === b.text && a.spanOrdinal === b.spanOrdinal && a.referenceDate === b.referenceDate;
}
