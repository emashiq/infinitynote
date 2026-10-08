import { useState } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { StickyServicesContext } from './sticky-context';
import { createStickyServices, type StickyServices } from './sticky-services';
import { StickyView } from './StickyView';

// One StickyServices per bridge: the cache survives StrictMode's double render, like the main window's services.
const servicesByBridge = new WeakMap<InfinityBridge, StickyServices>();
function servicesFor(bridge: InfinityBridge, noteId: string): StickyServices {
  let services = servicesByBridge.get(bridge);
  if (!services) {
    services = createStickyServices(bridge, noteId);
    servicesByBridge.set(bridge, services);
  }
  return services;
}

export function StickyApp({ bridge, noteId }: { bridge: InfinityBridge; noteId: string }) {
  const [services] = useState(() => servicesFor(bridge, noteId));
  return (
    <StickyServicesContext.Provider value={services}>
      <StickyView />
    </StickyServicesContext.Provider>
  );
}
