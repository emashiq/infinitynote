// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Highlighted } from '../../../src/renderer/palette/Highlighted';
import { HIT_END, HIT_START, markSubstring, parseMarked } from '../../../src/shared/search/segments';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  document.body.innerHTML = '';
});

const marked = (s: string) => s.replaceAll('[', HIT_START).replaceAll(']', HIT_END);

describe('search snippets (INF-SRCH-04)', () => {
  it('parseMarked splits hits from plain text and drops stray markers', () => {
    expect(parseMarked(marked('the [plan] and [review]'))).toEqual([
      { text: 'the ', hit: false },
      { text: 'plan', hit: true },
      { text: ' and ', hit: false },
      { text: 'review', hit: true },
    ]);
    expect(parseMarked(marked('a]b[c'))).toEqual([
      { text: 'ab', hit: false },
      { text: 'c', hit: true },
    ]);
    expect(parseMarked(marked('[]'))).toEqual([]);
    expect(parseMarked('বাংলা')).toEqual([{ text: 'বাংলা', hit: false }]);
  });

  it('markSubstring marks every case-insensitive occurrence', () => {
    expect(markSubstring('AI and ai', 'ai')).toEqual([
      { text: 'AI', hit: true },
      { text: ' and ', hit: false },
      { text: 'ai', hit: true },
    ]);
    expect(markSubstring('Plan', '')).toEqual([{ text: 'Plan', hit: false }]);
  });

  it('no HTML injection: markup in a note is rendered as text, never as elements', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const segments = parseMarked(marked('<img src=x onerror="window.__pwned=1"> [<b>payload</b>] <script>window.__pwned=2</script>'));
    await act(async () => createRoot(host).render(<Highlighted segments={segments} />));
    expect(host.querySelectorAll('img, script, b').length).toBe(0);
    expect(host.querySelector('mark')!.textContent).toBe('<b>payload</b>');
    expect(host.textContent).toBe('<img src=x onerror="window.__pwned=1"> <b>payload</b> <script>window.__pwned=2</script>');
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
