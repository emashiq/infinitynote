import type { InfinityBridge } from '../../src/shared/contracts/bridge';

declare global {
  interface Window {
    infinity: InfinityBridge;
  }
}
