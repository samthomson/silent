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

export interface Signer {
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
// TODO: Implement extractPubkeysFromMessages
const extractPubkeysFromMessages = (messages: MessageWithMetadata[], myPubkey: string): string[] => { return []; }
// TODO: Implement buildMessageFilters
const buildMessageFilters = (myPubkey: string, since: number | null): Array<{ kinds: number[]; '#p'?: string[]; since?: number }> => { return []; }
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
    buildMessageFilters,
    dedupeMessages,
    extractPubkeysFromMessages,
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
// TODO: Implement fetchMessages
const fetchMessages = async (nostr: NPool, relays: string[], filters: Array<{ kinds: number[]; '#p'?: string[]; since?: number }>, queryLimit: number): Promise<{ messages: NostrEvent[]; limitReached: boolean }> => { return { messages: [], limitReached: false }; }
// TODO: Implement unwrapAllGiftWraps
const unwrapAllGiftWraps = async (messages: NostrEvent[], signer: Signer): Promise<MessageWithMetadata[]> => { return []; }
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
// TODO: Implement queryMessages
const queryMessages = async (nostr: NPool, signer: Signer, relays: string[], myPubkey: string, since: number | null, queryLimit: number): Promise<{ messagesWithMetadata: MessageWithMetadata[]; limitReached: boolean }> => {
  return { messagesWithMetadata: [], limitReached: false };
}
// TODO: Implement fetchAndMergeParticipants
const fetchAndMergeParticipants = async (
  nostr: NPool,
  baseParticipants: Record<string, Participant>,
  newPubkeys: string[],
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[]
): Promise<Record<string, Participant>> => { return {}; }
// TODO: Implement queryNewRelays
const queryNewRelays = async (nostr: NPool, signer: Signer, relays: string[], myPubkey: string, queryLimit: number): Promise<{ allMessages: MessageWithMetadata[]; limitReached: boolean }> => {
  return { allMessages: [], limitReached: false };
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
    unwrapAllGiftWraps,
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

