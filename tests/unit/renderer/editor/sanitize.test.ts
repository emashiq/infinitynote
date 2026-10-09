// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizePastedHtml } from '../../../../src/renderer/editor/sanitize';

function clean(html: string) {
  const dataImages: Array<{ token: string; mime: string; base64: string }> = [];
  let n = 0;
  const out = sanitizePastedHtml(html, { onDataImage: (token, mime, base64) => dataImages.push({ token, mime, base64 }), newToken: () => `tok-${++n}` });
  const doc = new DOMParser().parseFromString(`<body>${out}</body>`, 'text/html');
  return { out, doc, dataImages };
}

describe('sanitizePastedHtml (INF-EDIT-07)', () => {
  it.each([
    ['script', '<p>a</p><script>window.__pwned=1</script>'],
    ['style', '<style>p{color:red}</style><p>a</p>'],
    ['iframe', '<iframe src="https://evil.example"></iframe><p>a</p>'],
    ['object', '<object data="x.swf"></object><p>a</p>'],
    ['embed', '<embed src="x.swf"><p>a</p>'],
    ['applet', '<applet code="x"></applet><p>a</p>'],
    ['form', '<form action="https://evil.example"><input name="x"><button>go</button><textarea></textarea><select></select></form><p>a</p>'],
    ['link', '<link rel="stylesheet" href="https://evil.example/x.css"><p>a</p>'],
    ['meta', '<meta http-equiv="refresh" content="0;url=https://evil.example"><p>a</p>'],
    ['base', '<base href="https://evil.example/"><p>a</p>'],
    ['svg', '<svg><script>alert(1)</script><image href="https://evil.example/x.png"/></svg><p>a</p>'],
    ['math', '<math><mtext>x</mtext></math><p>a</p>'],
    ['template', '<template><img src="https://evil.example/x.png"></template><p>a</p>'],
    ['media', '<video src="https://evil.example/v.mp4" poster="https://evil.example/p.png"></video><audio src="x.mp3"></audio><source src="x"><track src="x"><canvas></canvas><noscript>n</noscript><p>a</p>'],
  ])('removes %s', (_name, html) => {
    const { doc } = clean(html);
    for (const tag of ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'svg', 'math', 'template', 'video', 'audio', 'source', 'track', 'canvas', 'noscript']) {
      expect(doc.querySelector(tag), tag).toBeNull();
    }
    expect(doc.body.textContent).toContain('a');
  });

  it('a frameset document keeps nothing', () => {
    const { out, doc } = clean('<frameset><frame src="https://evil.example"></frameset><p>a</p>');
    expect(out).toBe('');
    expect(doc.querySelector('frame, frameset')).toBeNull();
  });

  it('removes event handlers and style, srcset, formaction, background and ping attributes', () => {
    const { out } = clean(
      '<p onclick="x()" style="color:red" background="x.png">a</p><a href="https://ok.example/" ping="https://track.example" onmouseover="x()">ok</a><img src="https://e.example/a.png" srcset="https://e.example/b.png 2x" onerror="x()">',
    );
    for (const attr of ['onclick', 'style=', 'background=', 'ping=', 'onmouseover', 'srcset', 'onerror']) expect(out).not.toContain(attr);
    expect(out).toContain('href="https://ok.example/"');
  });

  it('drops javascript: and vbscript: links but keeps their text; keeps http(s) links', () => {
    const { doc } = clean('<a href="javascript:alert(1)">js</a> <a href="vbscript:msgbox(1)">vb</a> <a href="JaVaScRiPt:alert(1)">mixed</a> <a href="https://example.com/docs">docs</a>');
    const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter(Boolean)).toEqual(['https://example.com/docs']);
    expect(doc.body.textContent).toContain('js');
    expect(doc.body.textContent).toContain('vb');
  });

  it('a remote image becomes link text and is never an image', () => {
    const { doc } = clean('<p>x</p><img src="http://example.invalid/x.png" alt="Chart"><img src="https://cdn.example.com/y.png">');
    expect(doc.querySelector('img')).toBeNull();
    const links = [...doc.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]);
    expect(links).toEqual([
      ['http://example.invalid/x.png', 'Image: Chart'],
      ['https://cdn.example.com/y.png', 'Image: cdn.example.com'],
    ]);
  });

  it('a data image becomes an upload placeholder and is handed to the importer', () => {
    const { doc, dataImages } = clean('<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">');
    expect(dataImages).toEqual([{ token: 'tok-1', mime: 'image/png', base64: 'iVBORw0KGgo=' }]);
    const img = doc.querySelector('img')!;
    expect(img.getAttribute('data-upload-token')).toBe('tok-1');
    expect(img.getAttribute('src')).toBeNull();
    expect(img.getAttribute('alt')).toBe('dot');
  });

  it('other image sources (file:, blob:, svg data, relative) are removed', () => {
    const { doc, dataImages } = clean(
      '<img src="file:///C:/secret.png"><img src="blob:https://x/1"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="pic.png"><img src="infinity-attachment://not-ours">',
    );
    expect(doc.querySelector('img')).toBeNull();
    expect(dataImages).toEqual([]);
  });

  it('our own image copies keep their attachment ID without a source', () => {
    const id = '0b8f5a8e-6c2d-4c39-9c1f-2f1f0d3f8a11';
    const { doc } = clean(`<img data-attachment-id="${id}" src="infinity-attachment://${id}" alt="mine" class="img-small">`);
    const img = doc.querySelector('img')!;
    expect(img.getAttribute('data-attachment-id')).toBe(id);
    expect(img.getAttribute('src')).toBeNull();
  });

  it('inline styles keep only the formatting a note stores, rewritten from validated values', () => {
    const { doc } = clean(
      '<p style="color:#e03131">p</p><span style="color: #E03131; background-color: rgb(255, 243, 163); font-family: \'Times New Roman\', serif; font-size: 12pt; position: fixed; background-image: url(https://evil.example/x)">s</span>' +
        '<span style="color: red; font-family: Papyrus; font-size: 13px; behavior: url(x.htc)">gone</span><span style="color:#000000;background-color:#FFFFFF">doc</span>' +
        '<table><tr><td style="text-align: right; color: red" colspan="2" rowspan="1">c</td><td style="text-align: justify">j</td></tr></table>',
    );
    const [kept, gone, defaults] = [...doc.querySelectorAll('span')];
    expect(doc.querySelector('p')!.hasAttribute('style')).toBe(false);
    expect(kept!.style.cssText).not.toMatch(/position|url|evil/);
    expect(kept!.style.fontSize).toBe('16px');
    expect(kept!.style.fontFamily).toContain('Times New Roman');
    expect(kept!.getAttribute('style')).toMatch(/color: #e03131/);
    expect(kept!.getAttribute('style')).toMatch(/background-color: #fff3a3/);
    expect(gone!.hasAttribute('style')).toBe(false);
    expect(defaults!.hasAttribute('style')).toBe(false);
    const [c, j] = [...doc.querySelectorAll('td')];
    expect(c!.getAttribute('style')).toBe('text-align: right');
    expect(c!.getAttribute('colspan')).toBe('2');
    expect(j!.hasAttribute('style')).toBe(false);
  });

  it('keeps table structure: header cells, spans and column widths', () => {
    const { out } = clean('<table><colgroup><col width="120"></colgroup><tr><th colspan="2">h</th></tr><tr><td colwidth="80" rowspan="2">a</td><td>b</td></tr></table>');
    for (const part of ['<th colspan="2">', 'colwidth="80"', 'rowspan="2"', '<col width="120">']) expect(out).toContain(part);
  });

  it('keeps the data attributes the schema parses', () => {
    const { out } = clean('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p data-id="x">t</p></li></ul><div data-file-attachment-id="y">f</div>');
    for (const attr of ['data-type="taskList"', 'data-type="taskItem"', 'data-checked="true"', 'data-id="x"', 'data-file-attachment-id="y"']) expect(out).toContain(attr);
  });
});
