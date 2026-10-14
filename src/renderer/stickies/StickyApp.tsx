import { useCallback, useState } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { DateOrder } from '../../shared/time/typed-date';
import type { ZoomAction } from '../../shared/zoom';
import { useZoomKeys } from '../zoom/use-zoom-keys';
import { StickyServicesContext } from './sticky-context';
import { createStickyServices, type StickyServices } from './sticky-services';
import { StickyView } from './StickyView';

// One StickyServices per bridge: the cache survives StrictMode's double render, like the main window's services.
const servicesByBridge = new WeakMap<InfinityBridge, StickyServices>();
function servicesFor(bridge: InfinityBridge, noteId: string, dateOrder: DateOrder): StickyServices {
  let services = servicesByBridge.get(bridge);
  if (!services) {
    services = createStickyServices(bridge, noteId, { dateOrder });
    servicesByBridge.set(bridge, services);
  }
  return services;
}

export function StickyApp({ bridge, noteId, dateOrder }: { bridge: InfinityBridge; noteId: string; dateOrder: DateOrder }) {
  const [services] = useState(() => servicesFor(bridge, noteId, dateOrder));
  // Every sticky shares one zoom, kept by main (D-186).
  useZoomKeys(useCallback((action: ZoomAction) => void bridge.window.zoom({ action }), [bridge]));
  return (
    <StickyServicesContext.Provider value={services}>
      <StickyView />
    </StickyServicesContext.Provider>
  );
}
