import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_MESSAGES } from '../../src/shared/attachments/link-messages';
import type { InfinityBridge } from '../../src/shared/contracts/bridge';

/** Files the fake Electron treats as dropped from disk, with their paths; any other File has no path, as in Electron. */
const diskPaths = new WeakMap<File, string>();
const invoke = vi.fn(async (_channel: string, _payload: unknown) => ({ ok: true, data: { link: {} } }));
let exposed: InfinityBridge | null = null;

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_key: string, api: InfinityBridge) => (exposed = api) },
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: (file: File) => diskPaths.get(file) ?? '' },
}));

beforeAll(async () => {
  await import('../../src/preload/index');
});
beforeEach(() => invoke.mockClear());

const bridge = () => exposed!;

describe('preload: linking a file never takes a path from page script (D-115)', () => {
  it('exposes no method that accepts a path', () => {
    expect(Object.keys(bridge().fileLink).sort()).toEqual(['copyIn', 'createFromFile', 'isOnDisk', 'open', 'showInFolder', 'status']);
  });

  it('sends the path Electron reports for a dropped file on disk', async () => {
    const dropped = new File(['x'], 'plan.pdf');
    diskPaths.set(dropped, 'C:\\Users\\me\\plan.pdf');
    expect(bridge().fileLink.isOnDisk(dropped)).toBe(true);
    await bridge().fileLink.createFromFile(dropped);
    expect(invoke).toHaveBeenCalledWith('fileLink:create', { path: 'C:\\Users\\me\\plan.pdf' });
  });

  it('refuses a File made by page script, whatever its name or properties claim, and anything that is not a File', async () => {
    const named = new File(['x'], 'C:\\Users\\me\\.ssh\\id_rsa');
    const withPath = new File(['x'], 'id_rsa');
    Object.defineProperty(withPath, 'path', { value: 'C:\\Users\\me\\.ssh\\id_rsa' });
    const forged = [named, withPath, { path: 'C:\\Users\\me\\.ssh\\id_rsa' }, 'C:\\Users\\me\\.ssh\\id_rsa', null] as unknown as File[];
    for (const file of forged) {
      expect(bridge().fileLink.isOnDisk(file)).toBe(false);
      expect(await bridge().fileLink.createFromFile(file)).toEqual({ ok: false, error: { code: 'VALIDATION_FAILED', message: LINK_MESSAGES.noPath } });
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
