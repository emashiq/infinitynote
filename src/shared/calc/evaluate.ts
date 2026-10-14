import { DateTime } from 'luxon';
import type { BinaryOperator, DateWord, Expr } from './parse';
import type { DateLiteral } from './tokenize';
import { amountIn, CALENDAR_UNITS, CalcError, smallerUnit, type CalcValue, type DurationUnit } from './values';

/** When and where "today" is: the reference instant and the zone dates are counted in. */
export interface CalcClock {
  now: number;
  zone: string;
}

export type Variables = ReadonlyMap<string, CalcValue>;

type Num = Extract<CalcValue, { kind: 'number' }>;
type Percent = Extract<CalcValue, { kind: 'percent' }>;
type DateValue = Extract<CalcValue, { kind: 'date' }>;
type Duration = Extract<CalcValue, { kind: 'duration' }>;

const number = (value: number): Num => {
  if (!Number.isFinite(value)) throw new CalcError('The result is not a finite number');
  return { kind: 'number', value };
};
const percent = (value: number): Percent => ({ kind: 'percent', value: number(value).value });
const duration = (amount: number, unit: DurationUnit): Duration => ({ kind: 'duration', amount: number(amount).value, unit });

const RADIANS_PER_DEGREE = Math.PI / 180;
const MAX_ROUND_DIGITS = 10;

/** The functions, on numbers only; trigonometry takes degrees. Each checks its argument count and domain. */
const FUNCTIONS: Readonly<Record<string, (args: number[]) => number>> = {
  sqrt: one((x) => (x < 0 ? fail('No square root of a negative number') : Math.sqrt(x))),
  abs: one(Math.abs),
  floor: one(Math.floor),
  ceil: one(Math.ceil),
  round: (args) => {
    const [x, digits = 0] = arity(args, 1, 2);
    if (!Number.isInteger(digits) || digits < 0 || digits > MAX_ROUND_DIGITS) fail('round takes 0 to 10 digits');
    const factor = 10 ** digits;
    return Math.round(x! * factor) / factor;
  },
  min: (args) => Math.min(...arity(args, 1, Infinity)),
  max: (args) => Math.max(...arity(args, 1, Infinity)),
  log: one((x) => (x <= 0 ? fail('No logarithm of zero or less') : Math.log10(x))),
  ln: one((x) => (x <= 0 ? fail('No logarithm of zero or less') : Math.log(x))),
  sin: one((x) => Math.sin(x * RADIANS_PER_DEGREE)),
  cos: one((x) => Math.cos(x * RADIANS_PER_DEGREE)),
  tan: one((x) => Math.tan(x * RADIANS_PER_DEGREE)),
};

function fail(message: string): never {
  throw new CalcError(message);
}

function arity(args: number[], min: number, max: number): number[] {
  if (args.length < min || args.length > max) fail('Wrong number of arguments');
  return args;
}

function one(fn: (x: number) => number): (args: number[]) => number {
  return (args) => fn(arity(args, 1, 1)[0]!);
}

/**
 * Evaluates an expression tree (D-188). Percentages follow Soulver: `20% of 50` is 10, `50 + 10%` is 55, `10% * 30`
 * is 3. Dates are calendar dates in the clock's zone: `date - date` is days, `date ± duration` moves by whole calendar
 * units (a month from 31 January ends in February), durations add, scale and divide. Anything else is an error, never
 * a guess.
 */
export function evaluate(expr: Expr, variables: Variables, clock: CalcClock): CalcValue {
  const today = DateTime.fromMillis(clock.now, { zone: clock.zone }).startOf('day');
  const ev = (e: Expr): CalcValue => {
    switch (e.type) {
      case 'number':
        return number(e.value);
      case 'constant':
        return number(e.name === 'pi' ? Math.PI : Math.E);
      case 'date':
        return literalDate(e.date, today);
      case 'dateWord':
        return dateWord(e.word, today, clock);
      case 'variable':
        return variables.get(e.name) ?? fail(`${e.name} is not defined above`);
      case 'negate':
        return negate(ev(e.operand));
      case 'percent':
        return percent(asNumber(ev(e.operand)));
      case 'duration':
        return duration(asNumber(ev(e.operand)), e.unit);
      case 'convert': {
        const value = ev(e.operand);
        if (value.kind !== 'duration') fail('Only a duration converts to another unit');
        return duration(amountIn(value, e.unit), e.unit);
      }
      case 'binary':
        return binary(e.op, ev(e.left), ev(e.right));
      case 'call': {
        const fn = FUNCTIONS[e.name] ?? fail(`Unknown function ${e.name}`);
        return number(fn(e.args.map((a) => asNumber(ev(a)))));
      }
    }
  };
  return ev(expr);
}

function asNumber(v: CalcValue): number {
  return v.kind === 'number' ? v.value : fail('A number is needed here');
}

function literalDate(d: DateLiteral, today: DateTime): DateValue {
  const value = DateTime.fromObject({ year: d.year ?? today.year, month: d.month, day: d.day, hour: d.time?.hour ?? 0, minute: d.time?.minute ?? 0 }, { zone: today.zone });
  if (!value.isValid || value.day !== d.day) fail('Not a date');
  return { kind: 'date', value, hasTime: d.time !== null };
}

function dateWord(word: DateWord, today: DateTime, clock: CalcClock): DateValue {
  if (word === 'now') return { kind: 'date', value: DateTime.fromMillis(clock.now, { zone: clock.zone }), hasTime: true };
  return { kind: 'date', value: today.plus({ days: word === 'tomorrow' ? 1 : word === 'yesterday' ? -1 : 0 }), hasTime: false };
}

function negate(v: CalcValue): CalcValue {
  switch (v.kind) {
    case 'number':
      return number(-v.value);
    case 'percent':
      return percent(-v.value);
    case 'duration':
      return duration(-v.amount, v.unit);
    case 'date':
      return fail('A date has no sign');
  }
}

function binary(op: BinaryOperator, a: CalcValue, b: CalcValue): CalcValue {
  switch (op) {
    case '+':
    case '-':
      return addOrSubtract(op === '+' ? 1 : -1, a, b);
    case '*':
      if (a.kind === 'number' && b.kind === 'number') return number(a.value * b.value);
      if (a.kind === 'percent' && b.kind === 'number') return number((a.value / 100) * b.value);
      if (a.kind === 'number' && b.kind === 'percent') return number(a.value * (b.value / 100));
      if (a.kind === 'duration' && b.kind === 'number') return duration(a.amount * b.value, a.unit);
      if (a.kind === 'number' && b.kind === 'duration') return duration(a.value * b.amount, b.unit);
      return fail('These cannot be multiplied');
    case '/': {
      const divisor = b.kind === 'number' ? b.value : b.kind === 'percent' ? b.value / 100 : null;
      if (divisor === 0) fail('Division by zero');
      if (a.kind === 'number' && divisor !== null) return number(a.value / divisor);
      if (a.kind === 'percent' && b.kind === 'number') return percent(a.value / b.value);
      if (a.kind === 'duration' && b.kind === 'number') return duration(a.amount / b.value, a.unit);
      if (a.kind === 'duration' && b.kind === 'duration') {
        const by = amountIn(b, a.unit);
        return by === 0 ? fail('Division by zero') : number(a.amount / by);
      }
      return fail('These cannot be divided');
    }
    case 'mod':
      if (a.kind !== 'number' || b.kind !== 'number') fail('mod takes numbers');
      return b.value === 0 ? fail('Division by zero') : number(a.value % b.value);
    case '^':
      return number(Math.pow(asNumber(a), asNumber(b)));
    case 'of':
      if (a.kind !== 'percent') fail('"of" follows a percentage');
      if (b.kind === 'number') return number((a.value / 100) * b.value);
      if (b.kind === 'duration') return duration((a.value / 100) * b.amount, b.unit);
      return fail('A percentage of this is not defined');
  }
}

function addOrSubtract(sign: 1 | -1, a: CalcValue, b: CalcValue): CalcValue {
  if (a.kind === 'number' && b.kind === 'number') return number(a.value + sign * b.value);
  // Soulver: 50 + 10% is 55 and 50 - 10% is 45.
  if (a.kind === 'number' && b.kind === 'percent') return number(a.value * (1 + (sign * b.value) / 100));
  if (a.kind === 'percent' && b.kind === 'percent') return percent(a.value + sign * b.value);
  if (a.kind === 'date' && b.kind === 'duration') return moveDate(a, b, sign);
  if (a.kind === 'duration' && b.kind === 'date' && sign === 1) return moveDate(b, a, 1);
  if (a.kind === 'date' && b.kind === 'date' && sign === -1) return between(b, a);
  if (a.kind === 'duration' && b.kind === 'duration') {
    const unit = smallerUnit(a.unit, b.unit);
    return duration(amountIn(a, unit) + sign * amountIn(b, unit), unit);
  }
  return fail('These cannot be added or subtracted');
}

/** A date moved by a duration: whole days, weeks, months or years on the calendar, any amount of hours or less. */
function moveDate(date: DateValue, by: Duration, sign: 1 | -1): DateValue {
  if (CALENDAR_UNITS.has(by.unit) && !Number.isInteger(by.amount)) fail('A date moves by whole days, weeks, months or years');
  const value = date.value.plus({ [`${by.unit}s`]: sign * by.amount });
  if (!value.isValid) fail('The date is out of range');
  return { kind: 'date', value, hasTime: date.hasTime || !CALENDAR_UNITS.has(by.unit) };
}

/** The days from one date to another (negative when it is earlier), kept with the dates for conversions. */
function between(from: DateValue, to: DateValue): Duration {
  const days = to.value.diff(from.value, 'days').days;
  return { ...duration(days, 'day'), span: { from: from.value, to: to.value } };
}
