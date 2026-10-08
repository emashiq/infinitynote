import type { ShellAdapter } from './services/shell-adapter';

export interface TestHooks {
  blockedRequests: string[];
  shellCalls: Array<{ op: 'openPath'; path: string }>;
  shell: ShellAdapter;
}

declare global {
  var __infinityTest: Pick<TestHooks, 'blockedRequests' | 'shellCalls'> | undefined;
}

/** Test hooks exist only in unpackaged builds started with INFINITY_NOTES_E2E=1. */
export function testHooksEnabled(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isPackaged && env.INFINITY_NOTES_E2E === '1';
}

export function installTestHooks(): TestHooks {
  const blockedRequests: string[] = [];
  const shellCalls: TestHooks['shellCalls'] = [];
  globalThis.__infinityTest = { blockedRequests, shellCalls };
  return {
    blockedRequests,
    shellCalls,
    shell: {
      openPath: async (p) => {
        shellCalls.push({ op: 'openPath', path: p });
        return '';
      },
    },
  };
}
