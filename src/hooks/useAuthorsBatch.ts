import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppContext } from '@/hooks/useAppContext';

const CHUNK_SIZE = 100; // Fetch metadata for 100 authors at a time

/**
 * Hook to batch-fetch metadata for multiple authors.
 * 
 * Optimized for both small and large lists. It:
 * 1. Returns immediately with an empty Map so UI can render with fallback names
 * 2. Fetches metadata in chunks (100 at a time) in the background
 * 3. Updates the returned Map incrementally as chunks arrive
 * 4. Populates individual `useAuthor` caches so they can reuse data
 * 
 * Works efficiently for any list size - small lists (< 100) complete quickly,
 * large lists (1000+) progressively fill in without blocking the UI.
 * 
 * **Cache Sharing**: This hook automatically populates the individual `useAuthor` cache
 * so that if you later call `useAuthor(pubkey)` for any of these pubkeys, it will use
 * the cached data instead of making another network request.
 * 
 * @param pubkeys - Array of pubkeys to fetch metadata for
 * @returns Map that grows incrementally, plus loading/fetching states
 * 
 * @example
 * ```tsx
 * import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
 * 
 * function ContactList({ pubkeys }: { pubkeys: string[] }) {
 *   const { data: authorsMap, isFetching } = useAuthorsBatch(pubkeys);
 *   
 *   // UI can render immediately with fallback names, metadata fills in as chunks arrive
 *   return (
 *     <div>
 *       {pubkeys.map(pubkey => {
 *         const author = authorsMap?.get(pubkey);
 *         return (
 *           <div key={pubkey}>
 *             {author?.metadata?.name || genUserName(pubkey)}
 *           </div>
 *         );
 *       })}
 *       {isFetching && <div>Loading metadata...</div>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAuthorsBatch(pubkeys: string[]) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { config } = useAppContext();
  
  // Memoize relay group to prevent recreating on every render
  const relayGroup = useMemo(
    () => nostr.group(config.discoveryRelays),
    [nostr, config.discoveryRelays]
  );
  
  // Accumulated results Map that grows as chunks arrive
  const [authorsMap, setAuthorsMap] = useState<Map<string, { event?: NostrEvent; metadata?: NostrMetadata }>>(new Map());
  const [isFetching, setIsFetching] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  
  // Track which chunks we've already fetched to avoid duplicates
  const fetchedChunks = useRef(new Set<string>());
  const abortControllerRef = useRef<AbortController | null>(null);

  // Process a chunk of events and update state
  const processChunk = useCallback((events: NostrEvent[], chunkPubkeys: string[]) => {
    const chunkMap = new Map<string, { event?: NostrEvent; metadata?: NostrMetadata }>();

    // Process each event from this chunk
    for (const event of events) {
      let authorData: { event?: NostrEvent; metadata?: NostrMetadata };
      
      try {
        const metadata = n.json().pipe(n.metadata()).parse(event.content);
        authorData = { metadata, event };
      } catch {
        authorData = { event };
      }
      
      chunkMap.set(event.pubkey, authorData);
    }

    // Add entries for pubkeys in this chunk that don't have metadata
    for (const pubkey of chunkPubkeys) {
      if (!chunkMap.has(pubkey)) {
        chunkMap.set(pubkey, {});
      }
    }

    // Merge into accumulated map and populate individual author caches
    setAuthorsMap(prev => {
      const merged = new Map(prev);
      chunkMap.forEach((authorData, pubkey) => {
        merged.set(pubkey, authorData);
        // Populate individual author cache (same pattern for all)
        queryClient.setQueryData(['author', pubkey], authorData);
      });
      return merged;
    });

    setLoadedCount(prev => prev + chunkPubkeys.length);
  }, [queryClient]);

  // Fetch a single chunk
  const fetchChunk = useCallback(async (chunkPubkeys: string[], chunkKey: string) => {
    if (fetchedChunks.current.has(chunkKey)) {
      return; // Already fetched this chunk
    }
    
    fetchedChunks.current.add(chunkKey);
    setIsFetching(true);

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const events = await relayGroup.query(
        [{ kinds: [0], authors: chunkPubkeys, limit: chunkPubkeys.length }],
        { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(5000)]) }
      );

      // Only process if not aborted
      if (!abortController.signal.aborted) {
        processChunk(events, chunkPubkeys);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Expected when component unmounts or pubkeys change
        return;
      }
      console.error('[useAuthorsBatch] Error fetching chunk:', error);
    } finally {
      setIsFetching(false);
    }
  }, [relayGroup, processChunk]);

  // Main effect: split pubkeys into chunks and fetch them
  const pubkeysString = pubkeys.join(',');
  useEffect(() => {
    if (pubkeys.length === 0) {
      setAuthorsMap(new Map());
      setLoadedCount(0);
      setIsFetching(false);
      fetchedChunks.current.clear();
      return;
    }

    // Pre-populate map from React Query cache before fetching
    const cachedMap = new Map<string, { event?: NostrEvent; metadata?: NostrMetadata }>();
    let cachedCount = 0;
    
    for (const pubkey of pubkeys) {
      const cachedData = queryClient.getQueryData<{ event?: NostrEvent; metadata?: NostrMetadata }>(['author', pubkey]);
      if (cachedData && (cachedData.metadata || cachedData.event)) {
        cachedMap.set(pubkey, cachedData);
        cachedCount++;
      }
    }
    
    // Initialize with cached data
    setAuthorsMap(cachedMap);
    setLoadedCount(cachedCount);
    setIsFetching(pubkeys.length > cachedCount);
    fetchedChunks.current.clear();

    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Only fetch pubkeys that aren't already cached
    const pubkeysToFetch = pubkeys.filter(pubkey => !cachedMap.has(pubkey));
    
    if (pubkeysToFetch.length === 0) {
      // All data is cached, no need to fetch
      return;
    }

    // Split uncached pubkeys into chunks
    const chunks: string[][] = [];
    for (let i = 0; i < pubkeysToFetch.length; i += CHUNK_SIZE) {
      chunks.push(pubkeysToFetch.slice(i, i + CHUNK_SIZE));
    }

    // Fetch chunks sequentially (to avoid overwhelming relay)
    // We could do parallel but sequential is safer for large lists
    let currentChunk = 0;
    
    const fetchNextChunk = async () => {
      if (currentChunk >= chunks.length) {
        setIsFetching(false);
        return;
      }

      const chunk = chunks[currentChunk];
      const chunkKey = chunk.sort().join(',');
      
      await fetchChunk(chunk, chunkKey);
      
      currentChunk++;
      
      // Small delay between chunks to avoid rate limiting
      if (currentChunk < chunks.length) {
        setTimeout(fetchNextChunk, 100);
      } else {
        setIsFetching(false);
      }
    };

    fetchNextChunk();

    // Cleanup: abort in-flight requests
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [pubkeysString, pubkeys.length, pubkeys, fetchChunk, queryClient]); // Re-run when pubkeys change

  return {
    data: authorsMap,
    isFetching, // True while chunks are being fetched in the background
    loadedCount, // Number of pubkeys we've loaded metadata for
    totalCount: pubkeys.length,
  };
}

