import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authorQueryOptions } from '@/lib/queryConfig';
import { useAppContext } from '@/hooks/useAppContext';
import { extractOutboxRelays, fetchRelayListsBulk } from '@/lib/relayUtils';
import type { RelayListResult } from '@/hooks/useRelayList';

export function useAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const queryClient = useQueryClient();

  return useQuery<{ event?: NostrEvent; metadata?: NostrMetadata }>({
    queryKey: ['author', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      if (!pubkey) {
        return {};
      }

      // Implement proper outbox model:
      // 1. Check cache for user's relay list
      let cached = queryClient.getQueryData<RelayListResult>(['nostr', 'relay-list', pubkey]);
      
      // 2. If not cached, fetch it from discovery relays
      if (!cached) {
        const relayLists = await fetchRelayListsBulk(nostr, config.discoveryRelays, [pubkey]);
        cached = relayLists.get(pubkey);
        
        // Cache it for future use
        if (cached) {
          queryClient.setQueryData(['nostr', 'relay-list', pubkey], cached);
        }
      }
      
      // 3. Extract their write relays (outbox model)
      const theirWriteRelays = extractOutboxRelays(cached, config.discoveryRelays);
      
      // 4. Query their write relays for their profile
      const relayGroup = nostr.group(theirWriteRelays);
      const [event] = await relayGroup.query(
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) },
      );

      if (!event) {
        return {};
      }

      try {
        const metadata = n.json().pipe(n.metadata()).parse(event.content);
        return { metadata, event };
      } catch {
        return { event };
      }
    },
    ...authorQueryOptions,
  });
}
