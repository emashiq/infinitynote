import { useEffect, useState } from 'react';
import type { AppInfoType } from '../shared/contracts/app';
import type { InfinityBridge } from '../shared/contracts/bridge';
import type { WindowGetStateResponseType } from '../shared/contracts/windows';
import { parseRoute, type Route } from '../shared/routes';
import { getBridge } from './bridge';
import { Shell } from './shell/Shell';
import { createAppServices, type AppServices } from './state/app-services';
import { AppServicesContext } from './state/use-store';
import { StartupErrorScreen } from './startup/StartupErrorScreen';
import { dismissStartupLoader } from './startup/startup-loader';
import { StickyApp } from './stickies/StickyApp';
import { WidgetApp } from './widget/WidgetApp';
import { InvalidWindow } from './stickies/StickyView';

type MainIdentity = Extract<WindowGetStateResponseType, { role: 'main' }>;

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
function servicesFor(bridge: InfinityBridge, identity: MainIdentity): AppServices {
  let services = servicesByBridge.get(bridge);
  if (!services) {
    services = createAppServices(bridge, { initialOpens: identity.openNotes, initialReminders: identity.openReminders, initialWidget: identity.widget });
    servicesByBridge.set(bridge, services);
  }
  return services;
}

function ShellRoot({ bridge, identity }: { bridge: InfinityBridge; identity: MainIdentity }) {
  const [services] = useState(() => servicesFor(bridge, identity));
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
  switch (identity.role) {
    case 'main':
      return route.kind === 'main';
    case 'widget':
      return route.kind === 'widget';
    case 'sticky':
      return route.kind === 'sticky' && route.noteId === identity.sticky.noteId;
  }
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

  // The startup loader (D-109) stays while the window loads; the shell removes it once ready, any other screen at once.
  const rendersShell = load.state === 'ready' && load.info.startup.status === 'ok' && load.identity.role === 'main' && routeMatches(route, load.identity);
  useEffect(() => {
    if (load.state !== 'pending' && !rendersShell) dismissStartupLoader({ fade: true });
  }, [load.state, rendersShell]);

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
  if (identity.role === 'sticky') return <StickyApp bridge={api} noteId={identity.sticky.noteId} />;
  if (identity.role === 'widget') return <WidgetApp bridge={api} initial={identity.widget} />;
  return <ShellRoot bridge={api} identity={identity} />;
}
