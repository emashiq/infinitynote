// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { liveEditor, liveEditorCount, registerEditor } from '../../../../src/renderer/editor/editor-registry';
import { makeEditor } from './support';

describe('editor registry (INF-TABS-07)', () => {
  it('counts live editors on <html data-live-editors> and exposes the single live one', () => {
    expect(liveEditorCount()).toBe(0);
    const a = makeEditor().editor;
    const offA = registerEditor(a);
    expect(document.documentElement.dataset.liveEditors).toBe('1');
    expect(liveEditor()).toBe(a);
    const b = makeEditor().editor;
    const offB = registerEditor(b);
    expect(document.documentElement.dataset.liveEditors).toBe('2');
    expect(liveEditor()).toBeNull();
    offA();
    offB();
    expect(document.documentElement.dataset.liveEditors).toBe('0');
    expect(liveEditorCount()).toBe(0);
  });
});
