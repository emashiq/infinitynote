import { useEffect, useState } from 'react';
import type { AppInfoType } from '../shared/contracts/app';
import type { InfinityBridge } from '../shared/contracts/bridge';
import { getBridge } from './bridge';
import { Shell } from './shell/Shell';
import { createAppServices, type AppServices } from './state/app-services';
import { AppServicesContext } from './state/use-store';
import { StartupErrorScreen } from './startup/StartupErrorScreen';

type Load = { state: 'pending' } | { state: 'ready'; info: AppInfoType } | { state: 'failed'; message: string };

// One AppServices per bridge: the cache survives StrictMode's double render, and the window lifecycle
// hooks inside the services flush the active note when the page hides.
const servicesByBridge = new WeakMap<InfinityBridge, AppServices>();
function servicesFor(bridge: InfinityBridge): AppServices {
  let services = servicesByBridge.get(bridge);
  if (!services) {
    services = createAppServices(bridge);
    servicesByBridge.set(bridge, services);
  }
  return services;
}

function ShellRoot({ bridge }: { bridge: InfinityBridge }) {
  const [services] = useState(() => servicesFor(bridge));
  return (
    <AppServicesContext.Provider value={services}>
      <Shell />
    </AppServicesContext.Provider>
  );
}

export function App({ bridge }: { bridge?: InfinityBridge }) {
  const api = bridge ?? getBridge();
  const [load, setLoad] = useState<Load>({ state: 'pending' });

  useEffect(() => {
    let cancelled = false;
    void api.app.getInfo().then((result) => {
      if (cancelled) return;
      setLoad(result.ok ? { state: 'ready', info: result.data } : { state: 'failed', message: result.error.message });
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (load.state === 'pending') return <main aria-busy="true" />;
  if (load.state === 'failed') {
    return (
      <main className="screen-center">
        <p role="alert">{load.message}</p>
      </main>
    );
  }
  if (load.info.startup.status === 'error') {
    return <StartupErrorScreen bridge={api} code={load.info.startup.code} />;
  }
  return <ShellRoot bridge={api} />;
}
