// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanSvg, drawDiagram } from '../../../../src/renderer/editor/diagram/diagram';
import { DIAGRAM_MESSAGES, DIAGRAM_TIMEOUT_MS, MAX_DIAGRAM_SOURCE } from '../../../../src/renderer/editor/diagram/diagram-limits';
import { pngSize, svgSize } from '../../../../src/renderer/editor/diagram/diagram-export';
import { codeHighlighter, languageLabel } from '../../../../src/renderer/editor/code/languages';
import { DIAGRAM_STARTER } from '../../../../src/renderer/editor/note-actions';
import { noteSchema } from '../../../../src/shared/editor/schema';
import { makeEditor, mountEditor, tick } from './support';

vi.mock('../../../../src/renderer/editor/diagram/mermaid-render', () => ({
  renderMermaid: async (source: string) => {
    if (source.includes('oops')) throw new Error('Parse error on line 2:\n...oops\n---^\nExpecting NODE');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><script>window.__pwned=1</script><g onclick="x()"><text>${source.length}</text></g></svg>`;
  },
}));

afterEach(() => vi.useRealTimers());

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

describe('the editor schema stays main\'s schema (D-103, D-159)', () => {
  it('has the same node types and attributes as the shared schema, with the highlighted code block in place of StarterKit\'s', async () => {
    const { editor } = makeEditor();
    await tick();
    const shared = noteSchema('rich');
    const nodes = (schema: typeof shared) => Object.fromEntries(Object.entries(schema.nodes).map(([name, type]) => [name, Object.keys(type.spec.attrs ?? {}).sort()]));
    expect(nodes(editor.schema)).toEqual(nodes(shared));
    expect(Object.keys(editor.schema.marks).sort()).toEqual(Object.keys(shared.marks).sort());
    for (const name of ['docRef', 'mathInline', 'mathBlock']) expect(editor.schema.nodes[name]).toBeDefined();
  });
});

describe('code blocks (D-159)', () => {
  it('highlights a known language, leaves an unknown or missing one as plain text and offers a language picker', async () => {
    const { editor } = await mountEditor({ content: '<pre><code class="language-ts">const x = 1;</code></pre><pre><code>const y = 2;</code></pre><pre><code class="language-haskell">main = 1</code></pre>' });
    await tick();
    const blocks = [...editor.view.dom.querySelectorAll('.code-block')];
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(blocks[1]!.querySelector('[class^="hljs-"]')).toBeNull();
    expect(blocks[2]!.querySelector('[class^="hljs-"]')).toBeNull();
    const pickers = blocks.map((b) => b.querySelector<HTMLSelectElement>('select[aria-label="Code language"]')!);
    expect(pickers.map((p) => p.value)).toEqual(['typescript', 'plaintext', 'haskell']);
    expect(editor.getJSON().content![0]!.attrs!.language).toBe('ts');

    await act(async () => {
      pickers[1]!.value = 'python';
      pickers[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(editor.getJSON().content![1]!.attrs!.language).toBe('python');
    expect(codeHighlighter.highlightAuto('const z').children.every((c) => c.type === 'text')).toBe(true);
    expect([languageLabel(null), languageLabel('mermaid'), languageLabel('cobol')]).toEqual(['Plain text', 'Mermaid diagram', 'cobol']);
  });

  it('a read-only code block names its language instead of a picker', async () => {
    const { editor } = await mountEditor({ content: '<pre><code class="language-python">x = 1</code></pre>' });
    await tick();
    await act(async () => editor.setEditable(false));
    expect(editor.view.dom.querySelector('select')).toBeNull();
    expect(editor.view.dom.querySelector('.code-language-label')?.textContent).toBe('Python');
  });
});

describe('Mermaid diagrams (D-158)', () => {
  it('a mermaid block shows its drawing as an image (scripts removed), with Edit and Copy actions; Edit shows the source', async () => {
    const { editor } = await mountEditor({ content: '<p>x</p>' });
    await tick();
    editor.commands.insertContentAt(0, { type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: DIAGRAM_STARTER }] });
    await settle(400);
    const block = editor.view.dom.querySelector('.code-block.is-diagram')!;
    const img = block.querySelector<HTMLImageElement>('img.diagram-image')!;
    expect(img.alt).toBe('Diagram');
    const svg = decodeURIComponent(img.src.replace('data:image/svg+xml;charset=utf-8,', ''));
    expect(svg).toContain(`<text>${DIAGRAM_STARTER.length}</text>`);
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('onclick');
    // Just inserted, the cursor is in it: the source shows above the drawing.
    expect(block.querySelector('pre')!.classList.contains('is-hidden')).toBe(false);
    expect([...block.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Preview', 'Copy as SVG', 'Copy as PNG']);
    await act(async () => block.querySelector<HTMLButtonElement>('button')!.click());
    expect(block.querySelector('pre')!.classList.contains('is-hidden')).toBe(true);
    expect(block.querySelector('button')!.textContent).toBe('Edit');
    // Moving the cursor into the block shows its source again.
    await act(async () => void editor.commands.setTextSelection(3));
    expect(block.querySelector('pre')!.classList.contains('is-hidden')).toBe(false);
  });

  it('invalid source shows Mermaid\'s message in place of the drawing', async () => {
    const { editor } = await mountEditor({ content: '<pre><code class="language-mermaid">flowchart TD\n  oops --></code></pre>' });
    await tick();
    await settle(400);
    const block = editor.view.dom.querySelector('.code-block.is-diagram')!;
    expect(block.querySelector('img')).toBeNull();
    expect(block.querySelector('.diagram-error')?.textContent).toBe('Parse error on line 2:\n...oops\n---^\nExpecting NODE');
  });

  it('bounds: empty and over-long sources are not drawn, and a slow drawing is reported after the time limit', async () => {
    const never = () => Promise.resolve(() => new Promise<string>(() => undefined));
    expect(await drawDiagram('  ', 'light', 'sans', never)).toEqual({ ok: false, error: DIAGRAM_MESSAGES.empty });
    expect(await drawDiagram('a'.repeat(MAX_DIAGRAM_SOURCE + 1), 'light', 'sans', never)).toEqual({ ok: false, error: DIAGRAM_MESSAGES.tooLong });
    vi.useFakeTimers();
    const slow = drawDiagram('flowchart TD', 'dark', 'sans', never);
    await vi.advanceTimersByTimeAsync(DIAGRAM_TIMEOUT_MS);
    expect(await slow).toEqual({ ok: false, error: DIAGRAM_MESSAGES.timedOut });
  });

  it('the drawing passes the theme and font to Mermaid and is cleaned of active content', async () => {
    const calls: unknown[] = [];
    const render = () => Promise.resolve(async (source: string, theme: string, font: string) => (calls.push([source, theme, font]), '<svg><foreignObject><div>x</div></foreignObject><a href="https://example.com"><text>t</text></a><image href="https://example.com/i.png"/></svg>'));
    const result = await drawDiagram('graph LR', 'dark', 'Inter', render);
    expect(calls).toEqual([['graph LR', 'dark', 'Inter']]);
    // A link keeps its text without the link.
    expect(result.ok && result.svg).toBe('<svg><text>t</text></svg>');
    expect(cleanSvg('<svg onload="x()"><style>.a{fill:red}</style><rect class="a"/></svg>')).toBe('<svg><style>.a{fill:red}</style><rect class="a"></rect></svg>');
  });

  it('a PNG copy is twice the drawing size within 4096 pixels', () => {
    expect(svgSize('<svg viewBox="0 0 120 60" width="100%">')).toEqual({ width: 120, height: 60 });
    expect(svgSize('<svg width="30" height="20">')).toEqual({ width: 30, height: 20 });
    expect(pngSize({ width: 120, height: 60 })).toEqual({ width: 240, height: 120 });
    expect(pngSize({ width: 8000, height: 1000 })).toEqual({ width: 4096, height: 512 });
  });
});
