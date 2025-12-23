/* eslint-disable */
// @ts-nocheck
import type { NostrEvent, NPool } from '@nostrify/nostrify';
import { openDB } from 'idb';
import type {
  DMSettings,
  Participant,
  Message,
  MessagingState,
  RelayMode,
  RelayListsResult,
} from '@/lib/dmTypes';

export const CACHE_DB_NAME = 'nostr-dm-cache-v2';
export const CACHE_STORE_NAME = 'dm-cache';
export const CACHE_KEY_PREFIX = 'dm-cache:';

const DM_QUERY_CONSTANTS = {
  BATCH_SIZE: 1000,
  QUERY_TIMEOUT_MS: 30000, // 30 seconds
} as const;

export interface Signer {
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

export interface MessageWithMetadata {
  event: NostrEvent;
  senderPubkey?: string;
  participants?: string[];
  subject?: string;
}

export enum StartupMode {
  COLD = 'cold',
  WARM = 'warm',
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Extracts blocked relay URLs from a kind 10006 Nostr event.
 * Kind 10006 events contain relay list metadata with blocked relays.
 * Relays are stored in tags with format: ['r', relay_url]
 * 
 * @param kind10006 - The kind 10006 Nostr event or null
 * @returns Array of blocked relay URLs (empty if event is null or has no relay tags)
 */
const extractBlockedRelays = (kind10006: NostrEvent | null): string[] => {
  if (!kind10006) return [];
  
  const relays: string[] = [];
  
  for (const tag of kind10006.tags) {
    // Look for 'r' tags which contain relay URLs
    if (tag[0] === 'r' && tag[1] && typeof tag[1] === 'string') {
      const relayUrl = tag[1].trim();
      if (relayUrl && !relays.includes(relayUrl)) {
        relays.push(relayUrl);
      }
    }
  }
  
  return relays;
}
/**
 * Derives the set of relays to use for querying messages based on relay mode and user's relay lists.
 * 
 * Priority for relay selection (when using user's lists):
 * 1. Kind 10050 (DM inbox relays) - highest priority
 * 2. Kind 10002 read relays (NIP-65)
 * 
 * Relay modes:
 * - DISCOVERY: Use only discovery relays (ignore user's lists completely)
 * - HYBRID: Use user's relays + discovery relays (combine both)
 * - STRICT_OUTBOX: Use only user's relays (no fallback - returns empty if user has no relays)
 * 
 * @param kind10002 - NIP-65 relay list event (kind 10002)
 * @param kind10050 - DM inbox relay list event (kind 10050)
 * @param blockedRelays - List of relay URLs to exclude
 * @param relayMode - Relay mode determining which relays to use
 * @param discoveryRelays - Default discovery relays
 * @returns Deduplicated array of relay URLs to query, with blocked relays filtered out
 */
const deriveRelaySet = (kind10002: NostrEvent | null, kind10050: NostrEvent | null, kind10006: NostrEvent | null, relayMode: RelayMode, discoveryRelays: string[]): { derivedRelays: string[]; blockedRelays: string[] } => {
  // Extract blocked relays
  const blockedRelays = extractBlockedRelays(kind10006);
  
  // Discovery mode: only use discovery relays, ignore user's lists
  if (relayMode === 'discovery') {
    return {
      derivedRelays: discoveryRelays,
      blockedRelays
    };
  }
  
  // For hybrid and strict_outbox modes: extract user's relays
  const relaySet = new Set<string>();
  
  // Priority 1: Kind 10050 (DM inbox relays)
  if (kind10050) {
    kind10050.tags
      .filter(tag => tag[0] === 'relay' && tag[1])
      .map(tag => tag[1].trim())
      .filter(url => url)
      .forEach(relay => relaySet.add(relay));
  }
  
  // Priority 2: Kind 10002 read relays (if no 10050 or in hybrid mode)
  if (kind10002 && (relaySet.size === 0 || relayMode === 'hybrid')) {
    kind10002.tags
      .filter(tag => {
        if (tag[0] !== 'r' || !tag[1]) return false;
        const marker = tag[2];
        // Include if no marker (both read/write) or explicitly marked as 'read'
        return !marker || marker === 'read';
      })
      .map(tag => tag[1].trim())
      .filter(url => url)
      .forEach(relay => relaySet.add(relay));
  }
  
  // Hybrid mode: add discovery relays too
  if (relayMode === 'hybrid') {
    discoveryRelays.forEach(relay => relaySet.add(relay));
  }
  
  return {
    derivedRelays: Array.from(relaySet),
    blockedRelays
  };
}
/**
 * Returns pubkeys of participants whose relay information is stale (older than TTL).
 * 
 * @param participants - Record of participants to check
 * @param relayTTL - Time-to-live for relay info in milliseconds
 * @param now - Current timestamp in milliseconds
 * @returns Array of pubkeys that need refreshing
 */
const getStaleParticipants = (participants: Record<string, Participant>, relayTTL: number, now: number): string[] => {
  const staleThreshold = now - relayTTL;
  const stalePubkeys: string[] = [];
  
  for (const [pubkey, participant] of Object.entries(participants)) {
    if (participant.lastFetched < staleThreshold) {
      stalePubkeys.push(pubkey);
    }
  }
  
  return stalePubkeys;
}
/**
 * Returns pubkeys that are in foundPubkeys but not in existingPubkeys.
 * This is used to identify new participants that need to be fetched.
 * 
 * @param foundPubkeys - Array of pubkeys that were discovered
 * @param existingPubkeys - Array of pubkeys we already have
 * @returns Array of new pubkeys (preserves order from foundPubkeys, deduplicates)
 */
const getNewPubkeys = (foundPubkeys: string[], existingPubkeys: string[]): string[] => {
  const existingSet = new Set(existingPubkeys);
  const newSet = new Set<string>();
  
  for (const pubkey of foundPubkeys) {
    if (!existingSet.has(pubkey)) {
      newSet.add(pubkey);
    }
  }
  
  return Array.from(newSet);
}
/**
 * Extracts all unique pubkeys from messages (excluding current user)
 * Used to discover other participants whose relay info we need to fetch
 * @param messages - Array of messages with metadata
 * @param myPubkey - Current user's pubkey to exclude
 * @returns Array of unique pubkeys found in messages (other participants only)
 */
const extractOtherPubkeysFromMessages = (messages: MessageWithMetadata[], myPubkey: string): string[] => {
  const pubkeysSet = new Set<string>();
  
  for (const msg of messages) {
    // Add sender pubkey
    if (msg.senderPubkey && msg.senderPubkey !== myPubkey) {
      pubkeysSet.add(msg.senderPubkey);
    }
    
    // Add all participants
    if (msg.participants) {
      for (const pubkey of msg.participants) {
        if (pubkey && pubkey !== myPubkey) {
          pubkeysSet.add(pubkey);
        }
      }
    }
  }
  
  return Array.from(pubkeysSet);
}
// TODO: Implement dedupeMessages
const dedupeMessages = (existing: Message[], incoming: Message[]): Message[] => { return []; }
// TODO: Implement computeConversationId
const computeConversationId = (participantPubkeys: string[], subject: string): string => { return ''; }
// TODO: Implement groupMessagesIntoConversations
const groupMessagesIntoConversations = (messages: Message[], myPubkey: string): Record<string, Message[]> => { return {}; }
// TODO: Implement buildRelayToUsersMap
const buildRelayToUsersMap = (participants: Record<string, Participant>): Map<string, string[]> => { return new Map(); }
// TODO: Implement filterNewRelayUserCombos
const filterNewRelayUserCombos = (relayUserMap: Map<string, string[]>, alreadyQueriedRelays: string[]): string[] => { return []; }
/**
 * Builds a Participant object from relay lists.
 * Uses deriveRelaySet to extract relays based on priority and relay mode.
 * 
 * @param pubkey - The participant's public key
 * @param lists - The participant's relay lists (kind 10002, 10050, 10006)
 * @param relayMode - The relay mode to use (discovery/strict_outbox/hybrid)
 * @param discoveryRelays - Fallback discovery relays
 * @returns A complete Participant object
 */
const buildParticipant = (
  pubkey: string,
  lists: RelayListsResult,
  relayMode: RelayMode,
  discoveryRelays: string[]
): Participant => {
  const { derivedRelays, blockedRelays } = deriveRelaySet(
    lists.kind10002,
    lists.kind10050,
    lists.kind10006,
    relayMode,
    discoveryRelays
  );
  
  return {
    pubkey,
    derivedRelays,
    blockedRelays,
    lastFetched: Date.now()
  };
}
/**
 * Builds a map of Participants from a list of pubkeys and their relay lists.
 * 
 * @param pubkeys - Array of public keys to build participants for
 * @param relayListsMap - Map of pubkey to relay lists
 * @param relayMode - The relay mode to use
 * @param discoveryRelays - Fallback discovery relays
 * @returns Record mapping pubkey to Participant
 */
const buildParticipantsMap = (
  pubkeys: string[],
  relayListsMap: Map<string, RelayListsResult>,
  relayMode: RelayMode,
  discoveryRelays: string[]
): Record<string, Participant> => {
  const participants: Record<string, Participant> = {};
  
  for (const pubkey of pubkeys) {
    const lists = relayListsMap.get(pubkey)!;
    participants[pubkey] = buildParticipant(pubkey, lists, relayMode, discoveryRelays);
  }
  
  return participants;
}
/**
 * Merges two participant records, with incoming participants taking precedence.
 * If a participant exists in both records, the incoming one replaces the existing one.
 * 
 * @param existing - The existing participant records
 * @param incoming - The incoming participant records (these take precedence)
 * @returns A new merged record with all participants
 */
const mergeParticipants = (existing: Record<string, Participant>, incoming: Record<string, Participant>): Record<string, Participant> => {
  return { ...existing, ...incoming };
}
/**
 * Computes the 'since' timestamp for fetching messages, accounting for NIP-17 timestamp fuzzing.
 * NIP-17 allows timestamps to be fuzzed for privacy, so we need to query from before the last cache time
 * to ensure we don't miss messages that were timestamp-fuzzed.
 * 
 * @param lastCacheTime - The unix timestamp (in seconds) of the last cache time, or null if no cache exists
 * @param nip17FuzzDays - The number of days of timestamp fuzzing to account for
 * @returns The computed since timestamp (in seconds), or null if lastCacheTime is null
 */
const computeSinceTimestamp = (lastCacheTime: number | null, nip17FuzzDays: number): number | null => {
  if (lastCacheTime === null) {
    return null;
  }
  
  // Convert days to seconds: days * 24 hours * 60 minutes * 60 seconds
  const fuzzSeconds = nip17FuzzDays * 24 * 60 * 60;
  
  // Subtract the fuzz period from the last cache time to ensure we catch all messages
  return lastCacheTime - fuzzSeconds;
}
// TODO: Implement determineNewPubkeys
const determineNewPubkeys = (foundPubkeys: string[], existingPubkeys: string[], mode: StartupMode): string[] => { return []; }
// TODO: Implement buildCachedData
const buildCachedData = (participants: Record<string, Participant>, messages: Message[], queriedRelays: string[], queryLimitReached: boolean): MessagingState => {
  return {
    participants: {},
    conversations: {},
    messages: {},
    syncState: { lastCacheTime: null, queriedRelays: [], queryLimitReached: false },
    relayInfo: {},
  };
}
// TODO: Implement extractNewPubkeys
const extractNewPubkeys = (messagesWithMetadata: MessageWithMetadata[], baseParticipants: Record<string, Participant>, myPubkey: string, mode: StartupMode): string[] => { return []; }
// TODO: Implement findNewRelaysToQuery
const findNewRelaysToQuery = (participants: Record<string, Participant>, alreadyQueried: string[]): string[] => { return []; }
// TODO: Implement computeAllQueriedRelays
const computeAllQueriedRelays = (mode: StartupMode, cached: MessagingState | null, relaySet: string[], newRelays: string[]): string[] => { return []; }

export const Pure = {
  Relay: {
    extractBlockedRelays,
    deriveRelaySet,
    findNewRelaysToQuery,
    computeAllQueriedRelays,
    buildRelayToUsersMap,
    filterNewRelayUserCombos,
  },
  Message: {
    dedupeMessages,
    extractOtherPubkeysFromMessages,
  },
  Participant: {
    buildParticipant,
    buildParticipantsMap,
    mergeParticipants,
    getStaleParticipants,
    getNewPubkeys,
    extractNewPubkeys,
    determineNewPubkeys,
  },
  Conversation: {
    computeConversationId,
    groupMessagesIntoConversations,
  },
  Sync: {
    computeSinceTimestamp,
    buildCachedData,
  },
};

// ============================================================================
// Impure Functions
// ============================================================================

/**
 * Fetches relay list events (kinds 10002, 10050, 10006) for multiple pubkeys.
 * Returns raw Nostr events instead of parsed relay lists.
 * Similar to fetchRelayListsBulk in relayUtils.ts but returns raw events.
 * 
 * @param nostr - Nostr pool instance
 * @param discoveryRelays - Relays to query for relay lists
 * @param pubkeys - Array of pubkeys to fetch relay lists for
 * @returns Map of pubkey to RelayListsResult with raw events
 */
const fetchRelayLists = async (nostr: NPool, discoveryRelays: string[], pubkeys: string[]): Promise<Map<string, RelayListsResult>> => {
  if (pubkeys.length === 0) {
    return new Map();
  }

  const relayGroup = nostr.group(discoveryRelays);
  const results = new Map<string, RelayListsResult>();

  try {
    // Single query for all pubkeys, fetch kinds 10002, 10050, and 10006
    // Replaceable events: each relay stores only the latest per pubkey+kind
    const events = await relayGroup.query(
      [{ kinds: [10002, 10050, 10006], authors: pubkeys }],
      { signal: AbortSignal.timeout(15000) }
    );

    // Group events by pubkey and kind, keep only latest per pubkey+kind
    // This handles cases where different relays return different "latest" events
    const eventsByPubkeyAndKind = new Map<string, NostrEvent>();
    for (const event of events) {
      const key = `${event.pubkey}:${event.kind}`;
      const existing = eventsByPubkeyAndKind.get(key);
      if (!existing || event.created_at > existing.created_at) {
        eventsByPubkeyAndKind.set(key, event);
      }
    }

    // Build RelayListsResult for each pubkey
    for (const pubkey of pubkeys) {
      const result: RelayListsResult = {
        kind10002: eventsByPubkeyAndKind.get(`${pubkey}:10002`) || null,
        kind10050: eventsByPubkeyAndKind.get(`${pubkey}:10050`) || null,
        kind10006: eventsByPubkeyAndKind.get(`${pubkey}:10006`) || null,
      };
      
      results.set(pubkey, result);
    }
  } catch (error) {
    console.error('[DM] Failed to fetch relay lists:', error);
  }

  return results;
}
interface FilterState {
  kind: number;
  pTag?: string;
  author?: string;
  currentSince: number;
  messagesCollected: number;
}

/**
 * Fetches messages from relays with batched pagination.
 * Queries 3 separate filters in parallel (NIP-04 TO, NIP-04 FROM, NIP-17).
 * Each filter maintains independent timestamp tracking for pagination.
 * Queries all relays in parallel per batch for performance.
 * 
 * @param nostr - Nostr pool
 * @param relays - List of relay URLs to query
 * @param myPubkey - Current user's pubkey
 * @param since - Starting timestamp (null = from beginning)
 * @param queryLimit - Maximum total messages to fetch
 * @returns Object with messages array and limitReached flag
 */
const fetchMessages = async (
  nostr: NPool,
  relays: string[],
  myPubkey: string,
  since: number | null,
  queryLimit: number
): Promise<{ messages: NostrEvent[]; limitReached: boolean }> => {
  const { BATCH_SIZE, QUERY_TIMEOUT_MS } = DM_QUERY_CONSTANTS;
  
  // Initialize 3 separate filter states for independent pagination
  const filterStates: FilterState[] = [
    { kind: 4, pTag: myPubkey, currentSince: since || 0, messagesCollected: 0 },     // NIP-04 TO me
    { kind: 4, author: myPubkey, currentSince: since || 0, messagesCollected: 0 },   // NIP-04 FROM me
    { kind: 1059, pTag: myPubkey, currentSince: since || 0, messagesCollected: 0 }   // NIP-17
  ];
  
  const allMessages: NostrEvent[] = [];
  let totalCollected = 0;
  
  // Iterate until all filters exhausted or limit reached
  while (totalCollected < queryLimit) {
    // Get filters that haven't reached their limit yet
    const activeFilters = filterStates.filter(f => f.messagesCollected < queryLimit);
    if (activeFilters.length === 0) break;
    
    // Query each active filter in parallel
    const batchPromises = activeFilters.map(async (state) => {
      const batchLimit = Math.min(BATCH_SIZE, queryLimit - state.messagesCollected);
      
      // Build filter for this specific type
      const filter: any = {
        kinds: [state.kind],
        limit: batchLimit,
        since: state.currentSince,
        ...(state.pTag && { '#p': [state.pTag] }),
        ...(state.author && { authors: [state.author] })
      };
      
      // Query all relays in parallel for this filter
      const relayResults = await Promise.allSettled(
        relays.map(relay =>
          nostr.relay(relay).query([filter], { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) })
        )
      );
      
      // Combine results from all relays (ignore failures)
      const messages = relayResults
        .filter((r): r is PromiseFulfilledResult<NostrEvent[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);
      
      // Deduplicate by event ID (same message from multiple relays)
      const seen = new Set<string>();
      const uniqueMessages = messages.filter(msg => {
        if (seen.has(msg.id)) return false;
        seen.add(msg.id);
        return true;
      });
      
      // Update state for next iteration
      if (uniqueMessages.length > 0) {
        state.messagesCollected += uniqueMessages.length;
        // Update currentSince to oldest message timestamp for backward pagination
        state.currentSince = Math.min(...uniqueMessages.map(m => m.created_at));
      }
      
      return {
        state,
        messages: uniqueMessages,
        exhausted: uniqueMessages.length < batchLimit
      };
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Collect all messages from this batch
    for (const result of batchResults) {
      allMessages.push(...result.messages);
      totalCollected += result.messages.length;
      
      // Mark filter as exhausted if we got fewer messages than requested
      if (result.exhausted) {
        result.state.messagesCollected = queryLimit; // Mark as done
      }
    }
    
    // Break if all filters are exhausted
    if (batchResults.every(r => r.exhausted)) break;
  }
  
  return {
    messages: allMessages,
    limitReached: totalCollected >= queryLimit
  };
}
/**
 * Unwraps and decrypts messages to extract metadata.
 * - NIP-04 (kind 4): Decrypts content using NIP-04 encryption
 * - NIP-17 (kind 1059): Fully unwraps gift wrap → seal → inner message
 * 
 * @param messages - Raw Nostr events (kind 4 or 1059)
 * @param signer - Signer with NIP-04 and NIP-44 decryption capability
 * @returns Array of messages with extracted metadata
 */
const processNIP04Message = async (msg: NostrEvent, signer: Signer, myPubkey: string): Promise<MessageWithMetadata | null> => {
  const recipientPubkey = msg.tags.find(t => t[0] === 'p')?.[1];
  const participants = [msg.pubkey, recipientPubkey].filter(Boolean) as string[];
  
  // For NIP-04, we need the "other pubkey" to decrypt
  // If I'm the sender, decrypt with recipient's pubkey; if I'm the recipient, decrypt with sender's pubkey
  const otherPubkey = msg.pubkey === myPubkey ? recipientPubkey : msg.pubkey;
  
  let decryptedContent: string | undefined;
  if (otherPubkey && signer.nip04) {
    try {
      decryptedContent = await signer.nip04.decrypt(otherPubkey, msg.content);
    } catch (error) {
      console.warn('[DM] Failed to decrypt NIP-04 message:', msg.id, error);
    }
  }
  
  // Store decrypted content in the event's content field for MessageWithMetadata
  const eventWithDecrypted = {
    ...msg,
    content: decryptedContent || msg.content // Use decrypted or fallback to encrypted
  };
  
  return {
    event: eventWithDecrypted,
    senderPubkey: msg.pubkey,
    participants,
    subject: '' // Empty string for NIP-04 (no subject support)
  };
};

const processNIP17Message = async (msg: NostrEvent, signer: Signer): Promise<MessageWithMetadata | null> => {
  if (!signer.nip44) {
    console.warn('[DM] NIP-44 not available, skipping gift wrap:', msg.id);
    return null;
  }
  
  try {
    // Step 1: Decrypt gift wrap (kind 1059) to get seal (kind 13)
    const sealContent = await signer.nip44.decrypt(msg.pubkey, msg.content);
    
    // Check if decryption failed
    if (!sealContent || typeof sealContent !== 'string') {
      // Silently skip - likely not intended for us or malformed
      return null;
    }
    
    const seal = JSON.parse(sealContent) as NostrEvent;
    
    if (seal.kind !== 13) {
      console.warn('[DM] Invalid seal kind:', seal.kind, 'expected 13');
      return null;
    }
    
    // Step 2: Decrypt seal to get inner message (kind 14 or 15)
    const innerContent = await signer.nip44.decrypt(seal.pubkey, seal.content);
    const inner = JSON.parse(innerContent) as NostrEvent;
    
    if (inner.kind !== 14 && inner.kind !== 15) {
      console.warn('[DM] Invalid inner kind:', inner.kind, 'expected 14 or 15');
      return null;
    }
    
    // Step 3: Extract participants from p tags
    const recipients = inner.tags
      .filter(t => t[0] === 'p')
      .map(t => t[1]);
    
    const participants = [seal.pubkey, ...recipients];
    
    // Extract optional subject tag (default to empty string)
    const subject = inner.tags.find(t => t[0] === 'subject')?.[1] || '';
    
    return {
      event: inner, // Store the INNER event (kind 14/15), not the gift wrap
      senderPubkey: seal.pubkey, // Real sender is in the seal
      participants,
      subject
    };
  } catch (error) {
    // Silently skip gift wraps we can't decrypt
    // (likely not intended for us, corrupted, or wrong protocol version)
    // Log only in debug mode to reduce noise
    if (process.env.NODE_ENV === 'development') {
      console.debug('[DM] Failed to unwrap gift wrap:', msg.id, error instanceof Error ? error.message : error);
    }
    return null;
  }
};

const decryptAllMessages = async (messages: NostrEvent[], signer: Signer, myPubkey: string): Promise<MessageWithMetadata[]> => {
  const results: MessageWithMetadata[] = [];
  let nip17FailCount = 0;
  
  for (const msg of messages) {
    if (msg.kind === 4) {
      const result = await processNIP04Message(msg, signer, myPubkey);
      if (result) {
        results.push(result);
      }
    } else if (msg.kind === 1059) {
      const result = await processNIP17Message(msg, signer);
      if (result) {
        results.push(result);
      } else {
        nip17FailCount++;
      }
    }
  }
  
  // Log summary if there were failures
  if (nip17FailCount > 0) {
    console.log(`[DM] Successfully processed ${results.length} messages, skipped ${nip17FailCount} undecryptable NIP-17 gift wraps`);
  }
  
  return results;
};
const loadFromCache = async (myPubkey: string): Promise<MessagingState | null> => {
  try {
    const db = await openDB(CACHE_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
          db.createObjectStore(CACHE_STORE_NAME);
        }
      },
    });
    
    const key = `${CACHE_KEY_PREFIX}${myPubkey}`;
    const data = await db.get(CACHE_STORE_NAME, key);
    
    if (!data) return null;
    
    // Basic structure validation
    if (!data.participants || !data.conversations || !data.messages || !data.syncState || !data.relayInfo) {
      console.error('[DM Cache] Invalid cache structure, missing required keys');
      return null;
    }
    
    return data as MessagingState;
  } catch (error) {
    console.error('[DM Cache] Error loading from cache:', error);
    return null;
  }
}
const saveToCache = async (myPubkey: string, data: MessagingState): Promise<void> => {
  try {
    const db = await openDB(CACHE_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
          db.createObjectStore(CACHE_STORE_NAME);
        }
      },
    });
    
    const key = `${CACHE_KEY_PREFIX}${myPubkey}`;
    await db.put(CACHE_STORE_NAME, data, key);
    db.close();
  } catch (error) {
    console.error('[DM Cache] Error saving to cache:', error);
    throw error;
  }
}
/**
 * Refreshes participants whose relay information is stale (exceeds TTL).
 * Fetches updated relay lists for stale participants and merges with existing.
 * 
 * @param nostr - Nostr pool for querying
 * @param participants - Existing participants to check for staleness
 * @param relayMode - Relay mode to use when building updated participants
 * @param discoveryRelays - Discovery relays for fetching
 * @param relayTTL - Time-to-live for relay info in milliseconds
 * @returns Updated participants record with refreshed stale entries
 */
const refreshStaleParticipants = async (
  nostr: NPool,
  participants: Record<string, Participant>,
  relayMode: RelayMode,
  discoveryRelays: string[],
  relayTTL: number
): Promise<Record<string, Participant>> => {
  // 1. Find stale participants
  const stalePubkeys = getStaleParticipants(participants, relayTTL, Date.now());
  
  // 2. If no stale participants, return original
  if (stalePubkeys.length === 0) {
    return participants;
  }
  
  // 3. Fetch fresh relay lists for stale participants
  const relayListsMap = await fetchRelayLists(nostr, discoveryRelays, stalePubkeys);
  
  // 4. Build updated participants
  const updatedParticipants = buildParticipantsMap(stalePubkeys, relayListsMap, relayMode, discoveryRelays);
  
  // 5. Merge with existing (updated take precedence)
  return mergeParticipants(participants, updatedParticipants);
}
/**
 * Fetches the current user's relay lists and extracts their blocked relays.
 * Convenience function that combines fetchRelayLists + extractBlockedRelays for the current user.
 * 
 * @param nostr - Nostr pool instance
 * @param discoveryRelays - Relays to query for relay lists
 * @param myPubkey - The current user's pubkey
 * @returns Object with raw relay list events and extracted blocked relay URLs
 */
const fetchMyRelayInfo = async (nostr: NPool, discoveryRelays: string[], myPubkey: string): Promise<{ myLists: RelayListsResult; myBlockedRelays: string[] }> => {
  // Fetch relay lists for the current user
  const relayListsMap = await fetchRelayLists(nostr, discoveryRelays, [myPubkey]);
  const myLists = relayListsMap.get(myPubkey) || { kind10002: null, kind10050: null, kind10006: null };
  
  // Extract blocked relays from kind 10006
  const myBlockedRelays = extractBlockedRelays(myLists.kind10006);
  
  return {
    myLists,
    myBlockedRelays,
  };
}
/**
 * Queries messages from specified relays for the current user (Step C in cold/warm start).
 * Fetches both NIP-04 and NIP-17 messages, unwraps gift wraps, and returns metadata.
 * 
 * @param nostr - Nostr pool
 * @param signer - Signer for decryption
 * @param relays - Relays to query
 * @param myPubkey - Current user's pubkey
 * @param since - Starting timestamp (null for cold start, timestamp for warm start)
 * @param queryLimit - Maximum messages to fetch
 * @returns Messages with metadata and limitReached flag
 */
const queryMessages = async (
  nostr: NPool,
  signer: Signer,
  relays: string[],
  myPubkey: string,
  since: number | null,
  queryLimit: number
): Promise<{ messagesWithMetadata: MessageWithMetadata[]; limitReached: boolean }> => {
  // Fetch raw messages (batched iteration with 3 filters)
  const { messages, limitReached } = await fetchMessages(nostr, relays, myPubkey, since, queryLimit);
  
  // Decrypt all messages (NIP-04 and NIP-17)
  const messagesWithMetadata = await decryptAllMessages(messages, signer, myPubkey);
  
  return { messagesWithMetadata, limitReached };
}
/**
 * Fetches relay lists for new pubkeys and merges them with existing participants.
 * Preserves baseParticipants (including current user) and adds new participants.
 * 
 * @param nostr - Nostr pool for querying relays
 * @param baseParticipants - Existing participants (including current user)
 * @param newPubkeys - New pubkeys to fetch relay lists for
 * @param relayMode - Relay mode for deriving relay sets
 * @param discoveryRelays - Discovery relays to use as fallback
 * @returns Merged participants map (baseParticipants + new participants)
 */
const fetchAndMergeParticipants = async (
  nostr: NPool,
  baseParticipants: Record<string, Participant>,
  newPubkeys: string[],
  relayMode: RelayMode,
  discoveryRelays: string[]
): Promise<Record<string, Participant>> => {
  // If no new pubkeys, just return base participants
  if (newPubkeys.length === 0) {
    return baseParticipants;
  }
  
  // Fetch relay lists for new pubkeys
  const relayListsMap = await fetchRelayLists(nostr, discoveryRelays, newPubkeys);
  
  // Build participants for new pubkeys
  const newParticipants = buildParticipantsMap(newPubkeys, relayListsMap, relayMode, discoveryRelays);
  
  // Merge with base participants (base takes precedence - keeps current user intact)
  return mergeParticipants(newParticipants, baseParticipants);
}
/**
 * Queries newly discovered relays for messages (Step I in cold/warm start).
 * Always queries from the beginning (since=null) to find gaps in message history.
 * 
 * @param nostr - Nostr pool
 * @param signer - Signer for decryption
 * @param relays - New relays to query
 * @param myPubkey - Current user's pubkey
 * @param queryLimit - Maximum messages to fetch
 * @returns Messages with metadata and limitReached flag
 */
const queryNewRelays = async (
  nostr: NPool,
  signer: Signer,
  relays: string[],
  myPubkey: string,
  queryLimit: number
): Promise<{ allMessages: MessageWithMetadata[]; limitReached: boolean }> => {
  // Fetch raw messages from beginning (since=null for gap filling)
  const { messages, limitReached } = await fetchMessages(nostr, relays, myPubkey, null, queryLimit);
  
  // Decrypt all messages (NIP-04 and NIP-17)
  const allMessages = await decryptAllMessages(messages, signer, myPubkey);
  
  return { allMessages, limitReached };
}
// TODO: Implement buildAndSaveCache
const buildAndSaveCache = async (myPubkey: string, participants: Record<string, Participant>, allQueriedRelays: string[], limitReached: boolean): Promise<MessagingState> => {
  return {
    participants: {},
    conversations: {},
    messages: {},
    syncState: { lastCacheTime: null, queriedRelays: [], queryLimitReached: false },
    relayInfo: {},
  };
}

export const Impure = {
  Relay: {
    fetchRelayLists,
    fetchMyRelayInfo,
  },
  Message: {
    fetchMessages,
    processNIP04Message,
    processNIP17Message,
    decryptAllMessages,
    queryMessages,
    queryNewRelays,
  },
  Participant: {
    refreshStaleParticipants,
    fetchAndMergeParticipants,
  },
  Cache: {
    loadFromCache,
    saveToCache,
    buildAndSaveCache,
  },
};

