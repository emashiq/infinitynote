import { createContext, useContext } from 'react';
import type { StickyServices } from './sticky-services';

export const StickyServicesContext = createContext<StickyServices | null>(null);

export function useSticky(): StickyServices {
  const services = useContext(StickyServicesContext);
  if (!services) throw new Error('StickyServicesContext.Provider is missing');
  return services;
}
