/**
 * Zone abbreviations a phrase may name (plan section 9.2.4). Each suggestion lists alias alternatives in order; the
 * first one the runtime knows is offered (ICU lists Asia/Calcutta, not Asia/Kolkata). UTC and GMT are not here: they
 * select the UTC zone without a choice.
 */
const ABBREVIATIONS: Readonly<Record<string, ReadonlyArray<readonly string[]>>> = {
  CST: [['America/Chicago'], ['Asia/Shanghai'], ['America/Havana']],
  CDT: [['America/Chicago'], ['America/Havana']],
  EST: [['America/New_York']],
  EDT: [['America/New_York']],
  PST: [['America/Los_Angeles'], ['Asia/Manila']],
  PDT: [['America/Los_Angeles']],
  MST: [['America/Denver'], ['America/Phoenix']],
  MDT: [['America/Denver']],
  IST: [['Asia/Kolkata', 'Asia/Calcutta'], ['Europe/Dublin'], ['Asia/Jerusalem']],
  BST: [['Europe/London'], ['Asia/Dhaka']],
  CET: [['Europe/Paris'], ['Europe/Berlin']],
  CEST: [['Europe/Paris'], ['Europe/Berlin']],
  JST: [['Asia/Tokyo']],
  AEST: [['Australia/Sydney']],
  AEDT: [['Australia/Sydney']],
  SGT: [['Asia/Singapore']],
  HKT: [['Asia/Hong_Kong']],
  PKT: [['Asia/Karachi']],
  NPT: [['Asia/Kathmandu', 'Asia/Katmandu']],
};

export const ZONE_ABBREVIATIONS: readonly string[] = Object.keys(ABBREVIATIONS);

/** The zones an abbreviation may mean, in order, each as the first alias `isKnown` accepts. */
export function zoneSuggestions(abbr: string, isKnown: (zoneId: string) => boolean): string[] {
  return (ABBREVIATIONS[abbr] ?? []).flatMap((aliases) => {
    const known = aliases.find(isKnown);
    return known ? [known] : [];
  });
}
