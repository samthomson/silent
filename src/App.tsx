// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from '@unhead/addons';
import { Suspense } from 'react';
import NostrProvider from '@/components/NostrProvider';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NostrLoginProvider } from '@nostrify/react/login';
import { AppProvider } from '@/components/AppProvider';
import { NWCProvider } from '@/contexts/NWCContext';
import { AppConfig } from '@/contexts/AppContext';
import { RELAY_MODE } from '@samthomson/nostr-messaging/core';
import { NewDMProvider } from '@/contexts/NewDMContext';
import { FaviconSync } from '@/components/FaviconSync';
import { NetworkStatus } from '@/components/NetworkStatus';
import AppRouter from './AppRouter';

const head = createHead({
  plugins: [
    InferSeoMetaPlugin(),
  ],
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60000, // 1 minute
      gcTime: Infinity,
    },
  },
});

const persistOptions = {
  persister: createAsyncStoragePersister({
    storage: window.localStorage,
    key: 'silent:cache',
  }),
  maxAge: Infinity, // Profile metadata rarely changes, cache indefinitely
};

const defaultConfig: AppConfig = {
  theme: "dark",
  discoveryRelays: [
    'wss://relay.ditto.pub',
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
    'wss://nos.lol',
  ],
  relayMode: RELAY_MODE.HYBRID,
  renderInlineMedia: true,
};

export function App() {
  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="nostr:app-config" defaultConfig={defaultConfig}>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <NostrLoginProvider storageKey='nostr:login'>
            <NostrProvider>
              <NewDMProvider>
                <FaviconSync />
                <NWCProvider>
                  <TooltipProvider>
                    <NetworkStatus />
                    <Toaster />
                    <Suspense>
                      <AppRouter />
                    </Suspense>
                  </TooltipProvider>
                </NWCProvider>
              </NewDMProvider>
            </NostrProvider>
          </NostrLoginProvider>
        </PersistQueryClientProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

export default App;
