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
// TODO: Implement deriveRelaySet
const deriveRelaySet = (kind10002: NostrEvent | null, kind10050: NostrEvent | null, blockedRelays: string[], relayMode: RelayMode, discoveryRelays: string[]): string[] => { return []; }
// TODO: Implement getStaleParticipants
const getStaleParticipants = (participants: Record<string, Participant>, relayTTL: number, now: number): string[] => { return []; }
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
// TODO: Implement buildParticipant
const buildParticipant = (
  publicKey: string,
  lists: RelayListsResult | null,
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[]
): Participant => { return { pubkey: publicKey, derivedRelays: [], blockedRelays: [], lastFetched: 0 }; }
// TODO: Implement buildParticipantsMap
const buildParticipantsMap = (
  pubkeys: string[],
  relayListsMap: Map<string, RelayListsResult>,
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[]
): Record<string, Participant> => { return {}; }
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
// TODO: Implement refreshStaleParticipants
const refreshStaleParticipants = async (
  nostr: NPool,
  participants: Record<string, Participant>,
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[],
  relayTTL: number
): Promise<Record<string, Participant>> => { return {}; }
// TODO: Implement fetchMyRelayInfo
const fetchMyRelayInfo = async (nostr: NPool, discoveryRelays: string[], myPubkey: string): Promise<{ myLists: RelayListsResult; myBlockedRelays: string[] }> => {
  return {
    myLists: { kind10002: null, kind10050: null, kind10006: null },
    myBlockedRelays: [],
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

