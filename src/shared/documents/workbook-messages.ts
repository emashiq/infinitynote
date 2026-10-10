import { MAX_WORKBOOK_FILE_MB, WORKBOOK_LIMITS } from './workbook';

const n = (value: number) => value.toLocaleString('en-US');

/** What the spreadsheet editor says (F3). Main and renderer use the same text. */
export const WORKBOOK_MESSAGES = {
  tooLargeFile: `This spreadsheet is larger than ${MAX_WORKBOOK_FILE_MB} MB, so Infinity Notes does not open it. Open it in your system app.`,
  tooManySheets: `This workbook has more than ${WORKBOOK_LIMITS.maxSheets} sheets, so Infinity Notes does not open it. Open it in your system app.`,
  sheetTooLarge: `A sheet of this workbook is larger than Infinity Notes edits (${n(WORKBOOK_LIMITS.maxGridCells)} cells in its used range). Open it in your system app.`,
  tooManyCells: `This workbook has more than ${n(WORKBOOK_LIMITS.maxCells)} filled cells, so Infinity Notes does not open it. Open it in your system app.`,
  textTooLong: `A cell, formula or note of this workbook is longer than Excel allows, so Infinity Notes does not open it.`,
  unreadable: 'This file is not a readable spreadsheet. It may be damaged, or macro-enabled (macros are not opened).',
  timedOut: 'Reading this spreadsheet took too long. Open it in your system app.',
  writeFailed: 'The spreadsheet could not be written.',
  failed: 'The spreadsheet editor could not be loaded.',
  csvValuesOnly: 'CSV files keep values only: formulas are saved as their results, and formatting, notes and other sheets are not saved.',
  simplifiedTitle: 'Saving simplifies this workbook',
  simplifiedIntro: 'Infinity Notes keeps values, formulas, formatting, merges, sizes, frozen panes, filters and notes. These parts of the file are not kept when it is saved:',
  simplifiedBanner: (count: number): string => `This workbook has ${count === 1 ? 'a feature' : `${count} features`} Infinity Notes does not keep. Saving removes ${count === 1 ? 'it' : 'them'}.`,
  invalidSheetName: 'Sheet names must be different from each other, at most 31 characters, and without \\ / ? * [ ] or :.',
  noMatches: 'No matches',
  sheetMissing: (name: string): string => `This workbook has no sheet named "${name}".`,
} as const;
