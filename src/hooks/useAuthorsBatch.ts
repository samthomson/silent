import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Hook to batch-fetch metadata for multiple authors at once.
 * 
 * More efficient than calling useAuthor individually for each pubkey.
 * Queries all Kind 0 (metadata) events in a single request.
 * 
 * **Cache Sharing**: This hook automatically populates the individual `useAuthor` cache
 * so that if you later call `useAuthor(pubkey)` for any of these pubkeys, it will use
 * the cached data instead of making another network request. This ensures efficient
 * cache reuse across the app.
 * 
 * @param pubkeys - Array of pubkeys to fetch metadata for
 * @returns Map of pubkey -> metadata/event, with loading state
 * 
 * @example
 * ```tsx
 * import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
 * 
 * function ContactList({ pubkeys }: { pubkeys: string[] }) {
 *   const { data: authorsMap, isLoading } = useAuthorsBatch(pubkeys);
 *   
 *   if (isLoading) return <div>Loading...</div>;
 *   
 *   return (
 *     <div>
 *       {pubkeys.map(pubkey => {
 *         const author = authorsMap?.get(pubkey);
 *         return (
 *           <div key={pubkey}>
 *             {author?.metadata?.name || pubkey}
 *           </div>
 *         );
 *       })}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAuthorsBatch(pubkeys: string[]) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  return useQuery<Map<string, { event?: NostrEvent; metadata?: NostrMetadata }>>({
    queryKey: ['authors-batch', pubkeys.sort().join(',')],
    queryFn: async ({ signal }) => {
      if (pubkeys.length === 0) {
        return new Map();
      }

      // Query all metadata events in one request
      const events = await nostr.query(
        [{ kinds: [0], authors: pubkeys, limit: pubkeys.length }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );

      // Build a map of pubkey -> metadata/event
      const authorsMap = new Map<string, { event?: NostrEvent; metadata?: NostrMetadata }>();

      // Process each event and add to map
      for (const event of events) {
        try {
          const metadata = n.json().pipe(n.metadata()).parse(event.content);
          const authorData = { metadata, event };
          authorsMap.set(event.pubkey, authorData);
          
          // Also populate individual author cache so useAuthor() can reuse this data
          queryClient.setQueryData(['author', event.pubkey], authorData);
        } catch {
          const authorData = { event };
          authorsMap.set(event.pubkey, authorData);
          
          // Also populate individual author cache
          queryClient.setQueryData(['author', event.pubkey], authorData);
        }
      }

      // Add entries for pubkeys that don't have metadata (so consumers know they were queried)
      for (const pubkey of pubkeys) {
        if (!authorsMap.has(pubkey)) {
          const authorData = {};
          authorsMap.set(pubkey, authorData);
          
          // Also populate individual author cache (empty object means we queried but got no data)
          queryClient.setQueryData(['author', pubkey], authorData);
        }
      }

      return authorsMap;
    },
    enabled: pubkeys.length > 0,
    staleTime: 4 * 60 * 60 * 1000, // Keep cached data fresh for 4 hours (profile metadata changes infrequently)
    retry: 2,
  });
}

