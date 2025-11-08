import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';

export interface RelayEntry {
  url: string;
  read: boolean;
  write: boolean;
}

export interface RelayListResult {
  relays: RelayEntry[];
  eventId: string;
}

export function useRelayList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();

  return useQuery({
    queryKey: ['nostr', 'relay-list', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      
      const relayGroup = nostr.group(config.discoveryRelays);
      
      const events = await relayGroup.query(
        [{ kinds: [10002], authors: [user.pubkey], limit: 1 }],
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

      return { relays, eventId: event.id };
    },
    enabled: !!user?.pubkey,
    staleTime: 30 * 60 * 1000, // 30 minutes - relay lists change rarely
  });
}

