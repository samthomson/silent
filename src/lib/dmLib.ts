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
  RelayInfo,
} from '@/lib/dmTypes';

export const CACHE_DB_NAME = 'nostr-dm-cache-v2';
export const CACHE_STORE_NAME = 'dm-cache';
export const CACHE_KEY_PREFIX = 'dm-cache:';

const DM_QUERY_CONSTANTS = {
  BATCH_SIZE: 1000,
  QUERY_TIMEOUT_MS: 5000, // 5 seconds per-relay
} as const;

/**
 * Merges two RelayInfo maps, combining status for overlapping relays.
 * Prefers newer data for errors, OR's success flags.
 * 
 * @param olderRelayInfo - First relay info map (older)
 * @param newerRelayInfo - Second relay info map (newer)
 * @returns New merged map with combined status
 */
const mergeRelayInfo = (olderRelayInfo: Map<string, RelayInfo>, newerRelayInfo: Map<string, RelayInfo>): Map<string, RelayInfo> => {
  const merged = new Map(olderRelayInfo);
  
  for (const [relay, info] of newerRelayInfo.entries()) {
    if (!merged.has(relay)) {
      merged.set(relay, { ...info });
    } else {
      const existing = merged.get(relay)!;
      // If either query succeeded, mark as succeeded
      existing.lastQuerySucceeded = existing.lastQuerySucceeded || info.lastQuerySucceeded;
      // Prefer newer error
      existing.lastQueryError = info.lastQueryError || existing.lastQueryError;
      // isBlocked is set later from participant data, not from queries
    }
  }
  
  return merged;
};

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
  event: NostrEvent; // The inner message (kind 4, 14, or 15) with DECRYPTED content
  senderPubkey?: string;
  participants?: string[];
  subject?: string;
  error?: string; // Decryption error message if decryption failed
  // NIP-17 debugging - store the encrypted layers
  sealEvent?: NostrEvent; // For NIP-17: the kind 13 seal (encrypted)
  giftWrapEvent?: NostrEvent; // For NIP-17: the full kind 1059 gift wrap
  giftWrapId?: string; // For NIP-17: gift wrap ID for deduplication
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
/**
 * Deduplicates messages by ID, preferring existing messages over incoming
 * Used when merging cached messages with newly queried messages
 * 
 * @param existing - Messages we already have (from cache)
 * @param incoming - New messages just queried
 * @returns Combined array with duplicates removed (existing takes precedence)
 */
const dedupeMessages = (existing: Message[], incoming: Message[]): Message[] => {
  // Build a set of existing message IDs for O(1) lookup
  const existingIds = new Set(existing.map(m => m.id));
  
  // Filter incoming to only include messages we don't already have
  const newMessages = incoming.filter(m => !existingIds.has(m.id));
  
  // Return existing + new messages
  return [...existing, ...newMessages];
}
/**
 * Computes a unique conversation ID from participants and subject
 * Format: "group:pubkey1,pubkey2:subject" (always consistent)
 * 
 * - Deduplicates and sorts participants for consistent IDs
 * - Same participants + different subjects = different conversations
 * - Subject is always appended (empty string '' for conversations without a subject)
 * - NIP-04 messages: subject is always empty string ''
 * - NIP-17 messages: subject may be populated or empty string ''
 * 
 * @param participantPubkeys - Array of participant pubkeys (including current user)
 * @param subject - Conversation subject (empty string '' for conversations without a subject)
 * @returns Conversation ID in format "group:pubkey1,pubkey2:subject"
 */
const computeConversationId = (participantPubkeys: string[], subject: string): string => {
  // Deduplicate and sort for consistent IDs regardless of order
  const uniqueSorted = [...new Set(participantPubkeys)].sort();
  
  // Always use same format: group:pubkeys:subject
  // This makes parsing simple and consistent everywhere
  return `group:${uniqueSorted.join(',')}:${subject}`;
}

/**
 * Parses a conversation ID to extract participant pubkeys and subject
 * Format: "group:pubkey1,pubkey2:subject"
 * 
 * @param conversationId - The conversation ID in format "group:pubkey1,pubkey2:subject"
 * @returns Object with participantPubkeys array and subject string
 */
const parseConversationId = (conversationId: string): { participantPubkeys: string[]; subject: string } => {
  if (!conversationId.startsWith('group:')) {
    throw new Error(`Invalid conversation ID format: ${conversationId}`);
  }
  
  const withoutPrefix = conversationId.substring(6); // Remove "group:"
  const lastColonIndex = withoutPrefix.lastIndexOf(':');
  
  if (lastColonIndex === -1) {
    throw new Error(`Invalid conversation ID format (missing subject separator): ${conversationId}`);
  }
  
  const participantsString = withoutPrefix.substring(0, lastColonIndex);
  const subject = withoutPrefix.substring(lastColonIndex + 1);
  const participantPubkeys = participantsString.split(',');
  
  return { participantPubkeys, subject };
};

/**
 * Normalizes a relay URL by removing trailing slash for consistent comparison.
 * 
 * @param relay - Relay URL to normalize
 * @returns Normalized relay URL without trailing slash
 */
const normalizeRelayUrl = (relay: string): string => {
  return relay.endsWith('/') ? relay.slice(0, -1) : relay;
};

/**
 * Builds relay information for a conversation, showing which participants use which relays.
 * Groups relays by URL and tracks all users on each relay, sorted by most shared relays first.
 * 
 * @param conversationId - The conversation ID to analyze
 * @param participants - Record of all participants with their relay info
 * @param myPubkey - Current user's pubkey (to mark which relays are "yours")
 * @returns Array of relay info objects with relay URL and user list
 */
const getConversationRelays = (
  conversationId: string,
  participants: Record<string, Participant>,
  myPubkey: string
): Array<{ relay: string; users: Array<{ pubkey: string; isCurrentUser: boolean; source: string }> }> => {
  const { participantPubkeys } = parseConversationId(conversationId);
  const relayMap = new Map<string, Array<{ pubkey: string; isCurrentUser: boolean; source: string }>>();

  // Add all participants' relays
  participantPubkeys.forEach(pubkey => {
    const participant = participants[pubkey];
    if (!participant) return;

    const isCurrentUser = pubkey === myPubkey;
    const relays = participant.derivedRelays || [];
    
    // Determine source based on what relay lists exist
    // (In new architecture, derivedRelays are already computed from available lists)
    const source = isCurrentUser ? 'Your inbox relays' : 'Inbox relays';

    relays.forEach(relay => {
      const normalizedRelay = normalizeRelayUrl(relay);
      if (!relayMap.has(normalizedRelay)) {
        relayMap.set(normalizedRelay, []);
      }
      relayMap.get(normalizedRelay)!.push({
        pubkey,
        isCurrentUser,
        source,
      });
    });
  });

  // Convert map to array and sort by number of users (most shared relays first)
  return Array.from(relayMap.entries())
    .map(([relay, users]) => ({ relay, users }))
    .sort((a, b) => b.users.length - a.users.length);
};

/**
 * Groups messages into conversations by their conversationId
 * 
 * @param messages - Array of messages with conversationId already computed
 * @param myPubkey - The current user's pubkey (currently unused, kept for future validation)
 * @returns Record mapping conversationId to array of messages in that conversation
 */
const groupMessagesIntoConversations = (messages: Message[], myPubkey: string): Record<string, Message[]> => {
  const conversations: Record<string, Message[]> = {};
  
  for (const message of messages) {
    const convId = message.conversationId;
    
    if (!conversations[convId]) {
      conversations[convId] = [];
    }
    
    conversations[convId].push(message);
  }
  
  return conversations;
}
/**
 * Inverts participant->relays structure to relay->users structure
 * Used to determine which users should be queried on each relay
 * 
 * @param participants - Map of pubkey to participant data
 * @returns Map of relay URL to array of pubkeys who use that relay
 */
const buildRelayToUsersMap = (participants: Record<string, Participant>): Map<string, string[]> => {
  const relayMap = new Map<string, string[]>();
  
  for (const [pubkey, participant] of Object.entries(participants)) {
    for (const relayUrl of participant.derivedRelays) {
      if (!relayMap.has(relayUrl)) {
        relayMap.set(relayUrl, []);
      }
      relayMap.get(relayUrl)!.push(pubkey);
    }
  }
  
  return relayMap;
}
/**
 * Filters relay-user map to return only new relay URLs not yet queried
 * 
 * @param relayUserMap - Map of relay URL to array of pubkeys (from buildRelayToUsersMap)
 * @param alreadyQueriedRelays - Relays we've already queried
 * @returns Array of new relay URLs to query
 */
const filterNewRelayUserCombos = (relayUserMap: Map<string, string[]>, alreadyQueriedRelays: string[]): string[] => {
  const alreadyQueriedSet = new Set(alreadyQueriedRelays);
  const newRelays: string[] = [];
  
  for (const relayUrl of relayUserMap.keys()) {
    if (!alreadyQueriedSet.has(relayUrl)) {
      newRelays.push(relayUrl);
    }
  }
  
  return newRelays;
}
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
/**
 * Determines which pubkeys are new based on startup mode
 * 
 * NOTE: Currently just delegates to getNewPubkeys - may be redundant.
 * Revisit to see if mode-specific logic is needed, or remove entirely.
 * 
 * @param foundPubkeys - Pubkeys discovered from messages
 * @param existingPubkeys - Pubkeys we already have participant data for
 * @param mode - Startup mode (cold or warm) - currently unused
 * @returns Array of new pubkeys that need to be fetched
 */
const determineNewPubkeys = (foundPubkeys: string[], existingPubkeys: string[], mode: StartupMode): string[] => {
  // TODO: Revisit if mode-specific logic is needed, or if this function should be removed
  return getNewPubkeys(foundPubkeys, existingPubkeys);
}
/**
 * Converts MessageWithMetadata to Message by adding conversationId and protocol
 * 
 * @param messagesWithMetadata - Decrypted messages with participant and subject info
 * @returns Messages with conversationId and protocol populated
 */
const enrichMessagesWithConversationId = (messagesWithMetadata: MessageWithMetadata[]): Message[] => {
  return messagesWithMetadata.map(msg => ({
    id: msg.event.id,
    event: msg.event, // The inner message with DECRYPTED content
    conversationId: computeConversationId(msg.participants || [], msg.subject || ''),
    protocol: msg.event.kind === 4 ? 'nip04' : 'nip17',
    error: msg.error, // Pass through decryption error flag
    // NIP-17 debugging - copy over encrypted layers
    giftWrapId: msg.giftWrapId,
    sealEvent: msg.sealEvent,
    giftWrapEvent: msg.giftWrapEvent,
  }));
};

/**
 * Adds a single message to existing MessagingState incrementally (for real-time subscriptions).
 * Much more efficient than rebuilding the entire state.
 * 
 * @param currentState - Existing messaging state
 * @param messageWithMetadata - Single new message to add
 * @param myPubkey - Current user's pubkey
 * @returns Updated MessagingState with new message added
 */
const addMessageToState = (
  currentState: MessagingState,
  messageWithMetadata: MessageWithMetadata,
  myPubkey: string
): MessagingState => {
  // Convert to Message with conversationId
  const [enrichedMessage] = enrichMessagesWithConversationId([messageWithMetadata]);
  
  // Check if this message already exists (dedupe by ID or giftWrapId)
  const conversationMessages = currentState.conversationMessages[enrichedMessage.conversationId] || [];
  const exists = conversationMessages.some(msg => 
    msg.id === enrichedMessage.id || 
    (msg.giftWrapId && enrichedMessage.giftWrapId && msg.giftWrapId === enrichedMessage.giftWrapId)
  );
  
  if (exists) {
    return currentState; // Already have this message
  }
  
  // Add message to conversation
  const updatedMessages = [...conversationMessages, enrichedMessage].sort((a, b) => 
    a.event.created_at - b.event.created_at
  );
  
  // Update conversation metadata
  const lastMessage = updatedMessages[updatedMessages.length - 1];
  const hasUserSentMessage = updatedMessages.some(msg => msg.event.pubkey === myPubkey);
  
  const participantPubkeys = messageWithMetadata.participants || [];
  const subject = messageWithMetadata.subject || '';
  
  // Efficiently update protocol flags - use existing values or check new message
  const existingMetadata = currentState.conversationMetadata[enrichedMessage.conversationId];
  const hasNIP17 = (existingMetadata?.hasNIP17) || enrichedMessage.protocol === 'nip17';
  const hasNIP04 = (existingMetadata?.hasNIP04) || enrichedMessage.protocol === 'nip04';
  
  // Check if conversation has any decryption errors
  const hasDecryptionErrors = (existingMetadata?.hasDecryptionErrors) || updatedMessages.some(m => m.error !== undefined);
  
  const updatedMetadata: Conversation = {
    id: enrichedMessage.conversationId,
    participantPubkeys,
    subject,
    lastMessage: {
      decryptedContent: lastMessage.event.content,
      error: lastMessage.error,
    },
    lastActivity: lastMessage.event.created_at,
    lastReadAt: existingMetadata?.lastReadAt || 0,
    isKnown: hasUserSentMessage,
    isRequest: !hasUserSentMessage,
    hasNIP17,
    hasNIP04,
    hasDecryptionErrors,
  };
  
  return {
    ...currentState,
    conversationMessages: {
      ...currentState.conversationMessages,
      [enrichedMessage.conversationId]: updatedMessages,
    },
    conversationMetadata: {
      ...currentState.conversationMetadata,
      [enrichedMessage.conversationId]: updatedMetadata,
    },
  };
};

/**
 * Merges two MessagingState objects, properly combining conversation message arrays.
 * When conversations exist in both states, messages are combined, deduped, and sorted.
 * 
 * @param base - Base messaging state (can be null)
 * @param updates - New messaging state to merge in
 * @returns Merged MessagingState with properly combined conversation messages
 */
const mergeMessagingState = (base: MessagingState | null, updates: MessagingState): MessagingState => {
  if (!base) return updates;
  
  // Merge conversation messages properly - combine and sort arrays for overlapping conversations
  const mergedConversationMessages: Record<string, Message[]> = { ...base.conversationMessages };
  
  for (const [convId, updatedMessages] of Object.entries(updates.conversationMessages)) {
    if (mergedConversationMessages[convId]) {
      // Merge arrays, dedupe by ID, and sort
      const combined = [...mergedConversationMessages[convId], ...updatedMessages];
      const seen = new Set<string>();
      const deduped = combined.filter(msg => {
        const key = msg.giftWrapId || msg.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      mergedConversationMessages[convId] = deduped.sort((a, b) => a.event.created_at - b.event.created_at);
    } else {
      mergedConversationMessages[convId] = updatedMessages;
    }
  }
  
  return {
    ...updates,
    conversationMetadata: { ...base.conversationMetadata, ...updates.conversationMetadata },
    conversationMessages: mergedConversationMessages,
    relayInfo: { ...base.relayInfo, ...updates.relayInfo }
  };
};

/**
 * Builds the complete MessagingState for the app from raw query results
 * Takes decrypted messages and constructs all derived structures needed for the messaging system
 * 
 * @param participants - Record of all participants with their relay info
 * @param messagesFromInitialQuery - Messages from the initial query (step C)
 * @param messagesFromGapFilling - Messages from gap-filling query (step I)
 * @param queriedRelays - List of relays that have been queried
 * @param queryLimitReached - Whether the query limit was reached
 * @returns Complete MessagingState ready for use and caching
 */
const buildMessagingAppState = (
  myPubkey: string,
  participants: Record<string, Participant>,
  messagesFromInitialQuery: MessageWithMetadata[],
  messagesFromGapFilling: MessageWithMetadata[],
  queriedRelays: string[],
  queryLimitReached: boolean,
  relayInfoMap: Map<string, RelayInfo>
): MessagingState => {
  // 1. Convert MessageWithMetadata to Message (add conversationId + protocol)
  const enrichedInitial = enrichMessagesWithConversationId(messagesFromInitialQuery);
  const enrichedGapFill = enrichMessagesWithConversationId(messagesFromGapFilling);
  
  // 2. Dedupe messages (gap-filling may have overlaps with initial query)
  const allMessages = dedupeMessages(enrichedInitial, enrichedGapFill);
  
  // 3. Sort all messages
  const sortedMessages = allMessages.sort((a, b) => a.event.created_at - b.event.created_at);
  
  // 3. Group messages by conversationId
  const conversationMessages = groupMessagesIntoConversations(sortedMessages, '');
  
  // 5. Build Conversation metadata objects from grouped messages
  const conversationMetadata: Record<string, Conversation> = {};
  
  for (const [conversationId, messages] of Object.entries(conversationMessages)) {
    // Parse conversationId: "group:alice,bob:subject"
    const parts = conversationId.split(':');
    const participantPubkeys = parts[1] ? parts[1].split(',') : [];
    const subject = parts[2] || '';
    
    // Find last activity (most recent message timestamp)
    const lastActivity = Math.max(...messages.map(m => m.event.created_at));
    
    // Check protocols used
    const hasNIP04 = messages.some(m => m.protocol === 'nip04');
    const hasNIP17 = messages.some(m => m.protocol === 'nip17');
    
    // Check if any messages have decryption errors
    const hasDecryptionErrors = messages.some(m => m.error !== undefined);
    
    // Get last message for preview
    const lastMsg = messages[messages.length - 1];
    const lastMessage = lastMsg ? {
      decryptedContent: lastMsg.event.content,
      error: lastMsg.error,
    } : null;
    
    // Determine if conversation is known or a request
    // Known = we've sent at least one message, Request = we've only received
    const hasSentMessage = messages.some(m => m.event.pubkey === myPubkey);
    const isKnown = hasSentMessage;
    const isRequest = !hasSentMessage;
    
    conversationMetadata[conversationId] = {
      id: conversationId,
      participantPubkeys,
      subject,
      lastActivity,
      lastReadAt: 0, // Default to unread
      hasNIP04,
      hasNIP17,
      isKnown,
      isRequest,
      lastMessage,
      hasDecryptionErrors,
    };
  }
  
  // 5. Build sync state
  const syncState: SyncState = {
    lastCacheTime: Date.now(),
    queriedRelays,
    queryLimitReached,
  };
  
  // 6. Convert relayInfo map to record and mark blocked relays
  const relayInfo: Record<string, RelayInfo> = {};
  
  for (const [relay, info] of relayInfoMap.entries()) {
    relayInfo[relay] = { ...info };
  }
  
  // Mark relays that the current user has blocked
  const myBlockedRelays = participants[myPubkey]?.blockedRelays || [];
  for (const blockedRelay of myBlockedRelays) {
    if (relayInfo[blockedRelay]) {
      relayInfo[blockedRelay].isBlocked = true;
    }
  }
  
  return {
    participants,
    conversationMetadata,
    conversationMessages,
    syncState,
    relayInfo,
  };
}
/**
 * High-level orchestrator: Extracts new pubkeys from messages that aren't in baseParticipants
 * Combines: extract pubkeys from messages → filter against existing → return new ones
 * 
 * @param messagesWithMetadata - Decrypted messages with metadata
 * @param baseParticipants - Existing participants we already have
 * @param myPubkey - Current user's pubkey to exclude
 * @param mode - Startup mode (currently unused)
 * @returns Pubkeys that need to be fetched
 */
const extractNewPubkeys = (messagesWithMetadata: MessageWithMetadata[], baseParticipants: Record<string, Participant>, myPubkey: string, mode: StartupMode): string[] => {
  // 1. Extract all other pubkeys from messages
  const foundPubkeys = extractOtherPubkeysFromMessages(messagesWithMetadata, myPubkey);
  
  // 2. Get existing pubkeys from baseParticipants
  const existingPubkeys = Object.keys(baseParticipants);
  
  // 3. Determine which are new based on mode
  return determineNewPubkeys(foundPubkeys, existingPubkeys, mode);
}
/**
 * High-level orchestrator: Finds new relays to query based on participants
 * Combines: build relay→users map → filter against already-queried → return new relays
 * Used in Step H to identify relays we should query for gap-filling
 * 
 * @param participants - All participants with their relay info
 * @param alreadyQueried - Relays we've already queried
 * @returns Array of new relay URLs to query
 */
const findNewRelaysToQuery = (participants: Record<string, Participant>, alreadyQueried: string[]): string[] => {
  // 1. Build map of relay -> users
  const relayUserMap = buildRelayToUsersMap(participants);
  
  // 2. Filter to only new relays
  return filterNewRelayUserCombos(relayUserMap, alreadyQueried);
}
/**
 * Computes the complete list of relays queried during initialization
 * Combines initial relays (step C) with new relays (step I) based on startup mode
 * 
 * @param mode - Startup mode (cold or warm)
 * @param lastSessionCache - Cached state from previous session (null in cold start)
 * @param relaySet - Current user's derived relays
 * @param newRelays - New relays discovered in step H/I
 * @returns Complete array of all relays queried
 */
const computeAllQueriedRelays = (mode: StartupMode, lastSessionCache: MessagingState | null, relaySet: string[], newRelays: string[]): string[] => {
  let initialRelays: string[];
  
  if (mode === StartupMode.WARM && lastSessionCache) {
    // Warm start: We queried the relays from last session in step C
    initialRelays = lastSessionCache.syncState.queriedRelays;
  } else {
    // Cold start: We queried the user's current relays in step C
    initialRelays = relaySet;
  }
  
  // Combine initial relays with new relays and deduplicate
  const allRelays = [...initialRelays, ...newRelays];
  return Array.from(new Set(allRelays));
}

export const Pure = {
  Relay: {
    extractBlockedRelays,
    deriveRelaySet,
    findNewRelaysToQuery,
    computeAllQueriedRelays,
    buildRelayToUsersMap,
    filterNewRelayUserCombos,
    mergeRelayInfo,
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
    parseConversationId,
    normalizeRelayUrl,
    getConversationRelays,
    groupMessagesIntoConversations,
  },
  Sync: {
    computeSinceTimestamp,
    buildMessagingAppState,
    addMessageToState,
    mergeMessagingState,
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
const fetchRelayLists = async (nostr: NPool, discoveryRelays: string[], pubkeys: string[]): Promise<{ results: Map<string, RelayListsResult>; relayInfo: Map<string, RelayInfo> }> => {
  if (pubkeys.length === 0) {
    return { results: new Map(), relayInfo: new Map() };
  }

  const results = new Map<string, RelayListsResult>();
  const relayInfo = new Map<string, RelayInfo>();

  // Track results as they complete for early exit optimization
  const completedResults: Array<{ relay: string; success: boolean; events: NostrEvent[]; error: string | null }> = [];
  const majorityThreshold = Math.ceil(discoveryRelays.length * 0.6);
  let majorityResolve: (() => void) | null = null;
  
  const majorityPromise = new Promise<void>((resolve) => {
    majorityResolve = resolve;
  });
  
  // Query each discovery relay individually to track failures
  const relayPromises = discoveryRelays.map(relay =>
    nostr.relay(relay).query(
      [{ kinds: [10002, 10050, 10006], authors: pubkeys }],
      { signal: AbortSignal.timeout(5000) }
    )
      .then(events => {
        const result = { relay, success: true, events, error: null };
        completedResults.push(result);
        if (completedResults.length >= majorityThreshold && majorityResolve) {
          majorityResolve();
        }
        return result;
      })
      .catch(error => {
        const result = { relay, success: false, events: [], error: String(error) };
        completedResults.push(result);
        if (completedResults.length >= majorityThreshold && majorityResolve) {
          majorityResolve();
        }
        return result;
      })
  );

  // Wait for either all relays OR 60% majority (whichever comes first)
  const raceWinner = await Promise.race([
    Promise.allSettled(relayPromises).then(() => 'all'),
    majorityPromise.then(() => 'majority')
  ]);

  // Log early exit if majority completed first
  if (raceWinner === 'majority') {
    console.log(`[DM] Early exit: ${completedResults.length}/${discoveryRelays.length} discovery relays responded (60% threshold)`);
  }

  // Use completed results (at least 60%, possibly all)
  const relayResults = completedResults.map(result => ({ status: 'fulfilled' as const, value: result }));

  // Track relay health for discovery relays
  for (const result of relayResults) {
    if (result.status === 'fulfilled') {
      const { relay, success, error } = result.value;
      relayInfo.set(relay, {
        lastQuerySucceeded: success,
        lastQueryError: error,
        isBlocked: false
      });
    }
  }

  // Combine all events from successful relays
  const allEvents = relayResults
    .filter((r): r is PromiseFulfilledResult<{ relay: string; success: boolean; events: NostrEvent[]; error: string | null }> => r.status === 'fulfilled' && r.value.success)
    .flatMap(r => r.value.events);

  // Group events by pubkey and kind, keep only latest per pubkey+kind
  // This handles cases where different relays return different "latest" events
  const eventsByPubkeyAndKind = new Map<string, NostrEvent>();
  for (const event of allEvents) {
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

  return { results, relayInfo };
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
): Promise<{ messages: NostrEvent[]; limitReached: boolean; relayInfo: Map<string, RelayInfo> }> => {
  const { BATCH_SIZE, QUERY_TIMEOUT_MS } = DM_QUERY_CONSTANTS;
  
  // Initialize 3 separate filter states for independent pagination
  const filterStates: FilterState[] = [
    { kind: 4, pTag: myPubkey, currentSince: since || 0, messagesCollected: 0 },     // NIP-04 TO me
    { kind: 4, author: myPubkey, currentSince: since || 0, messagesCollected: 0 },   // NIP-04 FROM me
    { kind: 1059, pTag: myPubkey, currentSince: since || 0, messagesCollected: 0 }   // NIP-17
  ];
  
  const allMessages: NostrEvent[] = [];
  let totalCollected = 0;
  
  // Track relay info across all queries
  const relayInfo = new Map<string, RelayInfo>();
  
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
            .then(events => ({ relay, success: true, events, error: null }))
            .catch(error => ({ relay, success: false, events: [], error: String(error) }))
        )
      );
      
      // Track relay info
      for (const result of relayResults) {
        if (result.status === 'fulfilled') {
          const { relay, success, error } = result.value;
          if (!relayInfo.has(relay)) {
            relayInfo.set(relay, { lastQuerySucceeded: false, lastQueryError: null, isBlocked: false });
          }
          const info = relayInfo.get(relay)!;
          if (success) {
            info.lastQuerySucceeded = true;
          } else {
            info.lastQueryError = error;
          }
        }
      }
      
      // Combine results from all relays (ignore failures)
      const messages = relayResults
        .filter((r): r is PromiseFulfilledResult<{ relay: string; success: boolean; events: NostrEvent[]; error: string | null }> => r.status === 'fulfilled')
        .flatMap(r => r.value.events);
      
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
    limitReached: totalCollected >= queryLimit,
    relayInfo
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
  
  // Check if we can decrypt
  let decryptedContent: string | undefined;
  let decryptionError: string | undefined;
  
  if (!otherPubkey) {
    decryptionError = 'Missing recipient';
  } else if (!signer.nip04) {
    decryptionError = 'Signer does not support NIP-04';
  } else {
    try {
      decryptedContent = await signer.nip04.decrypt(otherPubkey, msg.content);
    } catch (error) {
      // Decryption failed - could be wrong keys, corrupted message, or not for this account
      decryptionError = 'Unable to decrypt';
    }
  }
  
  // Store decrypted content in the event (or leave encrypted if failed)
  const eventWithDecrypted = {
    ...msg,
    content: decryptedContent || msg.content // Use decrypted or keep original encrypted
  };
  
  return {
    event: eventWithDecrypted,
    senderPubkey: msg.pubkey,
    participants,
    subject: '', // Empty string for NIP-04 (no subject support)
    error: decryptionError, // Pass error flag through
  };
};

const processNIP17Message = async (msg: NostrEvent, signer: Signer): Promise<MessageWithMetadata | null> => {
  if (!signer.nip44) {
    // Signer doesn't have NIP-44 decryption capability
    return {
      event: msg,
      senderPubkey: msg.pubkey,
      participants: [msg.pubkey],
      subject: '',
      error: 'Signer does not support NIP-44',
      giftWrapEvent: msg,
      giftWrapId: msg.id,
    };
  }
  
  try {
    // Step 1: Decrypt gift wrap (kind 1059) to get seal (kind 13)
    const sealContent = await signer.nip44.decrypt(msg.pubkey, msg.content);
    
    // Check if decryption failed
    if (!sealContent || typeof sealContent !== 'string') {
      throw new Error('Invalid seal content');
    }
    
    const seal = JSON.parse(sealContent) as NostrEvent;
    
    if (seal.kind !== 13) {
      throw new Error(`Invalid seal kind: ${seal.kind}`);
    }
    
    // Step 2: Decrypt seal to get inner message (kind 14 or 15)
    const innerContent = await signer.nip44.decrypt(seal.pubkey, seal.content);
    const inner = JSON.parse(innerContent) as NostrEvent;
    
    if (inner.kind !== 14 && inner.kind !== 15) {
      throw new Error(`Invalid inner kind: ${inner.kind}`);
    }
    
    // Step 3: Extract participants from p tags
    const recipients = inner.tags
      .filter(t => t[0] === 'p')
      .map(t => t[1]);
    
    const participants = [seal.pubkey, ...recipients];
    
    // Extract optional subject tag (default to empty string)
    const subject = inner.tags.find(t => t[0] === 'subject')?.[1] || '';
    
    return {
      event: inner, // Store the INNER event (kind 14/15) with DECRYPTED content
      senderPubkey: seal.pubkey, // Real sender is in the seal
      participants,
      subject,
      // Store encrypted layers for debugging
      sealEvent: seal, // Kind 13 with encrypted content
      giftWrapEvent: msg, // Kind 1059 with encrypted seal
      giftWrapId: msg.id // For deduplication
    };
  } catch (error) {
    // Decryption failed - show error in UI rather than hiding the message
    if (process.env.NODE_ENV === 'development') {
      console.debug('[DM] Failed to unwrap gift wrap:', msg.id, error instanceof Error ? error.message : error);
    }
    
    return {
      event: msg,
      senderPubkey: msg.pubkey,
      participants: [msg.pubkey],
      subject: '',
      error: 'Unable to decrypt',
      giftWrapEvent: msg,
      giftWrapId: msg.id,
    };
  }
};

const decryptAllMessages = async (messages: NostrEvent[], signer: Signer, myPubkey: string): Promise<MessageWithMetadata[]> => {
  const results: MessageWithMetadata[] = [];
  let nip04FailCount = 0;
  let nip17FailCount = 0;
  
  for (const msg of messages) {
    if (msg.kind === 4) {
      const result = await processNIP04Message(msg, signer, myPubkey);
      if (result) {
        results.push(result);
      } else {
        nip04FailCount++;
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
  if (nip04FailCount > 0 || nip17FailCount > 0) {
    const parts: string[] = [];
    if (nip04FailCount > 0) parts.push(`${nip04FailCount} NIP-04`);
    if (nip17FailCount > 0) parts.push(`${nip17FailCount} NIP-17`);
    console.log(`[DM] Successfully processed ${results.length} messages, skipped ${parts.join(', ')} undecryptable messages`);
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
    if (!data.participants || !data.conversationMetadata || !data.conversationMessages || !data.syncState || !data.relayInfo) {
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
  const { results: relayListsMap } = await fetchRelayLists(nostr, discoveryRelays, stalePubkeys);
  
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
 * @returns Object with raw relay list events, extracted blocked relay URLs, and discovery relay health
 */
const fetchMyRelayInfo = async (nostr: NPool, discoveryRelays: string[], myPubkey: string): Promise<{ myLists: RelayListsResult; myBlockedRelays: string[]; relayInfo: Map<string, RelayInfo> }> => {
  // Fetch relay lists for the current user
  const { results: relayListsMap, relayInfo } = await fetchRelayLists(nostr, discoveryRelays, [myPubkey]);
  const myLists = relayListsMap.get(myPubkey) || { kind10002: null, kind10050: null, kind10006: null };
  
  // Extract blocked relays from kind 10006
  const myBlockedRelays = extractBlockedRelays(myLists.kind10006);
  
  return {
    myLists,
    myBlockedRelays,
    relayInfo,
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
): Promise<{ messagesWithMetadata: MessageWithMetadata[]; limitReached: boolean; relayInfo: Map<string, RelayInfo> }> => {
  // Fetch raw messages (batched iteration with 3 filters)
  const { messages, limitReached, relayInfo } = await fetchMessages(nostr, relays, myPubkey, since, queryLimit);
  
  // Decrypt all messages (NIP-04 and NIP-17)
  const messagesWithMetadata = await decryptAllMessages(messages, signer, myPubkey);
  
  return { messagesWithMetadata, limitReached, relayInfo };
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
  const { results: relayListsMap } = await fetchRelayLists(nostr, discoveryRelays, newPubkeys);
  
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
): Promise<{ allMessages: MessageWithMetadata[]; limitReached: boolean; relayInfo: Map<string, RelayInfo> }> => {
  // Fetch raw messages from beginning (since=null for gap filling)
  const { messages, limitReached, relayInfo } = await fetchMessages(nostr, relays, myPubkey, null, queryLimit);
  
  // Decrypt all messages (NIP-04 and NIP-17)
  const allMessages = await decryptAllMessages(messages, signer, myPubkey);
  
  return { allMessages, limitReached, relayInfo };
}
/**
 * Builds the complete MessagingState and saves it to cache
 * This is the final step in cold/warm start initialization
 * 
 * @param myPubkey - Current user's pubkey
 * @param participants - All participants with relay info
 * @param messagesFromInitialQuery - Messages from initial query (step C)
 * @param messagesFromGapFilling - Messages from gap-filling (step I)
 * @param allQueriedRelays - Complete list of relays queried
 * @param limitReached - Whether query limit was reached
 * @returns Complete MessagingState (also saved to cache)
 */
const buildAndSaveCache = async (
  myPubkey: string,
  participants: Record<string, Participant>,
  messagesFromInitialQuery: MessageWithMetadata[],
  messagesFromGapFilling: MessageWithMetadata[],
  allQueriedRelays: string[],
  limitReached: boolean,
  relayInfoMap: Map<string, RelayInfo>
): Promise<MessagingState> => {
  // Build the complete app state
  const state = buildMessagingAppState(
    myPubkey,
    participants,
    messagesFromInitialQuery,
    messagesFromGapFilling,
    allQueriedRelays,
    limitReached,
    relayInfoMap
  );
  
  // Save to cache
  await saveToCache(myPubkey, state);
  
  return state;
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

