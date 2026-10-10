import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { genarate, setTextValueParser } from '@fortune-sheet/core';
import { FORTUNE_SHEET_CORE, insertRowsAt, patchFortuneSheetCore } from '../../fortune-sheet-patch.config';

const core = (file: string) => fs.readFileSync(path.resolve('node_modules/@fortune-sheet/core/dist', file), 'utf8');

describe('the FortuneSheet build patch (D-139, D-184)', () => {
  it.each(['index.esm.js', 'index.js'])('replaces every new Function of %s and adds the helper', (file) => {
    const original = core(file);
    expect(original).toMatch(/new Function\("d"/);
    const patched = patchFortuneSheetCore(original);
    expect(patched).not.toMatch(/new Function\s*\(/);
    expect(patched.match(/__infinityInsertRowsAt\(d, (0|index|index \+ 1), arr\);/g)).toHaveLength(3);
    expect(patched).toMatch(/function __infinityInsertRowsAt\(d, index, rows\)/);
  });

  it.each([
    ['index.esm.js', 'export { __infinitySetTextValueParser as setTextValueParser };'],
    ['index.js', 'exports.setTextValueParser = __infinitySetTextValueParser;'],
  ])('puts the text hook in front of genarate in %s and exports its setter', (file, exported) => {
    const patched = patchFortuneSheetCore(core(file));
    const count = (text: string) => patched.split(text).length - 1;
    expect(count('function genarate(value) {')).toBe(1);
    expect(count('function __infinityFortuneGenarate(value) {')).toBe(1);
    expect(count(exported)).toBe(1);
  });

  it('fails the build when FortuneSheet no longer has the expected code', () => {
    expect(() => patchFortuneSheetCore('export const x = 1;')).toThrow(/expected code not found/);
    const withoutGenarate = core('index.esm.js').replace('function genarate(value) {', 'function generate(value) {');
    expect(() => patchFortuneSheetCore(withoutGenarate)).toThrow(/expected code once: function genarate/);
  });

  it('the core module the tests load is the patched one: the parser reads text first, null leaves it to FortuneSheet', () => {
    try {
      setTextValueParser((text) => (text === 'ten' ? ['10', { fa: 'General', t: 'n' }, 10] : null));
      expect(genarate('ten')).toEqual(['10', { fa: 'General', t: 'n' }, 10]);
      expect(genarate('25.10.2026')).toEqual(['25.10.2026', { fa: '@', t: 's' }, '25.10.2026']);
      setTextValueParser(null);
      expect(genarate('ten')).toEqual(['ten', { fa: 'General', t: 'g' }, 'ten']);
    } finally {
      setTextValueParser(null);
    }
  });

  it('matches the core module by path on Windows and Linux', () => {
    expect(FORTUNE_SHEET_CORE.test(String.raw`E:\notecapt\node_modules\@fortune-sheet\core\dist\index.esm.js`)).toBe(true);
    expect(FORTUNE_SHEET_CORE.test('/home/u/app/node_modules/@fortune-sheet/core/dist/index.js')).toBe(true);
    expect(FORTUNE_SHEET_CORE.test('/home/u/app/node_modules/@fortune-sheet/react/dist/index.esm.js')).toBe(false);
  });

  it('inserts rows as the generated function did, also more than one call can take', () => {
    const d: unknown[] = [[1], [2]];
    insertRowsAt(d, 1, [JSON.stringify([null, { v: 'a' }]), JSON.stringify([null])]);
    expect(d).toEqual([[1], [null, { v: 'a' }], [null], [2]]);
    const many: unknown[] = [];
    insertRowsAt(many, 0, Array.from({ length: 150_000 }, () => '[]'));
    expect(many).toHaveLength(150_000);
  });

  it('is part of the renderer build', () => {
    expect(fs.readFileSync(path.resolve('electron.vite.config.ts'), 'utf8')).toMatch(/plugins: \[[^\]]*fortuneSheetPatch\(\)/);
  });
});
