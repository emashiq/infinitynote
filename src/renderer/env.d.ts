/// <reference types="vite/client" />
import type { InfinityBridge } from '../shared/contracts/bridge';

declare global {
  interface Window {
    infinity: InfinityBridge;
  }
}
