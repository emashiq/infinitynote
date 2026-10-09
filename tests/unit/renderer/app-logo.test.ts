import { describe, expect, it } from 'vitest';
import { logoSources } from '../../../src/renderer/ui/AppLogo';

describe('logo in the app (D-109)', () => {
  it('serves each CSS size from the next logo file up, with the following size for high-density screens', () => {
    const name = (url: string) => /logo-(\d+)/.exec(url)?.[1];
    const pick = (size: number) => {
      const { src, srcSet } = logoSources(size);
      return [name(src), srcSet.split(', ').map((entry) => `${name(entry)} ${entry.split(' ')[1]}`)];
    };
    expect(pick(18)).toEqual(['32', ['32 1x', '64 2x']]);
    expect(pick(64)).toEqual(['64', ['64 1x', '128 2x']]);
    expect(pick(96)).toEqual(['128', ['128 1x', '256 2x']]);
    expect(pick(256)).toEqual(['256', ['256 1x', '256 2x']]);
    expect(pick(400)).toEqual(['256', ['256 1x', '256 2x']]);
  });
});
