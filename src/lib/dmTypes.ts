import type { NostrEvent } from '@nostrify/nostrify';

export const RELAY_MODE = {
  DISCOVERY: 'discovery',
  HYBRID: 'hybrid',
  STRICT_OUTBOX: 'strict_outbox',
} as const;

export type RelayMode = typeof RELAY_MODE[keyof typeof RELAY_MODE];

export interface DMSettings {
  discoveryRelays: string[];
  relayMode: RelayMode;
  relayTTL: number;
  queryLimit: number;
}

export interface Participant {
  pubkey: string;
  derivedRelays: string[]; // Their relay list (unfiltered by our blocks)
  blockedRelays: string[]; // Their kind 10006 blocked relay list
  lastFetched: number;
}

export interface Conversation {
  id: string;
  participantPubkeys: string[];
  subject: string;
  lastActivity: number;
  lastReadAt: number;
  hasNIP04: boolean;
  hasNIP17: boolean;
  isKnown: boolean;
  isRequest: boolean;
  lastMessage: { decryptedContent?: string; error?: string } | null;
  hasDecryptionErrors: boolean; // True if any messages failed to decrypt
}

export interface Message {
  id: string;
  event: NostrEvent; // The actual message event (kind 4, 14, or 15) with DECRYPTED content
  conversationId: string;
  protocol: 'nip04' | 'nip17';
  giftWrapId?: string; // For NIP-17: the ID of the wrapping kind 1059 event
  // NIP-17 debugging - store the full seal and gift wrap
  sealEvent?: NostrEvent; // For NIP-17: the kind 13 seal (encrypted)
  giftWrapEvent?: NostrEvent; // For NIP-17: the full kind 1059 gift wrap
  // Decryption errors
  error?: string;
  // UI state
  isSending?: boolean;
  clientFirstSeen?: number;
}

export interface RelayInfo {
  lastQuerySucceeded: boolean;
  lastQueryError: string | null;
  isBlocked: boolean;
}

export interface SyncState {
  lastCacheTime: number | null;
  queriedRelays: string[];
  queryLimitReached: boolean;
}

export interface MessagingState {
  participants: Record<string, Participant>;
  conversationMetadata: Record<string, Conversation>;
  conversationMessages: Record<string, Message[]>;
  syncState: SyncState;
  relayInfo: Record<string, RelayInfo>;
  settingsFingerprint?: string; // Hash of settings that affect derived state
}

export interface RelayListsResult {
  kind10002: NostrEvent | null;
  kind10050: NostrEvent | null;
  kind10006: NostrEvent | null;
}

