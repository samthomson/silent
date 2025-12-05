import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useAppContext } from '@/hooks/useAppContext';
import { RelayResolver } from './RelayResolver';

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Use refs so the pool always has the latest data
  const discoveryRelays = useRef<string[]>(config.discoveryRelays);
  const inboxRelays = useRef<string[]>(config.discoveryRelays); // For reading DMs
  const outboxRelays = useRef<string[]>(config.discoveryRelays); // For reading/writing profiles

  useEffect(() => {
    discoveryRelays.current = config.discoveryRelays;
  }, [config.discoveryRelays]);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        // Relay routing for queries through the default nostr pool
        // NOTE: DMContext bypasses this by using nostr.group() with explicit inbox relays
        // NOTE: useAuthor should implement proper outbox model (fetch target's NIP-65, then query their write relays)
        
        // For now, all queries use discovery relays
        // Individual hooks can use nostr.group() or nostr.relay() for specific relay routing
        const relays = discoveryRelays.current;
        
        // Creates a map where each relay gets the same filters
        const map = new Map();
        for (const relay of relays) {
          map.set(relay, filters);
        }
        return map;
      },
      eventRouter(event: NostrEvent) {
        // Event routing for publishing through the default nostr pool
        // NOTE: DMContext bypasses this by using nostr.group() with explicit relays for DM events
        
        // Profile metadata (kind 0) - publish to outbox relays only
        if (event.kind === 0) {
          console.log('[NostrProvider] Publishing kind 0 to:', outboxRelays.current);
          return outboxRelays.current; // NIP-65 write relays → discovery fallback
        }
        
        // NIP-65 relay list (kind 10002) - publish to discovery + write relays for bootstrapping
        if (event.kind === 10002) {
          const writeRelaysSet = new Set(discoveryRelays.current);
          
          // Add write relays from the event tags for bootstrapping
          for (const tag of event.tags) {
            if (tag[0] === 'r') {
              const url = tag[1];
              const marker = tag[2];
              if (!marker || marker === 'write') {
                writeRelaysSet.add(url);
              }
            }
          }
          
          return Array.from(writeRelaysSet);
        }
        
        // DM inbox relay list (kind 10050) - publish to discovery + write relays for bootstrapping
        if (event.kind === 10050) {
          // Publish to same places as kind 10002 (discovery + your write relays)
          // The inbox relays in the event are READ relays, not where you publish configuration
          return [...new Set([...discoveryRelays.current, ...outboxRelays.current])];
        }
        
        // For all other events, publish to outbox relays
        return outboxRelays.current; // NIP-65 write relays → discovery fallback
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      <RelayResolver 
        inboxRelaysRef={inboxRelays}
        outboxRelaysRef={outboxRelays}
      >
        {children}
      </RelayResolver>
    </NostrContext.Provider>
  );
};

export default NostrProvider;