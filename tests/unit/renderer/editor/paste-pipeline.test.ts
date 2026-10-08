// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makeEditor, pasteEvent, tick } from './support';

const HOSTILE = [
  '<h2>Heading kept</h2>',
  '<p>before <b>bold kept</b></p>',
  '<script>window.__pwned = 1</script>',
  '<img src="http://example.invalid/x.png" onerror="window.__pwned = 2">',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="x"></object><embed src="y">',
  '<p><a href="javascript:alert(1)">bad link</a> <a href="https://example.com/ok">good link</a></p>',
  '<style>body{display:none}</style>',
].join('');

describe('paste pipeline: sanitizer plus schema (INF-EDIT-07)', () => {
  it('hostile HTML: no remote image node, no script text, only http(s) links survive', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteEvent(editor, { html: HOSTILE, text: 'fallback text' });
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain('"type":"image"');
    expect(json).not.toContain('window.__pwned');
    expect(json).not.toContain('javascript:');
    expect(json).not.toContain('evil.example');
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    const html = editor.getHTML();
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>bold kept</strong>');
    expect(editor.getText()).toContain('Image: example.invalid');
    expect(editor.getText()).toContain('bad link');
    const links: string[] = [];
    editor.state.doc.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === 'link') links.push(mark.attrs.href as string);
    });
    expect([...new Set(links)].sort()).toEqual(['http://example.invalid/x.png', 'https://example.com/ok']);
  });

  it('a pasted data image becomes an uploading image node that the uploader completes', async () => {
    const { editor, uploader } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteEvent(editor, { html: '<p>pic</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt="dot"><p>after</p>' });
    const uploading = editor.getJSON().content!.find((n) => n.type === 'image');
    expect(uploading?.attrs).toMatchObject({ uploadToken: expect.any(String), attachmentId: null });
    expect(await uploader.waitIdle(1000)).toBe(true);
    const done = editor.getJSON().content!.find((n) => n.type === 'image');
    expect(done?.attrs).toMatchObject({ uploadToken: null, attachmentId: expect.any(String), width: 4, height: 3 });
  });

  it('plain notes take the plain text of a paste and ignore its HTML', async () => {
    const { editor } = makeEditor({ format: 'plain', content: '<p>start</p>' });
    await tick();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const event = pasteEvent(editor, { html: '<h1>Big</h1><p><b>bold</b> and <a href="https://x.example">link</a></p>', text: 'Big\nbold and link' });
    expect(event.defaultPrevented).toBe(true);
    const types = new Set(JSON.stringify(editor.getJSON()).match(/"type":"[a-zA-Z]+"/g));
    expect(types).toEqual(new Set(['"type":"doc"', '"type":"paragraph"', '"type":"text"']));
    expect(editor.getText({ blockSeparator: '\n' })).toBe('startBig\nbold and link');
  });

  it('files in a paste are captured synchronously; a plain note refuses them with the right message', async () => {
    const rich = makeEditor({ content: '<p>x</p>' });
    await tick();
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
    expect(pasteEvent(rich.editor, { files: [png], html: '<img src="x">' }).defaultPrevented).toBe(true);
    expect(rich.editor.getJSON().content!.some((n) => n.type === 'image' && n.attrs!.alt === 'Pasted image')).toBe(true);
    expect(await rich.uploader.waitIdle(1000)).toBe(true);

    const plain = makeEditor({ format: 'plain', content: '<p>x</p>' });
    await tick();
    pasteEvent(plain.editor, { files: [png] });
    pasteEvent(plain.editor, { files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })] });
    expect(plain.notices).toEqual([
      'Plain-text notes cannot contain images. Convert to rich text to add images.',
      'Plain-text notes cannot contain files. Convert to rich text to add files.',
    ]);
    expect(plain.editor.getText()).toBe('x');
  });
});
