import { describe, expect, it } from 'vitest';
import { rowsToTsv, tsvToRows } from '../../src/shared/text/table-text';

describe('tables as tab-separated text', () => {
  it('rows become tab-separated lines; tabs and line breaks inside a cell become spaces', () => {
    expect(
      rowsToTsv([
        ['Name', 'Note'],
        ['Ada', 'two\nlines\tand tab'],
        ['', ''],
      ]),
    ).toBe('Name\tNote\nAda\ttwo lines and tab\n\t');
  });

  it('spreadsheet text with several rows and columns reads as rows, trailing line end and CRLF included', () => {
    expect(tsvToRows('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(tsvToRows('a\t\nc\td')).toEqual([
      ['a', ''],
      ['c', 'd'],
    ]);
  });

  it('a quoted field may hold tabs, line breaks and doubled quotes', () => {
    expect(tsvToRows('"x\ty"\t"line 1\nline 2"\n"say ""hi"""\tz')).toEqual([
      ['x\ty', 'line 1\nline 2'],
      ['say "hi"', 'z'],
    ]);
    // An unterminated quote is plain text.
    expect(tsvToRows('"open\tb\nc\td')).toEqual([
      ['"open', 'b'],
      ['c', 'd'],
    ]);
  });

  it.each([
    ['no tab', 'a\nb'],
    ['one row', 'a\tb\tc'],
    ['one column of text with one tab', 'a\tb'],
    ['ragged rows', 'a\tb\nc'],
    ['a blank line between rows', 'a\tb\n\nc\td'],
    ['tab-indented lines (empty first column)', '\tone\n\ttwo'],
    ['an empty last column', 'a\t\nb\t'],
  ])('%s is not a table', (_name, text) => {
    expect(tsvToRows(text)).toBeNull();
  });
});
