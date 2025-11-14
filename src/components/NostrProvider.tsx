import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import { RelayResolver } from './RelayResolver';

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();

  const queryClient = useQueryClient();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Use refs so the pool always has the latest data
  const discoveryRelays = useRef<string[]>(config.discoveryRelays);
  const activeRelays = useRef<string[]>(config.discoveryRelays);

  // Invalidate Nostr queries when discovery relays change
  useEffect(() => {
    discoveryRelays.current = config.discoveryRelays;
    queryClient.invalidateQueries({ queryKey: ['nostr'] });
  }, [config.discoveryRelays, queryClient]);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        // Use ALL discovery relays for reading
        // Creates a map where each relay gets the same filters
        const relays = activeRelays.current;
        const map = new Map();
        for (const relay of relays) {
          map.set(relay, filters);
        }
        return map;
      },
      eventRouter(event: NostrEvent) {
        // Special case: when publishing kind 10002 (NIP-65), also publish to
        // the write relays specified in the event itself for bootstrapping
        if (event.kind === 10002) {
          const writeRelays = new Set(discoveryRelays.current);
          
          // Add write relays from the event tags
          for (const tag of event.tags) {
            if (tag[0] === 'r') {
              const url = tag[1];
              const marker = tag[2];
              // Include relays marked as write or with no marker (both read+write)
              if (!marker || marker === 'write') {
                writeRelays.add(url);
              }
            }
          }
          
          return Array.from(writeRelays);
        }
        
        // Special case: when publishing kind 10050 (DM inbox relays), also publish to
        // the relays specified in the event itself for bootstrapping
        if (event.kind === 10050) {
          const dmRelays = new Set(discoveryRelays.current);
          
          // Add DM inbox relays from the event tags
          for (const tag of event.tags) {
            if (tag[0] === 'relay') {
              const url = tag[1];
              if (url) dmRelays.add(url);
            }
          }
          
          return Array.from(dmRelays);
        }
        
        // For all other events, publish to discovery relays
        return activeRelays.current;
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      <RelayResolver activeRelaysRef={activeRelays}>
        {children}
      </RelayResolver>
    </NostrContext.Provider>
  );
};

export default NostrProvider;