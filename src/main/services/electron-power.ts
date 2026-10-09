import { powerMonitor } from 'electron';
import type { PowerEvent, PowerEvents } from './power-events';

/** Power events over Electron's powerMonitor (resume after sleep, screen unlock). */
export const electronPowerEvents: PowerEvents = {
  on(event: PowerEvent, cb: () => void) {
    powerMonitor.on(event as 'resume', cb);
    return () => {
      powerMonitor.removeListener(event as 'resume', cb);
    };
  },
};
