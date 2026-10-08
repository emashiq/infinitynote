import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AppServices } from './app-services';
import type { Store } from './store';

/** Subscribes a component to a store and returns the whole state object (no selectors, so snapshots stay stable). */
export function useStore<S>(store: Store<S>): S {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export const AppServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) throw new Error('AppServicesContext.Provider is missing');
  return services;
}
