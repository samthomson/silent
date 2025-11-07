import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';

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
        const relays = discoveryRelays.current;
        const map = new Map();
        for (const relay of relays) {
          map.set(relay, filters);
        }
        return map;
      },
      eventRouter(event: NostrEvent) {
        // Publish to all discovery relays by default
        // Special case: when publishing kind 10002 (NIP-65), also publish to
        // the relays specified in the event itself for bootstrapping
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
        
        // For all other events, publish to discovery relays
        // TODO: Use user's NIP-65 write relays when available
        return discoveryRelays.current;
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;