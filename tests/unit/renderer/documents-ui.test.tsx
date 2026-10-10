// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { externalLinks, tokenizeHtml } from '../../../src/renderer/documents/html/html-source';
import { DOCUMENT_VIEWERS } from '../../../src/renderer/documents/viewer-registry';
import { createFakeBridge } from './support/fake-bridge';
import { setupDom } from './support/dom';

const dom = setupDom();
afterEach(() => vi.unstubAllGlobals());

const PAGE = `<!DOCTYPE html><html><head><title>T</title><script>alert(1)</script><style>p { color: red }</style></head>
<body><p class="x">Hi <a href="https://example.com/a">a</a> <a href="https://example.com/a">again</a> <a href="javascript:alert(1)">js</a>
<a href="mailto:me@example.com">mail</a> <a href="#local">local</a><!-- note --><img src="https://example.com/i.png"></p></body></html>`;

function withDocuments() {
  const fake = createFakeBridge();
  const at = { projectId: null, folderId: null };
  const page = fake.addDocument({ ...at, title: 'Saved page', kind: 'html', storage: 'managed', sizeBytes: PAGE.length });
  const report = fake.addDocument({ ...at, title: 'Report', kind: 'pptx', storage: 'managed', sizeBytes: 2048 });
  const paper = fake.addDocument({ ...at, title: 'Paper', kind: 'pdf', storage: 'linked', sizeBytes: 10 }, { path: '/home/me/Paper.pdf', state: 'missing', sizeBytes: null, modifiedAt: null });
  return { fake, page, report, paper };
}

async function openFromTree(el: HTMLElement, id: string) {
  await dom.click(el.querySelector(`[id="tree-document:${id}"]`));
  await dom.settle(10);
}

describe('documents in the tree and tabs (D-118)', () => {
  it('documents sit in the tree with their kind, open in a tab named by the title in their viewer, and offer the system app', async () => {
    const { fake, report } = withDocuments();
    const { el } = await dom.mount(fake);
    const row = el.querySelector(`[id="tree-document:${report.id}"]`)!;
    expect(row.textContent).toBe('Report');
    expect(row.querySelector('[data-document-kind="pptx"]')).not.toBeNull();
    await openFromTree(el, report.id);
    const tab = el.querySelector(`[id="tab-document:${report.id}"]`)!;
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.textContent).toBe('Report');
    const view = el.querySelector('.document-view')!;
    expect(view.querySelector('.document-kind')?.textContent).toBe('Presentation');
    // The presentation viewer's chunk loads; the fake bridge serves no bytes, so it says it could not read them.
    const message = await dom.until(() => view.querySelector('.pptx-message'));
    expect(message.textContent).toBe('This presentation could not be read.');
    await dom.click([...view.querySelectorAll('button')].find((b) => b.textContent === 'Open in system app')!);
    expect(fake.data.documentHandoffs).toEqual([`open:${report.id}`]);
  });

  it('a linked document whose file is gone says where it was and offers no viewer or system app', async () => {
    const { fake, paper } = withDocuments();
    const { el } = await dom.mount(fake);
    await openFromTree(el, paper.id);
    const view = el.querySelector('.document-view')!;
    expect(view.querySelector('[role="alert"]')?.textContent).toBe('File not found at /home/me/Paper.pdf');
    expect(view.querySelector('.file-chip-badge')?.getAttribute('title')).toBe('Linked: /home/me/Paper.pdf');
    const buttons = Object.fromEntries([...view.querySelectorAll('button')].map((b) => [b.textContent, b.disabled]));
    expect(buttons).toEqual({ 'Open in system app': true, 'Show in folder': true, 'Export a copy…': true, Versions: false });
  });

  it('the context menu offers document actions and Move to Trash closes the tab', async () => {
    const { fake, report } = withDocuments();
    const { el } = await dom.mount(fake);
    await openFromTree(el, report.id);
    const row = el.querySelector<HTMLElement>(`[id="tree-document:${report.id}"]`)!;
    await act(async () => row.focus());
    await dom.key(row, 'F10', { shiftKey: true });
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent)).toEqual([
      'Open',
      'Rename',
      'Move to…',
      'Add to favorites',
      'Open in system app',
      'Show in folder',
      'Move to Trash',
    ]);
    await dom.click([...menu.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent === 'Move to Trash')!);
    await dom.click([...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Move to Trash')!);
    await dom.settle(10);
    expect(el.querySelector(`[id="tab-document:${report.id}"]`)).toBeNull();
    expect(fake.data.documents.find((d) => d.id === report.id)?.deletedAt).not.toBeNull();
  });
});

describe('HTML viewer (F6)', () => {
  it('shows the page in a scriptless sandboxed frame from the infinity-html scheme', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PAGE)));
    const { fake, page } = withDocuments();
    const { el } = await dom.mount(fake);
    await openFromTree(el, page.id);
    // The HTML viewer is its own lazily loaded chunk.
    const frame = await dom.until(() => el.querySelector<HTMLIFrameElement>('iframe.html-frame'));
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toBe(`infinity-html://${page.id}/?r=0`);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(fetch).toHaveBeenCalledWith(`infinity-document://${page.id}/?r=0`);
  });

  it('a second load (a link refused into an error page) shows the page again in a new frame and says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PAGE)));
    const { fake, page } = withDocuments();
    const { el } = await dom.mount(fake);
    await openFromTree(el, page.id);
    const first = await dom.until(() => el.querySelector<HTMLIFrameElement>('iframe.html-frame'));
    await act(async () => first.dispatchEvent(new Event('load')));
    expect(el.querySelector('iframe.html-frame')).toBe(first);
    await act(async () => first.dispatchEvent(new Event('load')));
    const shown = el.querySelector<HTMLIFrameElement>('iframe.html-frame')!;
    expect(shown).not.toBe(first);
    expect(shown.getAttribute('src')).toBe(`infinity-html://${page.id}/?r=0`);
    expect(shown.getAttribute('sandbox')).toBe('');
    expect(el.querySelector('.toast')?.textContent).toContain('Links in a saved page do not open. Copy them from Links.');
    // A click inside the frame before the page's own load finished: the only load is the error page, while the frame
    // has the focus.
    await act(async () => shown.focus());
    expect(document.activeElement).toBe(shown);
    await act(async () => shown.dispatchEvent(new Event('load')));
    expect(el.querySelector('iframe.html-frame')).not.toBe(shown);
  });

  it('Source shows the markup as colored text, never as elements; Links lists the web links to copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PAGE)));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fake, page } = withDocuments();
    const { el } = await dom.mount(fake);
    await openFromTree(el, page.id);
    await dom.until(() => el.querySelector('.html-viewer'));
    const source = [...el.querySelectorAll<HTMLInputElement>('.html-viewer input[type="radio"]')].find((r) => r.value === 'source')!;
    await dom.click(source);
    const pre = el.querySelector('.html-source')!;
    expect(pre.textContent).toBe(PAGE);
    expect(pre.querySelector('script, img, a, p')).toBeNull();
    expect(pre.querySelector('.src-declaration')?.textContent).toBe('<!DOCTYPE html>');
    expect(pre.querySelector('.src-value')?.textContent).toBe('="x"');
    const links = [...el.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Links'))!;
    expect(links.textContent).toBe('Links (1)');
    await dom.click(links);
    const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual(['Copy https://example.com/a']);
    await dom.click(items[0]!);
    expect(writeText).toHaveBeenCalledWith('https://example.com/a');
    expect(document.body.textContent).toContain('Link copied');
  });
});

describe('HTML source helpers', () => {
  it('tokenizes tags, attribute names and values, comments, declarations and raw text', () => {
    const tokens = tokenizeHtml('<!DOCTYPE html><p class="a" hidden>x<!-- c --></p><script>if (a < b) {}</script>');
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ['declaration', '<!DOCTYPE html>'],
      ['tag', '<p'],
      ['text', ' '],
      ['name', 'class'],
      ['value', '="a"'],
      ['text', ' '],
      ['name', 'hidden'],
      ['tag', '>'],
      ['text', 'x'],
      ['comment', '<!-- c -->'],
      ['tag', '</p><script>'],
      ['text', 'if (a < b) {}'],
      ['tag', '</script>'],
    ]);
    expect(tokenizeHtml('a < b <').map((t) => t.text).join('')).toBe('a < b <');
    expect(tokenizeHtml('<p unterminated').map((t) => t.text).join('')).toBe('<p unterminated');
  });

  it('lists http and https links once, from an inert parse', () => {
    expect(externalLinks(PAGE)).toEqual(['https://example.com/a']);
    expect(externalLinks('<a href="http://user:pw@example.com/">x</a><a href=" https://example.org/b ">y</a>')).toEqual(['https://example.org/b']);
  });

  it('every kind has a viewer; every viewer is a lazily loaded chunk, Excel and CSV share one', () => {
    expect(Object.keys(DOCUMENT_VIEWERS)).toEqual(['html', 'pdf', 'docx', 'pptx', 'xlsx', 'csv']);
    expect(DOCUMENT_VIEWERS.xlsx).toBe(DOCUMENT_VIEWERS.csv);
    for (const viewer of Object.values(DOCUMENT_VIEWERS)) expect(String(viewer.$$typeof)).toBe('Symbol(react.lazy)');
  });
});

