import { describe, expect, it } from 'vitest';
import { dateOrderOf, parseTypedDate, type DateOrder } from '../../src/shared/time/typed-date';

/** Excel day numbers of a few dates (the 1900 date system). */
const OCT_10_2026 = 46305;
const OCT_25_2026 = 46320;
const MAY_10_2026 = 46152;

const parse = (text: string, order: DateOrder = 'day-first') => parseTypedDate(text, order);

describe('typed dates (D-184)', () => {
  it('reads day-first dates with -, / and . and keeps the typed look in the format', () => {
    expect(parse('10-10-2026')).toEqual({ serial: OCT_10_2026, format: 'dd-mm-yyyy' });
    expect(parse('25-10-2026')).toEqual({ serial: OCT_25_2026, format: 'dd-mm-yyyy' });
    expect(parse('25/10/2026')).toEqual({ serial: OCT_25_2026, format: 'dd/mm/yyyy' });
    expect(parse('25.10.2026')).toEqual({ serial: OCT_25_2026, format: 'dd"."mm"."yyyy' });
    expect(parse('5-3-2026')).toEqual({ serial: 46086, format: 'd-m-yyyy' });
    expect(parse('5-03-2026')?.format).toBe('d-mm-yyyy');
  });

  it('reads month-first and year-first dates', () => {
    expect(parse('10/25/2026')).toEqual({ serial: OCT_25_2026, format: 'mm/dd/yyyy' });
    expect(parse('2026-10-25')).toEqual({ serial: OCT_25_2026, format: 'yyyy-mm-dd' });
    expect(parse('2026-5-9')).toEqual({ serial: MAY_10_2026 - 1, format: 'yyyy-m-d' });
    expect(parse('2026/10/25')?.format).toBe('yyyy/mm/dd');
    expect(parse('2026.10.25')?.format).toBe('yyyy"."mm"."dd');
  });

  it('follows the computer order only when day and month could be either way round', () => {
    expect(parse('05/10/2026', 'day-first')).toEqual({ serial: OCT_10_2026 - 5, format: 'dd/mm/yyyy' });
    expect(parse('05/10/2026', 'month-first')).toEqual({ serial: MAY_10_2026, format: 'mm/dd/yyyy' });
    expect(parse('10-10-2026', 'month-first')?.serial).toBe(OCT_10_2026);
    // A part over 12 can only be the day, whatever the computer's order.
    expect(parse('25.10.2026', 'month-first')?.serial).toBe(OCT_25_2026);
    expect(parse('10/25/2026', 'day-first')?.serial).toBe(OCT_25_2026);
    expect(parse('10-13-2026', 'day-first')).toEqual({ serial: OCT_10_2026 + 3, format: 'mm-dd-yyyy' });
    expect(parse('2026-05-10', 'day-first')?.serial).toBe(MAY_10_2026);
  });

  it('adds a time of day, 24-hour or with AM/PM', () => {
    expect(parse('10-10-2026 14:30')).toEqual({ serial: OCT_10_2026 + 14.5 / 24, format: 'dd-mm-yyyy hh:mm' });
    expect(parse('10-10-2026 9:05:30')).toEqual({ serial: OCT_10_2026 + (9 * 3600 + 5 * 60 + 30) / 86_400, format: 'dd-mm-yyyy h:mm:ss' });
    expect(parse('10/25/2026 2:30 PM', 'month-first')).toEqual({ serial: OCT_25_2026 + 14.5 / 24, format: 'mm/dd/yyyy h:mm AM/PM' });
    expect(parse('10/25/2026 12:15am')?.serial).toBeCloseTo(OCT_25_2026 + 0.25 / 24, 10);
  });

  it('refuses dates that do not exist, other shapes and other text', () => {
    for (const text of [
      '31-02-2026',
      '29-02-2025',
      '31-04-2026',
      '00-10-2026',
      '13-13-2026',
      '32/01/2026',
      '10-10-1899',
      '10-10-26',
      '10-10/2026',
      '10 10 2026',
      '2026-10',
      '10-10-2026 24:00',
      '10-10-2026 10:60',
      '10-10-2026 13:00 PM',
      '10-10-2026 0:30 AM',
      'Invoice 10-10-2026',
      '10-10-20266',
      '',
      '12.5',
    ]) {
      expect(parse(text), text).toBeNull();
    }
    expect(parse('29-02-2024')?.serial).toBe(45351);
    expect(parse('  10-10-2026  ')?.serial).toBe(OCT_10_2026);
  });

  it('counts days before March 1900 as Excel does', () => {
    expect(parse('1900-01-01')?.serial).toBe(1);
    expect(parse('1900-02-28')?.serial).toBe(59);
    expect(parse('1900-03-01')?.serial).toBe(61);
  });

  it('takes the order from a regional locale', () => {
    expect(dateOrderOf('en-GB')).toBe('day-first');
    expect(dateOrderOf('bn-BD')).toBe('day-first');
    expect(dateOrderOf('de-DE')).toBe('day-first');
    expect(dateOrderOf('en-US')).toBe('month-first');
    expect(dateOrderOf('ja-JP')).toBe('month-first');
    expect(dateOrderOf('not a locale!')).toBe('day-first');
  });
});
