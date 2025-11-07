import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useAppContext } from './useAppContext';
import type { RelayEntry } from './useRelayList';

/**
 * Fetch NIP-65 relay list for any pubkey (not just current user)
 */
export function useRelayListForPubkey(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const { config } = useAppContext();

  return useQuery({
    queryKey: ['nostr', 'relay-list', pubkey],
    queryFn: async (c) => {
      if (!pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      
      const relayGroup = nostr.group(config.discoveryRelays);
      
      const events = await relayGroup.query(
        [{ kinds: [10002], authors: [pubkey], limit: 1 }],
        { signal }
      );

      if (events.length === 0) return null;

      const event = events[0];
      const relays: RelayEntry[] = [];

      for (const tag of event.tags) {
        if (tag[0] !== 'r') continue;

        const url = tag[1];
        const marker = tag[2];

        if (!url) continue;

        switch (marker) {
          case 'read':
            relays.push({ url, read: true, write: false });
            break;
          case 'write':
            relays.push({ url, read: false, write: true });
            break;
          default:
            relays.push({ url, read: true, write: true });
        }
      }

      return relays;
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
  });
}

