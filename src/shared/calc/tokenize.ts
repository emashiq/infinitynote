import { readTypedDate, type DateOrder } from '../time/typed-date';
import { CalcError } from './values';

/** A date written in the text; the year is left out in "Dec 25" (this year then). */
export interface DateLiteral {
  year: number | null;
  month: number;
  day: number;
  time: { hour: number; minute: number } | null;
}

export type Token =
  | { type: 'number'; value: number }
  | { type: 'date'; date: DateLiteral }
  /** A name, keyword, unit or function, lowercased. */
  | { type: 'word'; word: string }
  | { type: 'op'; op: '+' | '-' | '*' | '/' | '^' | '%' }
  | { type: '(' }
  | { type: ')' }
  | { type: ',' };

/** Longest expression the calculator reads (a line before its "="). */
export const MAX_EXPRESSION_CHARS = 500;
const MAX_TOKENS = 200;

/** Functions take their arguments in parentheses; inside them a comma separates arguments, never thousands. */
export const FUNCTIONS: ReadonlySet<string> = new Set(['sqrt', 'abs', 'round', 'floor', 'ceil', 'min', 'max', 'log', 'ln', 'sin', 'cos', 'tan']);

const MONTH_NAMES = String.raw`jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?`;
const ORDINAL = String.raw`(?:st|nd|rd|th)?`;
const TIME = String.raw`(?:,?\s+(\d{1,2}):(\d{2}))?`;
/** Nothing that continues a word or a number may follow a date. */
const END = String.raw`(?![\p{L}\p{N}_]|\.\d)`;
const TYPED_DATE = new RegExp(String.raw`(?:\d{4}([-/.])\d{1,2}\1\d{1,2}|\d{1,2}([-/.])\d{1,2}\2\d{4})${END}`, 'uy');
const DAY_MONTH = new RegExp(String.raw`(\d{1,2})${ORDINAL}\s+(${MONTH_NAMES})\.?(?:,?\s+(\d{4}))?${TIME}${END}`, 'iuy');
const MONTH_DAY = new RegExp(String.raw`(${MONTH_NAMES})\.?\s+(\d{1,2})${ORDINAL}(?:,?\s+(\d{4}))?${TIME}${END}`, 'iuy');
const GROUPED_NUMBER = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?/iy;
const PLAIN_NUMBER = /\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?/iy;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;
const OPERATORS: Readonly<Record<string, Extract<Token, { type: 'op' }>['op']>> = { '+': '+', '-': '-', '*': '*', '/': '/', '^': '^', '%': '%' };

/** One spelling for every operator and space: "×" and "·" multiply, "÷" divides, "−" subtracts, "π" is pi. */
function normalize(text: string): string {
  return text
    .replace(/\s/g, ' ')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/π/g, ' pi ');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNumber = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

function timeOf(hour: string | undefined, minute: string | undefined): DateLiteral['time'] {
  if (hour === undefined || minute === undefined) return null;
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) throw new CalcError('Not a time of day');
  return { hour: h, minute: m };
}

/** A date starting at `at`: typed (`14-10-2026`, the computer's order when ambiguous) or with a month name. */
function dateAt(text: string, at: number, order: DateOrder): { date: DateLiteral; end: number } | null {
  TYPED_DATE.lastIndex = at;
  const typed = TYPED_DATE.exec(text);
  if (typed) {
    const parts = readTypedDate(typed[0], order);
    // "31-02-2026" is no date, and no subtraction either.
    if (!parts) throw new CalcError('Not a date');
    return { date: { year: parts.year, month: parts.month, day: parts.day, time: null }, end: TYPED_DATE.lastIndex };
  }
  DAY_MONTH.lastIndex = at;
  const dayFirst = DAY_MONTH.exec(text);
  if (dayFirst) {
    const date = { year: dayFirst[3] ? Number(dayFirst[3]) : null, month: monthNumber(dayFirst[2]!), day: Number(dayFirst[1]), time: timeOf(dayFirst[4], dayFirst[5]) };
    return { date, end: DAY_MONTH.lastIndex };
  }
  MONTH_DAY.lastIndex = at;
  const monthFirst = MONTH_DAY.exec(text);
  if (monthFirst) {
    const date = { year: monthFirst[3] ? Number(monthFirst[3]) : null, month: monthNumber(monthFirst[1]!), day: Number(monthFirst[2]), time: timeOf(monthFirst[4], monthFirst[5]) };
    return { date, end: MONTH_DAY.lastIndex };
  }
  return null;
}

/**
 * The tokens of an expression. Dates are read before numbers, so `14-10-2026` is a date and not two subtractions. A
 * number may group thousands with commas (`1,200.50`) except inside a function's parentheses, where commas separate
 * the arguments.
 */
export function tokenize(source: string, order: DateOrder): Token[] {
  if (source.length > MAX_EXPRESSION_CHARS) throw new CalcError('The expression is too long');
  const text = normalize(source);
  const tokens: Token[] = [];
  /** For each open parenthesis: does it hold a function's arguments? */
  const parens: boolean[] = [];
  let at = 0;
  while (at < text.length) {
    if (tokens.length > MAX_TOKENS) throw new CalcError('The expression is too long');
    const char = text[at]!;
    if (char === ' ') {
      at += 1;
      continue;
    }
    const startsWord = at === 0 || !/[\p{L}\p{N}_.]/u.test(text[at - 1]!);
    const date = startsWord ? dateAt(text, at, order) : null;
    if (date) {
      tokens.push({ type: 'date', date: date.date });
      at = date.end;
      continue;
    }
    if (/[\d.]/.test(char)) {
      const pattern = parens.at(-1) ? PLAIN_NUMBER : GROUPED_NUMBER;
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      if (!match) throw new CalcError('Not a number');
      tokens.push({ type: 'number', value: Number(match[0].replace(/,/g, '')) });
      at = pattern.lastIndex;
      continue;
    }
    WORD.lastIndex = at;
    const word = WORD.exec(text);
    if (word) {
      tokens.push({ type: 'word', word: word[0].toLowerCase() });
      at = WORD.lastIndex;
      continue;
    }
    const operator = OPERATORS[char];
    if (operator) tokens.push({ type: 'op', op: operator });
    else if (char === '(') {
      const previous = tokens.at(-1);
      parens.push(previous?.type === 'word' && FUNCTIONS.has(previous.word));
      tokens.push({ type: '(' });
    } else if (char === ')') {
      parens.pop();
      tokens.push({ type: ')' });
    } else if (char === ',') tokens.push({ type: ',' });
    else throw new CalcError('Not part of an expression');
    at += 1;
  }
  return tokens;
}
