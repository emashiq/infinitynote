import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { Calculator, insertionFor, readLine, type CalcOptions } from '../../src/shared/calc/calculator';
import type { DateOrder } from '../../src/shared/time/typed-date';

/** Wednesday 14 October 2026, 10:00 in Dhaka (no daylight saving there). */
const DHAKA: CalcOptions = { now: DateTime.fromISO('2026-10-14T10:00', { zone: 'Asia/Dhaka' }).toMillis(), zone: 'Asia/Dhaka', dateOrder: 'day-first' };

/** The suggestion for the last line after the definitions above it, or null. */
function result(line: string, above: string[] = [], options: CalcOptions = DHAKA): string | null {
  const calc = new Calculator(options);
  for (const l of above) calc.define(l);
  return calc.suggest(line)?.text ?? null;
}

const order = (dateOrder: DateOrder): CalcOptions => ({ ...DHAKA, dateOrder });

describe('note math: arithmetic (D-188)', () => {
  it('follows standard precedence, right-associative powers and unary minus', () => {
    expect(result('7+5=')).toBe('12');
    expect(result('2 + 3 * 4 =')).toBe('14');
    expect(result('(2 + 3) * 4 =')).toBe('20');
    expect(result('10 - 4 - 3 =')).toBe('3');
    expect(result('12 / 4 / 3 =')).toBe('1');
    expect(result('2^3^2 =')).toBe('512');
    expect(result('-2^2 =')).toBe('-4');
    expect(result('(-2)^2 =')).toBe('4');
    expect(result('2^-1 =')).toBe('0.5');
    expect(result('7 mod 3 =')).toBe('1');
    expect(result('-3 + +5 =')).toBe('2');
  });

  it('reads ×, ÷, the minus sign, grouped thousands and exponents', () => {
    expect(result('2 × 3 ÷ 4 =')).toBe('1.5');
    expect(result('8 − 3 =')).toBe('5');
    expect(result('1,200.50 + 1 =')).toBe('1201.5');
    expect(result('12,345,678 * 2 =')).toBe('24691356');
    expect(result('1.2e3 * 2 =')).toBe('2400');
    expect(result('.5 + .25 =')).toBe('0.75');
  });

  it('writes up to 10 significant digits without trailing zeros or grouping', () => {
    expect(result('0.1 + 0.2 =')).toBe('0.3');
    expect(result('1 / 3 =')).toBe('0.3333333333');
    expect(result('2/3=')).toBe('0.6666666667');
    expect(result('1e21 * 10 =')).toBe('1e+22');
    expect(result('123456789012 + 0 =')).toBe('123456789000');
    expect(result('0 * -1 =')).toBe('0');
  });

  it('has functions (trigonometry in degrees) and the constants pi and e', () => {
    expect(result('sqrt(16) + 1 =')).toBe('5');
    expect(result('abs(-3) * 2 =')).toBe('6');
    expect(result('round(2.567, 2) =')).toBe('2.57');
    expect(result('round(2.5) =')).toBe('3');
    expect(result('floor(2.7) + ceil(2.1) =')).toBe('5');
    expect(result('max(1, 200, 3) =')).toBe('200');
    // Inside a function's parentheses a comma separates arguments.
    expect(result('max(1,200) =')).toBe('200');
    expect(result('min(4, 2) =')).toBe('2');
    expect(result('log(1000) =')).toBe('3');
    expect(result('ln(e) =')).toBe('1');
    expect(result('sin(30) =')).toBe('0.5');
    expect(result('cos(60) =')).toBe('0.5');
    expect(result('tan(45) =')).toBe('1');
    expect(result('pi * 2 =')).toBe('6.283185307');
    expect(result('π * 2 =')).toBe('6.283185307');
  });

  it('gives no result for errors: domains, division by zero, argument counts, unknown functions', () => {
    for (const line of ['sqrt(-1) =', 'log(0) =', 'ln(-2) =', '1 / 0 =', '5 mod 0 =', 'sqrt 16 =', 'max() =', 'round(1, 11) =', 'round(1, 2, 3) =', 'foo(2) =', '10^400 =', '(1 + 2 =', '1 + 2) =', '2 3 =', '1,2 =']) {
      expect(result(line), line).toBeNull();
    }
  });
});

describe('note math: percentages (Soulver semantics)', () => {
  it('reads "of", adds and subtracts a share, multiplies and divides by a percentage', () => {
    expect(result('20% of 50 =')).toBe('10');
    expect(result('50 + 10% =')).toBe('55');
    expect(result('50 - 10% =')).toBe('45');
    expect(result('10% * 30 =')).toBe('3');
    expect(result('30 * 10% =')).toBe('3');
    expect(result('200 / 10% =')).toBe('2000');
    expect(result('10% + 5% =')).toBe('15%');
    expect(result('10% =')).toBe('10%');
    expect(result('50% of 3 weeks =')).toBe('1.5 weeks');
    expect(result('20% of 50 + 10 =')).toBe('20');
  });

  it('gives no result where a percentage has no meaning', () => {
    for (const line of ['10% + 5 =', '10% * 10% =', '50 of 20 =', 'sqrt(10%) =', '10%^2 =']) expect(result(line), line).toBeNull();
  });
});

describe('note math: variables', () => {
  it('uses variables defined on lines above, case-insensitively; later definitions replace earlier ones', () => {
    expect(result('Lunch + Dinner =', ['Lunch = 25', 'Dinner = 40'])).toBe('65');
    expect(result('lunch * 2 =', ['Lunch = 25'])).toBe('50');
    expect(result('x * 10 =', ['x = 1', 'x = 2'])).toBe('20');
    expect(result('b + 1 =', ['a = 2', 'b = a * 3'])).toBe('7');
    expect(result('deadline - today =', ['deadline = 25-12-2026'])).toBe('72 days');
  });

  it('defines and calculates on one line: "Total = Lunch + Dinner =" suggests 65 and defines Total', () => {
    const calc = new Calculator(DHAKA);
    calc.define('Lunch = 25');
    calc.define('Dinner = 40');
    expect(calc.suggest('Total = Lunch + Dinner =')?.text).toBe('65');
    calc.define('Total = Lunch + Dinner = 65');
    expect(calc.suggest('Total / 5 =')).toEqual({ text: '13', readsVariables: true });
  });

  it('does not define reserved names, nor a variable whose expression has no value', () => {
    expect(result('today + 1 day =', ['today = 5'])).toBe('Oct 15, 2026');
    expect(result('x + 1 =', ['days = 3', 'x = days'])).toBeNull();
    expect(result('y + 1 =', ['y = 1 / 0'])).toBeNull();
    expect(result('undefinedName + 1 =')).toBeNull();
  });

  it('changes its signature only when a variable changes', () => {
    const signature = (lines: string[]) => {
      const calc = new Calculator(DHAKA);
      for (const l of lines) calc.define(l);
      return calc.signature();
    };
    expect(signature(['a = 2', '7 + 5 = 12'])).toBe(signature(['a = 1 + 1', 'some words']));
    expect(signature(['a = 2'])).not.toBe(signature(['a = 3']));
  });
});

describe('note math: what triggers a result', () => {
  it('needs an operator, a function, a percentage, a date or a duration before a final "="', () => {
    for (const line of ['12 =', '-12 =', '(12) =', 'pi =', 'Lunch =', 'hello world =', '7 + 5', '7 + 5 = 12', 'a == b', '= 5', '', 'x = 5 =']) {
      expect(result(line, ['Lunch = 25']), line).toBeNull();
    }
    expect(result('7 + 5 =   ')).toBe('12');
    expect(result('today =')).toBe('Oct 14, 2026');
    expect(result('3 days =')).toBe('3 days');
    expect(result('1 day =')).toBe('1 day');
  });

  it('reads definition and calculation lines', () => {
    expect(readLine('Lunch = 25')).toEqual({ name: 'lunch', expression: '25', result: null });
    expect(readLine('7 + 5 =')).toEqual({ name: null, expression: '7 + 5', result: '' });
    expect(readLine('7 + 5 = 12')).toEqual({ name: null, expression: '7 + 5', result: '12' });
    expect(readLine('Total = a + b = 30')).toEqual({ name: 'total', expression: 'a + b', result: '30' });
    expect(readLine('no math here')).toBeNull();
    expect(readLine('a = b = c = d')).toBeNull();
  });

  it('spaces the inserted result as the "=" was spaced', () => {
    expect(insertionFor('7 + 5 =', '12')).toBe(' 12');
    expect(insertionFor('7+5=', '12')).toBe('12');
    expect(insertionFor('7 + 5 = ', '12')).toBe('12');
  });

  it('bounds its input: very long lines and deep nesting give no result', () => {
    expect(result(`${'1+'.repeat(300)}1 =`)).toBeNull();
    expect(result(`${'('.repeat(100)}1${')'.repeat(100)} + 1 =`)).toBeNull();
    expect(result(`${'('.repeat(30)}1${')'.repeat(30)} + 1 =`)).toBe('2');
  });

  it('never runs code: no eval or Function anywhere in the calculator', () => {
    const dir = path.resolve('src/shared/calc');
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/);
    }
  });
});

describe('note math: dates and durations', () => {
  it('subtracts dates in days and moves dates by durations (the plan examples)', () => {
    expect(result('25-12-2026 - today =')).toBe('72 days');
    expect(result('today + 3 weeks =')).toBe('Nov 4, 2026');
    expect(result('tomorrow - yesterday =')).toBe('2 days');
    expect(result('today - 25-12-2026 =')).toBe('-72 days');
    expect(result('today + 5 months =')).toBe('Mar 14, 2027');
    expect(result('today + 1 year =')).toBe('Oct 14, 2027');
    expect(result('Oct 14, 2026 - 1 week =')).toBe('Oct 7, 2026');
  });

  it('reads typed, ISO and month-name dates; the year of "Dec 25" is this year', () => {
    expect(result('14/10/2026 + 1 day =')).toBe('Oct 15, 2026');
    expect(result('14.10.2026 + 1 day =')).toBe('Oct 15, 2026');
    expect(result('2026-10-14 + 2 days =')).toBe('Oct 16, 2026');
    expect(result('10/14/2026 + 1 day =')).toBe('Oct 15, 2026');
    expect(result('Oct 14 2026 + 1 day =')).toBe('Oct 15, 2026');
    expect(result('14 October 2026 - 1 day =')).toBe('Oct 13, 2026');
    expect(result('Dec 25 - today =')).toBe('72 days');
    expect(result('25th Dec - today =')).toBe('72 days');
  });

  it('follows the computer order only for day and month that could be either way round (D-184)', () => {
    expect(result('05/10/2026 + 0 days =', [], order('day-first'))).toBe('Oct 5, 2026');
    expect(result('05/10/2026 + 0 days =', [], order('month-first'))).toBe('May 10, 2026');
    expect(result('25/10/2026 + 0 days =', [], order('month-first'))).toBe('Oct 25, 2026');
  });

  it('converts with "in", adds and scales durations', () => {
    expect(result('25-12-2026 - today in weeks =')).toBe('10.28571429 weeks');
    expect(result('25-12-2026 - 25-12-2025 in months =')).toBe('12 months');
    expect(result('3 weeks in days =')).toBe('21 days');
    expect(result('1 year in months =')).toBe('12 months');
    expect(result('3 days + 2 weeks =')).toBe('17 days');
    expect(result('30 min + 4 hours =')).toBe('270 minutes');
    expect(result('2 weeks * 3 =')).toBe('6 weeks');
    expect(result('2 * 3 weeks =')).toBe('6 weeks');
    expect(result('6 weeks / 2 weeks =')).toBe('3');
    expect(result('9 days / 3 =')).toBe('3 days');
    expect(result('-(2 days) =')).toBe('-2 days');
  });

  it('gives a date and time for now and for hours on a date', () => {
    expect(result('now + 4 hours =')).toBe('Oct 14, 2026 14:00');
    expect(result('today + 90 min =')).toBe('Oct 14, 2026 01:30');
    expect(result('Oct 14, 2026 14:00 + 1 hour =')).toBe('Oct 14, 2026 15:00');
  });

  it('keeps month ends and leap years on the calendar', () => {
    expect(result('Jan 31 2026 + 1 month =')).toBe('Feb 28, 2026');
    expect(result('Jan 31 2028 + 1 month =')).toBe('Feb 29, 2028');
    expect(result('Feb 29 2028 + 1 year =')).toBe('Feb 28, 2029');
    expect(result('29-02-2028 + 1 day =')).toBe('Mar 1, 2028');
    expect(result('Mar 1 2028 - Feb 1 2028 =')).toBe('29 days');
    expect(result('29-02-2027 + 1 day =')).toBeNull();
    expect(result('31-02-2026 - today =')).toBeNull();
    expect(result('Feb 30 2026 + 1 day =')).toBeNull();
  });

  it('counts calendar days across daylight saving changes', () => {
    const newYork = (iso: string): CalcOptions => ({ now: DateTime.fromISO(iso, { zone: 'America/New_York' }).toMillis(), zone: 'America/New_York', dateOrder: 'month-first' });
    const march = newYork('2026-03-07T12:00');
    expect(result('Mar 9 2026 - Mar 7 2026 =', [], march)).toBe('2 days');
    expect(result('Mar 7 2026 + 1 day =', [], march)).toBe('Mar 8, 2026');
    expect(result('Nov 2 2026 - Oct 31 2026 =', [], march)).toBe('2 days');
    // A day on the calendar keeps the time of day; 24 hours do not across the change.
    expect(result('now + 1 day =', [], march)).toBe('Mar 8, 2026 12:00');
    expect(result('now + 24 hours =', [], march)).toBe('Mar 8, 2026 13:00');
  });

  it('gives no result for date arithmetic without a meaning', () => {
    for (const line of ['today + today =', '5 + today =', 'today * 2 =', 'today + 1.5 days =', 'today in days =', '-today =', 'today + 5 =', '3 days + 2 =']) {
      expect(result(line), line).toBeNull();
    }
  });

  it('reads every result it writes back', () => {
    expect(result('Nov 4, 2026 - today =')).toBe('21 days');
    expect(result('72 days * 2 =')).toBe('144 days');
    expect(result('0.3333333333 * 3 =')).toBe('0.9999999999');
    expect(result('1e+22 / 10 =')).toBe('1e+21');
    expect(result('15% of 200 =')).toBe('30');
    expect(result('10.28571429 weeks in days =')).toBe('72.00000003 days');
  });
});
