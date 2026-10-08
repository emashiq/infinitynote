import { createAppServices, type AppDeps, type AppServices } from '../../../../src/renderer/state/app-services';
import { createFakeBridge, type FakeBridge, type FakeBridgeOptions } from './fake-bridge';

let counter = 0;
export const testUuid = () => `44444444-4444-4444-8444-${String(++counter).padStart(12, '0')}`;

/** App services over the fake bridge with no DOM access: fixed viewport, no theme env, no lifecycle hooks. */
export async function setupServices(opts: { width?: number; bridge?: FakeBridgeOptions; fake?: FakeBridge; initialOpens?: AppDeps['initialOpens'] } = {}) {
  const fake = opts.fake ?? createFakeBridge(opts.bridge);
  let width = opts.width ?? 1280;
  const resize: Array<() => void> = [];
  const services: AppServices = createAppServices(fake.bridge, {
    viewport: {
      width: () => width,
      onResize: (cb) => {
        resize.push(cb);
        return () => undefined;
      },
    },
    themeEnv: null,
    lifecycle: null,
    randomUUID: testUuid,
    initialOpens: opts.initialOpens,
  });
  await services.ready;
  return {
    fake,
    services,
    resize(w: number) {
      width = w;
      for (const cb of resize) cb();
    },
  };
}

export const flushMicrotasks = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

export async function makeNote(fake: FakeBridge, location = { projectId: null as string | null, folderId: null as string | null }, title = 'N', sticky = false) {
  const r = await fake.bridge.note.create({ location, sticky, title });
  if (!r.ok) throw new Error('create failed');
  return r.data.note;
}
