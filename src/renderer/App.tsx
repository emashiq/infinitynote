import { useEffect, useState } from 'react';
import type { AppInfoType } from '../shared/contracts/app';
import type { InfinityBridge } from '../shared/contracts/bridge';
import type { AppOpenNoteEventType, WindowGetStateResponseType } from '../shared/contracts/windows';
import { parseRoute, type Route } from '../shared/routes';
import { getBridge } from './bridge';
import { Shell } from './shell/Shell';
import { createAppServices, type AppServices } from './state/app-services';
import { AppServicesContext } from './state/use-store';
import { StartupErrorScreen } from './startup/StartupErrorScreen';
import { StickyApp } from './stickies/StickyApp';
import { InvalidWindow } from './stickies/StickyView';

type Load =
  | { state: 'pending' }
  | { state: 'ready'; info: AppInfoType; identity: WindowGetStateResponseType }
  | { state: 'failed'; message: string };

/**
 * App info and the window's identity from main, asked once per bridge: StrictMode runs effects twice in development,
 * and window:getState hands over the note opens queued for the main window only once (D-071).
 */
const loadsByBridge = new WeakMap<InfinityBridge, Promise<Load>>();
function loadFor(bridge: InfinityBridge): Promise<Load> {
  let load = loadsByBridge.get(bridge);
  if (!load) {
    load = Promise.all([bridge.app.getInfo(), bridge.window.getState()]).then(([info, identity]): Load => {
      if (!info.ok) return { state: 'failed', message: info.error.message };
      if (!identity.ok) return { state: 'failed', message: identity.error.message };
      return { state: 'ready', info: info.data, identity: identity.data };
    });
    loadsByBridge.set(bridge, load);
  }
  return load;
}

// One AppServices per bridge: the cache survives StrictMode's double render, and the window lifecycle
// hooks inside the services flush the active note when the page hides.
const servicesByBridge = new WeakMap<InfinityBridge, AppServices>();
function servicesFor(bridge: InfinityBridge, initialOpens: readonly AppOpenNoteEventType[]): AppServices {
  let services = servicesByBridge.get(bridge);
  if (!services) {
    services = createAppServices(bridge, { initialOpens });
    servicesByBridge.set(bridge, services);
  }
  return services;
}

function ShellRoot({ bridge, initialOpens }: { bridge: InfinityBridge; initialOpens: readonly AppOpenNoteEventType[] }) {
  const [services] = useState(() => servicesFor(bridge, initialOpens));
  return (
    <AppServicesContext.Provider value={services}>
      <Shell />
    </AppServicesContext.Provider>
  );
}

/** The route in the URL is read once (plan section 9.1); main's answer decides what the window is. */
const initialRoute = (): Route => parseRoute(typeof window === 'undefined' ? '' : window.location.hash);

/** The URL must name what main says this window is, so a sticky never renders the main shell (QA-2, D-064). */
function routeMatches(route: Route, identity: WindowGetStateResponseType): boolean {
  if (identity.role === 'main') return route.kind === 'main';
  return route.kind === 'sticky' && route.noteId === identity.sticky.noteId;
}

export function App({ bridge }: { bridge?: InfinityBridge }) {
  const api = bridge ?? getBridge();
  const [route] = useState(initialRoute);
  const [load, setLoad] = useState<Load>({ state: 'pending' });

  useEffect(() => {
    if (route.kind === 'invalid') return undefined;
    let cancelled = false;
    void loadFor(api).then((result) => {
      if (!cancelled) setLoad(result);
    });
    return () => {
      cancelled = true;
    };
  }, [api, route]);

  if (route.kind === 'invalid') return <InvalidWindow />;
  if (load.state === 'pending') return <main aria-busy="true" />;
  if (load.state === 'failed') {
    return (
      <main className="screen-center">
        <p role="alert">{load.message}</p>
      </main>
    );
  }
  const { identity } = load;
  if (!routeMatches(route, identity)) return <InvalidWindow />;
  if (load.info.startup.status === 'error') {
    return <StartupErrorScreen bridge={api} code={load.info.startup.code} />;
  }
  return identity.role === 'sticky' ? (
    <StickyApp bridge={api} noteId={identity.sticky.noteId} />
  ) : (
    <ShellRoot bridge={api} initialOpens={identity.openNotes} />
  );
}
