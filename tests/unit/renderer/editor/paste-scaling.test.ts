// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blockIds, makeEditor, pasteEvent, tick } from './support';

const paragraphs = (n: number) => '<p>The quick brown fox jumps over the lazy dog 0123456789 lorem ipsum</p>'.repeat(n);

async function pasteTime(n: number): Promise<number> {
  const { editor } = makeEditor({ content: '<p>start</p>' });
  await tick();
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  const started = performance.now();
  pasteEvent(editor, { html: paragraphs(n), text: 'x' });
  // Large pastes run after pending edits are saved (D-060), so wait for the content.
  while (editor.state.doc.childCount < n) await tick();
  const elapsed = performance.now() - started;
  expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(n);
  const ids = blockIds(editor).map((b) => b.id);
  expect(ids.every((id) => typeof id === 'string')).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  return elapsed;
}

/**
 * QA-2 regression: pasting many blocks must scale linearly. UniqueID's per-node pass was quadratic (12,000
 * paragraphs took 34 s in the app); the pasted slice now carries fresh IDs and the duplicate repair is one scan.
 */
describe('large paste scales linearly (QA-2)', () => {
  it('12,000 pasted paragraphs finish within a few seconds and every block gets a unique ID', async () => {
    const big = await pasteTime(12_000);
    expect(big).toBeLessThan(6000);
  }, 60_000);

  it('doubling the paste roughly doubles the time (not quadruples)', async () => {
    await pasteTime(1000); // warm-up
    const t3 = await pasteTime(3000);
    const t6 = await pasteTime(6000);
    // Generous bound: linear would be about 2x, the old quadratic path about 4x.
    expect(t6 / Math.max(t3, 1)).toBeLessThan(3.2);
  }, 60_000);
});
