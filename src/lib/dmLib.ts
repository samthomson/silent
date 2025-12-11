/* eslint-disable */
// @ts-nocheck
import type { NostrEvent, NPool } from '@nostrify/nostrify';
import type {
  DMSettings,
  Participant,
  Message,
  MessagingState,
  RelayMode,
  RelayListsResult,
} from '@/lib/dmTypes';

interface Signer {
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

interface MessageWithMetadata {
  event: NostrEvent;
  senderPubkey?: string;
  participants?: string[];
  subject?: string;
}

enum StartupMode {
  COLD = 'cold',
  WARM = 'warm',
}

// ============================================================================
// Pure Functions
// ============================================================================

export const extractBlockedRelays = (kind10006: NostrEvent | null): string[] => {}
export const deriveRelaySet = (kind10002: NostrEvent | null, kind10050: NostrEvent | null, blockedRelays: string[], relayMode: RelayMode, discoveryRelays: string[]): string[] => {}
export const getStaleParticipants = (participants: Record<string, Participant>, relayTTL: number, now: number): string[] => {}
export const getNewPubkeys = (foundPubkeys: string[], existingPubkeys: string[]): string[] => {}
export const extractPubkeysFromMessages = (messages: MessageWithMetadata[], myPubkey: string): string[] => {}
export const buildMessageFilters = (myPubkey: string, since: number | null): Array<{ kinds: number[]; '#p'?: string[]; since?: number }> => {}
export const dedupeMessages = (existing: Message[], incoming: Message[]): Message[] => {}
export const computeConversationId = (participantPubkeys: string[], subject: string): string => {}
export const groupMessagesIntoConversations = (messages: Message[], myPubkey: string): Record<string, Message[]> => {}
export const buildRelayToUsersMap = (participants: Record<string, Participant>): Map<string, string[]> => {}
export const filterNewRelayUserCombos = (relayUserMap: Map<string, string[]>, alreadyQueriedRelays: string[]): string[] => {}
export const buildParticipant = (
  publicKey: string,
  lists: RelayListsResult | null,
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[]
): Participant => {}
export const buildParticipantsMap = (
  pubkeys: string[],
  relayListsMap: Map<string, RelayListsResult>,
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[]
): Record<string, Participant> => {}
export const mergeParticipants = (existing: Record<string, Participant>, incoming: Record<string, Participant>): Record<string, Participant> => {}
export const computeSinceTimestamp = (lastCacheTime: number | null, nip17FuzzDays: number): number | null => {}
export const determineNewPubkeys = (foundPubkeys: string[], existingPubkeys: string[], mode: StartupMode): string[] => {}
export const buildCachedData = (participants: Record<string, Participant>, messages: Message[], queriedRelays: string[], queryLimitReached: boolean): MessagingState => {}
export const extractNewPubkeys = (messagesWithMetadata: MessageWithMetadata[], baseParticipants: Record<string, Participant>, myPubkey: string, mode: StartupMode): string[] => {}
export const findNewRelaysToQuery = (participants: Record<string, Participant>, alreadyQueried: string[]): string[] => {}
export const computeAllQueriedRelays = (mode: StartupMode, cached: MessagingState | null, relaySet: string[], newRelays: string[]): string[] => {}

// ============================================================================
// Impure Functions
// ============================================================================

export const fetchRelayLists = async (nostr: NPool, discoveryRelays: string[], pubkeys: string[]): Promise<Map<string, RelayListsResult>> => {}
export const fetchMessages = async (nostr: NPool, relays: string[], filters: Array<{ kinds: number[]; '#p'?: string[]; since?: number }>, queryLimit: number): Promise<{ messages: NostrEvent[]; limitReached: boolean }> => {}
export const unwrapAllGiftWraps = async (messages: NostrEvent[], signer: Signer): Promise<MessageWithMetadata[]> => {}
export const loadFromCache = async (myPubkey: string): Promise<MessagingState | null> => {}
export const saveToCache = async (myPubkey: string, data: MessagingState): Promise<void> => {}
export const refreshStaleParticipants = async (
  nostr: NPool,
  participants: Record<string, Participant>,
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[],
  relayTTL: number
): Promise<Record<string, Participant>> => {}
export const fetchMyRelayInfo = async (nostr: NPool, discoveryRelays: string[], myPubkey: string): Promise<{ myLists: RelayListsResult; myBlockedRelays: string[] }> => {}
export const queryMessages = async (nostr: NPool, signer: Signer, relays: string[], myPubkey: string, since: number | null, queryLimit: number): Promise<{ messagesWithMetadata: MessageWithMetadata[]; limitReached: boolean }> => {}
export const fetchAndMergeParticipants = async (
  nostr: NPool,
  baseParticipants: Record<string, Participant>,
  newPubkeys: string[],
  myBlockedRelays: string[],
  relayMode: RelayMode,
  discoveryRelays: string[]
): Promise<Record<string, Participant>> => {}
export const queryNewRelays = async (nostr: NPool, signer: Signer, relays: string[], myPubkey: string, queryLimit: number): Promise<{ allMessages: MessageWithMetadata[]; limitReached: boolean }> => {}
export const buildAndSaveCache = async (myPubkey: string, participants: Record<string, Participant>, allQueriedRelays: string[], limitReached: boolean): Promise<MessagingState> => {}

