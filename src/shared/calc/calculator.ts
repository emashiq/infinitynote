import type { DateOrder } from '../time/typed-date';
import { evaluate, type CalcClock } from './evaluate';
import { isBare, isReservedWord, parse, readsVariables, type Expr } from './parse';
import { tokenize } from './tokenize';
import { CalcError, formatValue, type CalcValue } from './values';

/**
 * Math results in notes (D-188, D-189), on lines of text: a line `name = expression` defines a variable for the lines
 * below it; a line whose text ends with "=" asks for a result. Pure: the editor feeds it lines in document order.
 */

export interface CalcOptions extends CalcClock {
  /** The computer's order of day and month, for dates like 05/10/2026 (D-184). */
  dateOrder: DateOrder;
}

/** What a line says: an optional variable it defines, its expression, and the text after its last "=", if any. */
export interface LineReading {
  name: string | null;
  expression: string;
  /** The result written after the expression's "=", "" when nothing follows it, null when the line has none. */
  result: string | null;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reads `Lunch = 25` (a definition), `7 + 5 =` and `7 + 5 = 12` (calculations) and `Total = Lunch + 5 = 30` (both).
 * Anything else (no "=", more than three parts, an empty expression) is not math.
 */
export function readLine(line: string): LineReading | null {
  const parts = line.split('=').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const named = NAME.test(parts[0]!) && !isReservedWord(parts[0]!);
  if (named && parts[1] !== '') return { name: parts[0]!.toLowerCase(), expression: parts[1]!, result: parts.length === 3 ? parts[2]! : null };
  if (parts.length === 3 || parts[0] === '') return null;
  return { name: null, expression: parts[0]!, result: parts[1]! };
}

/** The text that goes after a line's "=": a space first when the line spaced its "=" and does not end with one. */
export function insertionFor(lineBeforeCaret: string, result: string): string {
  return /\s=$/.test(lineBeforeCaret) ? ` ${result}` : result;
}

/** A result for the editor: its text, and whether it reads variables (so it is recalculated when they change). */
export interface LineResult {
  text: string;
  readsVariables: boolean;
}

/**
 * Lines are fed in document order: `define` each line above, then ask about the line at hand. Later definitions
 * replace earlier ones; a definition whose expression has no value defines nothing.
 */
export class Calculator {
  private readonly variables = new Map<string, CalcValue>();
  /** Each definition with its value as written, in order: equal signatures mean equal variables everywhere. */
  private readonly defined: string[] = [];

  constructor(private readonly options: CalcOptions) {}

  /** Takes a line above the current one into account: a definition sets its variable. */
  define(line: string): void {
    const reading = readLine(line);
    if (!reading?.name) return;
    const value = this.value(reading.expression);
    if (!value) return;
    this.variables.set(reading.name, value.value);
    this.defined.push(`${reading.name}=${value.text}`);
  }

  /** What the definitions fed so far amount to. */
  signature(): string {
    return this.defined.join('\n');
  }

  /**
   * The result for a line whose text before the caret ends with "=" (and spaces): only for an expression with an
   * operator, a function, a percentage, a date or a duration; a bare number or word asks for nothing.
   */
  suggest(lineBeforeCaret: string): LineResult | null {
    if (!/=\s*$/.test(lineBeforeCaret)) return null;
    return this.resultOf(lineBeforeCaret);
  }

  /** The result of the calculation a line holds up to its "=" (the text before a result already written there). */
  resultOf(lineBeforeResult: string): LineResult | null {
    const reading = readLine(lineBeforeResult);
    if (!reading || reading.result === null || reading.result !== '') return null;
    const value = this.value(reading.expression);
    if (!value || isBare(value.expr)) return null;
    return { text: value.text, readsVariables: readsVariables(value.expr) };
  }

  /** An expression's tree, value and result text; null when it is not math or has no value. */
  private value(expression: string): { expr: Expr; value: CalcValue; text: string } | null {
    try {
      const expr = parse(tokenize(expression, this.options.dateOrder));
      const value = evaluate(expr, this.variables, this.options);
      return { expr, value, text: formatValue(value) };
    } catch (err) {
      if (err instanceof CalcError) return null;
      throw err;
    }
  }
}
