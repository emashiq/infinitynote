import { useState } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { WidgetStateType } from '../../shared/contracts/widget';
import { NoticeList } from '../shell/Notices';
import { useStore } from '../state/use-store';
import { createWidgetServices, type WidgetServices } from './widget-services';
import { WidgetHeader } from './WidgetHeader';
import { WidgetList } from './WidgetList';

// One WidgetServices per bridge: the cache survives StrictMode's double render, like the other windows' services.
const servicesByBridge = new WeakMap<InfinityBridge, WidgetServices>();
function servicesFor(bridge: InfinityBridge, initial: WidgetStateType): WidgetServices {
  let services = servicesByBridge.get(bridge);
  if (!services) {
    services = createWidgetServices(bridge, initial);
    servicesByBridge.set(bridge, services);
  }
  return services;
}

/** The reminder widget window (`#/widget`, D-081). */
export function WidgetApp({ bridge, initial }: { bridge: InfinityBridge; initial: WidgetStateType }) {
  const [services] = useState(() => servicesFor(bridge, initial));
  const { window: state, pinSupported } = useStore(services.store);
  return (
    <main className="widget-window" data-collapsed={state.collapsed ? 'true' : undefined}>
      <WidgetHeader
        state={state}
        pinSupported={pinSupported}
        actions={{
          togglePinned: () => void services.togglePinned(),
          toggleCollapsed: () => void services.toggleCollapsed(),
          hide: () => void services.hide(),
        }}
      />
      <div className="widget-body" hidden={state.collapsed}>
        <WidgetList services={services} />
      </div>
      <NoticeList notices={services.core.notices} />
    </main>
  );
}
