'use client';

import { createContext, useContext, type ReactNode } from 'react';

const StoreStagingContext = createContext(false);

export function StoreRuntime({ staging, children }: { staging: boolean; children: ReactNode }) {
  return <StoreStagingContext.Provider value={staging}>{children}</StoreStagingContext.Provider>;
}

export function useStoreStaging() {
  return useContext(StoreStagingContext);
}
