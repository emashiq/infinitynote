import type { InfinityBridge } from '../shared/contracts/bridge';

export function getBridge(): InfinityBridge {
  return window.infinity;
}
