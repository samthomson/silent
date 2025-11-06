import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { followsQueryOptions } from '@/lib/queryConfig';

/**
 * Hook to get the list of people the current user follows.
 * 
 * Queries Kind 3 (Contact List) events and extracts pubkeys from `p` tags.
 * 
 * @returns Query result with array of pubkeys that the user follows
 * 
 * @example
 * ```tsx
 * import { useFollows } from '@/hooks/useFollows';
 * 
 * function FollowsList() {
 *   const { data: follows, isLoading } = useFollows();
 *   
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!follows || follows.length === 0) return <div>Not following anyone</div>;
 *   
 *   return (
 *     <div>
 *       {follows.map(pubkey => (
 *         <div key={pubkey}>{pubkey}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFollows() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<string[]>({
    queryKey: ['follows', user?.pubkey ?? ''],
    queryFn: async ({ signal }) => {
      if (!user?.pubkey) {
        return [];
      }

      // Query for Kind 3 (Contact List) - replaceable event, only latest is stored
      const signalWithTimeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query(
        [{ kinds: [3], authors: [user.pubkey], limit: 1 }],
        { signal: signalWithTimeout }
      );

      if (events.length === 0) {
        return [];
      }

      // Get the latest contact list event
      const contactListEvent = events[0];

      // Extract pubkeys from 'p' tags
      // Format: ['p', pubkey, relay_url?, petname?]
      const pubkeys = contactListEvent.tags
        .filter((tag) => tag[0] === 'p' && tag[1])
        .map((tag) => tag[1] as string)
        .filter((pubkey): pubkey is string => typeof pubkey === 'string' && pubkey.length === 64);

      return pubkeys;
    },
    enabled: !!user?.pubkey,
    ...followsQueryOptions,
  });
}

