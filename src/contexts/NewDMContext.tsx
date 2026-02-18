/* eslint-disable */
// @ts-nocheck
import { createContext, useContext, ReactNode, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useNetworkState } from '@/hooks/useNetworkState';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { getDisplayName } from '@/lib/genUserName';
import type { NPool, NostrMetadata } from '@nostrify/nostrify';
import { RELAY_MODE } from '@samthomson/nostr-messaging/core';
import Fuse from 'fuse.js';
import type {
  DMSettings,
  MessagingState,
  Participant,
} from '@samthomson/nostr-messaging/core';
import * as DMLib from '@samthomson/nostr-messaging/core';
import type { Signer } from '@samthomson/nostr-messaging/core';
import { PROTOCOL_MODE, type ProtocolMode, type MessageProtocol, NEW_DM_PHASES, type NewDMPhase, MESSAGE_PROTOCOL } from '@samthomson/nostr-messaging/core';
import type { ConversationRelayInfo } from '@samthomson/nostr-messaging/core';
import type { NostrEvent } from '@nostrify/nostrify';
import type { FileAttachment } from '@samthomson/nostr-messaging/core';
const MESSAGES_PER_PAGE = 25;

// lastReadAt is stored in ms; message.event.created_at is Unix seconds (inner event for NIP-17).
const countUnread = (messages: { event: { created_at: number; pubkey: string }; senderPubkey?: string }[], lastReadAt: number, userPubkey: string): number => {
  const lastReadAtMs = lastReadAt >= 1e12 ? lastReadAt : lastReadAt * 1000;
  return messages.filter(msg => {
    const messageTimeMs = msg.event.created_at * 1000;
    const fromOther = (msg.senderPubkey || msg.event.pubkey) !== userPubkey;
    return messageTimeMs > lastReadAtMs && fromOther;
  }).length;
};

// Simple notification function - add your sound/notification logic here
const handleNewMessage = (conversationId: string, authorPubkey: string, content: string): void => {
  console.log('🔔 New message:', { conversationId, from: authorPubkey.slice(0, 8), content: content.slice(0, 50) });
  // TODO: Add sound notification here
  // TODO: Add browser notification here
  // TODO: Add title flashing here
};

const DEFAULT_RELAY_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const DEFAULT_QUERY_LIMIT = 20000;

// Re-export FileAttachment from dmLib
export type { FileAttachment } from '@samthomson/nostr-messaging/core';

// ============================================================================
// Orchestrators
// ============================================================================

const initialiseMessaging = async (
  nostr: NPool, 
  signer: Signer, 
  myPubkey: string, 
  settings: DMSettings,
  updateContext: (updates: Partial<MessagingContext>) => void
): Promise<MessagingState> => {
  const timings: Record<string, number> = {};
  const startTime = Date.now();
  
  const cached = await DMLib.Impure.Cache.loadFromCache(myPubkey);
  timings.loadCache = Date.now() - startTime;
  
  // Check if cache is invalid due to settings change (safety net for edge cases)
  const isRestartingAfterSettingsFingerprintChange = (() => {
    if (!cached?.settingsFingerprint) return false;
    
    const currentFingerprint = DMLib.Pure.Settings.computeFingerprint({
      discoveryRelays: settings.discoveryRelays,
      relayMode: settings.relayMode,
    });
    
    if (cached.settingsFingerprint !== currentFingerprint) {
      console.log('[NewDM] Settings mismatch - forcing cold start', {
        cached: cached.settingsFingerprint,
        current: currentFingerprint,
      });
      return true;
    }
    
    return false;
  })();
  
  // Determine startup mode
  const mode = (cached && cached.syncState.lastCacheTime && !isRestartingAfterSettingsFingerprintChange)
    ? DMLib.StartupMode.WARM
    : DMLib.StartupMode.COLD;
  
  console.log('[NewDM] Mode:', mode, cached ? `(cache age: ${Math.round((Date.now() - (cached.syncState.lastCacheTime || 0)) / 1000)}s)` : '');
  
  // UPDATE 1: Show cached data immediately
  let currentState: MessagingState | null = null;
  
  if (cached && mode === DMLib.StartupMode.WARM) {
    const cachedConvoCount = Object.keys(cached.conversationMetadata || {}).length;
    if (cachedConvoCount > 0) {
      console.log(`[NewDM] 📦 Showing cache (${cachedConvoCount} convos) - ${Date.now() - startTime}ms`);
      currentState = cached;
      updateContext({ messagingState: cached, phase: NEW_DM_PHASES.CACHE, isLoading: true, timing: timings });
    }
  }
  
  // A. Fetch my relay lists
  console.log('[NewDM] A. Fetching my relay lists...');
  const stepA = Date.now();
  const { myLists, myBlockedRelays, relayInfo: discoveryRelayInfo } = await DMLib.Impure.Relay.fetchMyRelayInfo(nostr, settings.discoveryRelays, myPubkey);
  timings.fetchMyRelays = Date.now() - stepA;
  console.log('[NewDM] A. My relay lists:', { has10002: !!myLists.kind10002, has10050: !!myLists.kind10050, has10006: !!myLists.kind10006 });
  
  // Log discovery relay health
  const discoverySucceeded = Array.from(discoveryRelayInfo.values()).filter(r => r.lastQuerySucceeded).length;
  console.log('[NewDM] A. Discovery relays:', `${discoverySucceeded}/${settings.discoveryRelays.length} succeeded`);
  
  // B. Derive my relay set and blocked relays
  console.log('[NewDM] B. Deriving my relay set...');
  const { derivedRelays, blockedRelays } = DMLib.Pure.Relay.deriveRelaySet(myLists.kind10002, myLists.kind10050, myLists.kind10006, settings.relayMode, settings.discoveryRelays);
  console.log('[NewDM] B. My derived relays:', { count: derivedRelays.length, relays: derivedRelays, blockedCount: blockedRelays.length });
  
  // B.1 Create my participant entry (single source of truth for my relay info)
  const myParticipant: Participant = {
    pubkey: myPubkey,
    derivedRelays,
    blockedRelays,
    lastFetched: Date.now()
  };
  
  // B.2 Initialize base participants (warm start: refresh from cache, cold start: empty)
  const stepB2 = Date.now();
  const refreshedParticipants = mode === DMLib.StartupMode.WARM
    ? await DMLib.Impure.Participant.refreshStaleParticipants(nostr, cached.participants, settings.relayMode, settings.discoveryRelays, settings.relayTTL)
    : {};
  timings.refreshParticipants = Date.now() - stepB2;
  const baseParticipants = { ...refreshedParticipants, [myPubkey]: myParticipant };
  console.log('[NewDM] B.2 Base participants:', Object.keys(baseParticipants));
  
  // C. Query messages
  console.log('[NewDM] C. Querying messages...');
  const stepC = Date.now();
  const lastCacheTimeInSeconds = cached?.syncState.lastCacheTime ? Math.floor(cached.syncState.lastCacheTime / 1000) : null;
  const since = mode === DMLib.StartupMode.WARM ? DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTimeInSeconds, 2) : null;
  const queryRelays = mode === DMLib.StartupMode.WARM ? (cached?.syncState?.queriedRelays ?? baseParticipants[myPubkey].derivedRelays) : baseParticipants[myPubkey].derivedRelays;
  console.log('[NewDM] C. Query config:', { 
    relays: queryRelays, 
    since: since ? new Date(since * 1000).toISOString() : 'beginning of time',
    sinceUnix: since,
    mode 
  });
  const { messagesWithMetadata, limitReached: isLimitReachedDuringInitialQuery, relayInfo: relayInfoFromInitial } = await DMLib.Impure.Message.queryMessages(nostr, signer, queryRelays, myPubkey, since, settings.queryLimit);
  timings.queryMessages = Date.now() - stepC;
  
  // Detailed logging for debugging
  const nip04Count = messagesWithMetadata.filter(m => m.event.kind === 4).length;
  const nip17Count = messagesWithMetadata.filter(m => m.event.kind === 14 || m.event.kind === 15).length;
  const uniqueParticipants = new Set(messagesWithMetadata.flatMap(m => m.participants || []));
  
  console.log('[NewDM] C. Got messages:', {
    total: messagesWithMetadata.length,
    nip04: nip04Count,
    nip17: nip17Count,
    uniqueParticipants: uniqueParticipants.size,
    limitReached: isLimitReachedDuringInitialQuery,
    sample: messagesWithMetadata.slice(0, 3).map(m => ({
      kind: m.event.kind,
      senderPubkey: m.senderPubkey?.substring(0, 8),
      participants: m.participants?.map(p => p.substring(0, 8)),
      subject: m.subject,
      timestamp: new Date(m.event.created_at * 1000).toISOString()
    }))
  });
  
  // Log full array for inspection (collapsed in console)
  console.groupCollapsed('[NewDM] C. All messages (click to expand)');
  console.log('Full array:', messagesWithMetadata);
  console.table(messagesWithMetadata.slice(0, 10).map(m => ({
    kind: m.event.kind,
    sender: m.senderPubkey?.substring(0, 12) + '...',
    participantCount: m.participants?.length || 0,
    subject: m.subject || '(none)',
    date: new Date(m.event.created_at * 1000).toLocaleString()
  })));
  console.groupEnd();
  
  // UPDATE 2: Process initial query messages and merge with current state
  // Always update to show progress (relay health, timing) even if 0 new messages
  console.log(`[NewDM] 📨 Initial query (${messagesWithMetadata.length} msgs) - ${Date.now() - startTime}ms`);
  
  const newState = DMLib.Pure.Sync.buildMessagingAppState(
    myPubkey,
    baseParticipants,
    messagesWithMetadata,
    [],
    baseParticipants[myPubkey].derivedRelays,
    isLimitReachedDuringInitialQuery,
    relayInfoFromInitial
  );
  
  currentState = currentState ? DMLib.Pure.Sync.mergeMessagingState(currentState, newState) : newState;
  updateContext({ messagingState: currentState, phase: NEW_DM_PHASES.INITIAL_QUERY, isLoading: true, timing: timings });
  
  // D. Extract unique users
  console.log('[NewDM] D. Extracting new pubkeys...');
  const newPubkeys = DMLib.Pure.Participant.extractNewPubkeys(messagesWithMetadata, baseParticipants, myPubkey);
  console.log('[NewDM] D. New pubkeys:', newPubkeys);
  
  // E+F. Fetch relay lists and merge participants
  console.log('[NewDM] E+F. Fetching and merging participants...');
  const stepEF = Date.now();
  const participants = await DMLib.Impure.Participant.fetchAndMergeParticipants(nostr, baseParticipants, newPubkeys, settings.relayMode, settings.discoveryRelays);
  timings.fetchAndMergeParticipants = Date.now() - stepEF;
  console.log('[NewDM] E+F. Final participants:', Object.keys(participants), 'includes me?', myPubkey in participants);
  
  // H. Find new relays to query
  const newRelays = DMLib.Pure.Relay.findNewRelaysToQuery(participants, queryRelays);
  console.log('[NewDM] H. New relays to query:', newRelays);
  
  // I. Query new relays
  const stepI = Date.now();
  const { allMessages: messagesFromGapFilling, limitReached: isLimitReachedDuringGapQuery, relayInfo: relayInfoFromGapFilling } = await DMLib.Impure.Message.queryNewRelays(nostr, signer, newRelays, myPubkey, settings.queryLimit);
  timings.queryNewRelays = Date.now() - stepI;
  console.log('[NewDM] I. Gap-filling messages:', messagesFromGapFilling.length);
  
  // J. Merge relay info from all phases (discovery + initial query + gap-filling)
  let combinedRelayInfo = DMLib.Pure.Relay.mergeRelayInfo(relayInfoFromInitial, relayInfoFromGapFilling);
  
  // Add discovery relay info
  for (const [relay, info] of discoveryRelayInfo.entries()) {
    if (!combinedRelayInfo.has(relay)) {
      combinedRelayInfo.set(relay, info);
    }
  }
  
  // UPDATE 3: Process gap-filling messages and save final state
  const allQueriedRelays = DMLib.Pure.Relay.computeAllQueriedRelays(mode, cached, participants[myPubkey].derivedRelays, newRelays);
  const stepK = Date.now();
  
  const gapFillingState = DMLib.Pure.Sync.buildMessagingAppState(
    myPubkey,
    participants,
    messagesWithMetadata,
    messagesFromGapFilling,
    allQueriedRelays,
    isLimitReachedDuringInitialQuery || isLimitReachedDuringGapQuery,
    combinedRelayInfo
  );
  
  currentState = DMLib.Pure.Sync.mergeMessagingState(currentState, gapFillingState);
  
  // Add settings fingerprint before saving (for cache validation on next load)
  currentState = {
    ...currentState,
    settingsFingerprint: DMLib.Pure.Settings.computeFingerprint({
      discoveryRelays: settings.discoveryRelays,
      relayMode: settings.relayMode,
    }),
  };
  
  // Save to cache
  await DMLib.Impure.Cache.saveToCache(myPubkey, currentState);
  
  timings.buildAndSave = Date.now() - stepK;
  timings.total = Date.now() - startTime;
  
  console.log(`[NewDM] ✅ Complete - ${Object.keys(currentState!.conversationMetadata).length} convos, ${timings.total}ms`);
  
  updateContext({ messagingState: currentState, phase: NEW_DM_PHASES.COMPLETE, isLoading: false, timing: timings });
  
  return currentState!;
}

// ============================================================================
// React Context
// ============================================================================
// TODO
interface SubscriptionStatus {
  isNIP4Connected: boolean;
  isNIP17Connected: boolean;
}

// TODO
interface ScanProgress {
  current: number;
  status: string;
}

// TODO
interface ScanProgressState {
  nip4: ScanProgress | null;
  nip17: ScanProgress | null;
}

interface SearchableMessage {
  message: Message;
  conversationId: string;
  senderPubkey: string;
  content: string;
  timestamp: number;
}

interface SearchableConversation {
  conversationId: string;
  participantPubkeys: string[];
  participantNames: string[];
  lastActivity: number;
}

export interface MessageSearchResult {
  message: Message;
  conversationId: string;
  score?: number;
  matches?: readonly Fuse.FuseResultMatch[];
}

export interface ConversationSearchResult {
  conversationId: string;
  participantPubkeys: string[];
  score?: number;
  matches?: readonly Fuse.FuseResultMatch[];
}

interface MessagingContext {
  messagingState: MessagingState | null;
  isLoading: boolean;
  timing: Record<string, number>;
  phase: NewDMPhase | null;
  messageSearchIndex: Fuse<SearchableMessage> | null;
  conversationSearchIndex: Fuse<SearchableConversation> | null;
}

interface NewDMContextValue extends MessagingContext {
  sendMessage: (params: {
    recipientPubkey: string;
    content: string;
    protocol: MessageProtocol;
    attachments?: FileAttachment[];
    subject?: string; // Optional: set/change conversation subject (NIP-17 only)
  }) => Promise<void>;
  protocolMode: ProtocolMode;
  getConversationRelays: (conversationId: string) => ConversationRelayInfo[];
  clearCacheAndRefetch: () => Promise<void>;
  subscriptions: SubscriptionStatus;
  scanProgress: ScanProgressState; // TODO: Implement batch progress tracking
  isDoingInitialLoad: boolean; // Derived from isLoading + phase
  reloadAfterSettingsChange: () => Promise<void>; // Reload messages after settings change
  searchMessages: (query: string, conversationId?: string) => MessageSearchResult[];
  searchConversations: (query: string) => ConversationSearchResult[];
  markConversationAsRead: (conversationId: string) => void;
  /** Unread count for active (known) conversations only */
  unreadActive: number;
  /** Unread count for request conversations only */
  unreadRequests: number;
  /** Unread across active + requests */
  unreadTotal: number;
}

const NewDMContext = createContext<NewDMContextValue | undefined>(undefined);

interface NewDMProviderProps {
  children: ReactNode;
  config?: {
    protocolMode?: ProtocolMode;
  };
}

export const NewDMProvider = ({ children, config }: NewDMProviderProps) => {
  const { protocolMode = PROTOCOL_MODE.NIP04_OR_NIP17 } = config || {};
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config: appConfig, updateConfig } = useAppContext();
  const { isOnline, wasOffline } = useNetworkState();
  const { toast } = useToast();
  
  // Stabilize discovery relays reference to avoid triggering effects
  const discoveryRelays = useMemo(() => appConfig.discoveryRelays, [appConfig.discoveryRelays.join(',')]);
  
  const [context, setContext] = useState<MessagingContext>({
    messagingState: null,
    isLoading: true,
    timing: {},
    phase: null,
    messageSearchIndex: null,
    conversationSearchIndex: null,
  });
  
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>({
    isNIP4Connected: false,
    isNIP17Connected: false,
  });

  // TODO: Implement batch progress tracking for large message scans
  const scanProgress: ScanProgressState = {
    nip4: null,
    nip17: null,
  };
  
  const initialisedForPubkey = useRef<string | null>(null);
  const nip4SubscriptionRef = useRef<{ close: () => void } | null>(null);
  const nip17SubscriptionRef = useRef<{ close: () => void } | null>(null);
  const debouncedWriteRef = useRef<NodeJS.Timeout | null>(null);
  const relayRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const searchIndexUpdateRef = useRef<NodeJS.Timeout | null>(null);
  
  const DEBOUNCED_WRITE_DELAY = 5000;
  const RELAY_REFRESH_CHECK_INTERVAL = 30000; // 30 seconds
  const SEARCH_INDEX_UPDATE_DELAY = 2000; // 2s debounce for search index updates
  
  const { mutateAsync: createEvent } = useNostrPublish();
  
  // Stable callback - doesn't depend on context
  const updateContext = useCallback((updates: Partial<MessagingContext>) => {
    setContext(prev => ({ ...prev, ...updates }));
  }, []);
  
  // Build search indices from messaging state
  const buildSearchIndices = useCallback((messagingState: MessagingState, myPubkey: string, metadataMap: Map<string, { metadata?: NostrMetadata }>) => {
    // Flatten all messages for message search
    const allMessages: SearchableMessage[] = [];
    for (const [conversationId, messages] of Object.entries(messagingState.conversationMessages)) {
      for (const message of messages) {
        allMessages.push({
          message,
          conversationId,
          senderPubkey: message.senderPubkey || message.event.pubkey,
          content: message.event.content,
          timestamp: message.event.created_at,
        });
      }
    }
    
    // Build searchable conversations with participant names
    const searchableConversations: SearchableConversation[] = [];
    
    for (const [conversationId, conversation] of Object.entries(messagingState.conversationMetadata)) {
      const otherParticipants = conversation.participantPubkeys.filter(pk => pk !== myPubkey);
      const participantPubkeys = otherParticipants.length > 0 ? otherParticipants : [myPubkey];
      
      const participantNames = participantPubkeys.map(pubkey => {
        const authorData = metadataMap.get(pubkey);
        const metadata = authorData?.metadata;
        return getDisplayName(pubkey, metadata);
      });
      
      searchableConversations.push({
        conversationId,
        participantPubkeys,
        participantNames,
        lastActivity: conversation.lastActivity,
      });
    }
    
    console.log('[NewDM] Search index built:', {
      conversations: searchableConversations.length,
      messages: allMessages.length,
      sampleNames: searchableConversations.slice(0, 3).map(c => c.participantNames)
    });
    
    console.log(`[NewDM] Building search indices: ${allMessages.length} messages, ${searchableConversations.length} conversations`);
    
    // Create Fuse instances
    const messageSearchIndex = new Fuse(allMessages, {
      keys: [
        { name: 'content', weight: 2 },
      ],
      threshold: 0.3,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      ignoreLocation: true, // Search anywhere in the string
    });
    
    const conversationSearchIndex = new Fuse(searchableConversations, {
      keys: [
        { name: 'participantNames', weight: 1 },
      ],
      threshold: 0.3,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      ignoreLocation: true,
    });
    
    return { messageSearchIndex, conversationSearchIndex };
  }, []);
  
  // Collect all participant pubkeys for metadata fetching
  const allParticipantPubkeys = useMemo(() => {
    if (!context.messagingState) return [];
    const pubkeys = new Set<string>();
    for (const conversation of Object.values(context.messagingState.conversationMetadata)) {
      conversation.participantPubkeys.forEach(pk => pubkeys.add(pk));
    }
    return Array.from(pubkeys);
  }, [context.messagingState]);
  
  // Fetch metadata for all participants using existing hook (with caching)
  const { data: authorsData } = useAuthorsBatch(allParticipantPubkeys);
  
  // Debounced search index update
  const updateSearchIndices = useCallback(() => {
    if (!user?.pubkey || !context.messagingState) return;
    
    const { messageSearchIndex, conversationSearchIndex } = buildSearchIndices(context.messagingState, user.pubkey, authorsData);
    
    setContext(prev => ({
      ...prev,
      messageSearchIndex,
      conversationSearchIndex,
    }));
  }, [user?.pubkey, context.messagingState, buildSearchIndices, authorsData]);
  
  const triggerSearchIndexUpdate = useCallback(() => {
    if (searchIndexUpdateRef.current) {
      clearTimeout(searchIndexUpdateRef.current);
    }
    searchIndexUpdateRef.current = setTimeout(() => {
      updateSearchIndices();
      searchIndexUpdateRef.current = null;
    }, SEARCH_INDEX_UPDATE_DELAY);
  }, [updateSearchIndices]);
  
  // Process incoming message and add to state incrementally
  const processIncomingMessage = useCallback(async (event: DMLib.NostrEvent) => {
    console.log('[NewDM] 📨 Received event via subscription:', { kind: event.kind, id: event.id.substring(0, 8) });
    
    if (!user?.pubkey) {
      console.warn('[NewDM] Cannot process incoming message: no user');
      return;
    }
    
    try {
      // Decrypt message using shared library function (reuses same logic as initial load)
      const messagesWithMetadata = await DMLib.Impure.Message.decryptAllMessages(
        [event],
        user.signer,
        user.pubkey
      );
      
      if (messagesWithMetadata.length === 0) {
        console.log('[NewDM] ⚠️ Could not decrypt message:', event.id.substring(0, 8));
        return; // Failed to process or decrypt
      }
      
      const messageWithMetadata = messagesWithMetadata[0];
      
      // Add message incrementally using function form of setState to get current state
      setContext(prev => {
        if (!prev.messagingState) {
          console.warn('[NewDM] Cannot process incoming message: no messagingState in current context');
          return prev;
        }
        
        // Before adding, check if this matches an optimistic message from the current user
        // Match by content, timestamp (within 60s), and sender
        const conversationId = DMLib.Pure.Conversation.computeConversationId(
          messageWithMetadata.participants || []
        );
        const conversationMessages = prev.messagingState.conversationMessages[conversationId] || [];
        
        const optimisticIndex = messageWithMetadata.event.pubkey === user.pubkey
          ? conversationMessages.findIndex(msg => {
              if (!msg.isSending || msg.event.pubkey !== messageWithMetadata.event.pubkey) return false;
              
              // Match by ID (giftWrapId for NIP-17, id for NIP-04)
              if (messageWithMetadata.giftWrapId) {
                const matches = msg.giftWrapId === messageWithMetadata.giftWrapId;
                console.log('[NewDM] Matching optimistic (NIP-17):', {
                  optimisticGiftWrapId: msg.giftWrapId,
                  realGiftWrapId: messageWithMetadata.giftWrapId,
                  matches,
                  optimisticId: msg.id,
                  realEventId: messageWithMetadata.event.id,
                });
                return matches;
              }
              const matches = msg.id === messageWithMetadata.event.id;
              console.log('[NewDM] Matching optimistic (NIP-04):', {
                optimisticId: msg.id,
                realEventId: messageWithMetadata.event.id,
                matches,
              });
              return matches;
            })
          : -1;
        
        // If we found a matching optimistic message, remove it before adding the real one
        let stateToUpdate = prev.messagingState;
        if (optimisticIndex !== -1) {
          const filteredMessages = conversationMessages.filter((_, idx) => idx !== optimisticIndex);
          stateToUpdate = {
            ...prev.messagingState,
            conversationMessages: {
              ...prev.messagingState.conversationMessages,
              [conversationId]: filteredMessages,
            },
          };
        }
        
        const updatedState = DMLib.Pure.Sync.addMessageToState(
          stateToUpdate,
          messageWithMetadata,
          user.pubkey
        );
        
        // Check if message was actually added (addMessageToState returns early if duplicate)
        const finalMessages = updatedState.conversationMessages[conversationId] || [];
        const wasAdded = finalMessages.some(msg => {
          // For NIP-17, use giftWrapId for matching (inner message has no ID)
          if (messageWithMetadata.giftWrapId) {
            return msg.giftWrapId === messageWithMetadata.giftWrapId;
          }
          // For NIP-04, use message ID
          return msg.id === messageWithMetadata.event.id;
        });

        // Recalculate unread from messages (msg.event is inner for NIP-17, so created_at is correct)
        let finalState = updatedState;
        if (wasAdded && updatedState.conversationMetadata[conversationId]) {
          const conv = updatedState.conversationMetadata[conversationId];
          const lastReadAt = conv.lastReadAt ?? 0;
          const unreadCount = countUnread(finalMessages, lastReadAt, user.pubkey);
          finalState = {
            ...updatedState,
            conversationMetadata: {
              ...updatedState.conversationMetadata,
              [conversationId]: { ...conv, unreadCount },
            },
          };
          const fromPubkey = messageWithMetadata.senderPubkey || messageWithMetadata.event.pubkey;
          if (fromPubkey !== user.pubkey) {
            handleNewMessage(conversationId, fromPubkey, messageWithMetadata.decryptedContent ?? messageWithMetadata.event.content ?? '');
          }
        }
        return { ...prev, messagingState: finalState };
      });
    } catch (error) {
      console.error('[NewDM] Failed to process incoming message:', error);
    }
  }, [user]);
  
  // Centralized cleanup for subscriptions
  const cleanupSubscriptions = useCallback(() => {
    if (nip4SubscriptionRef.current) {
      nip4SubscriptionRef.current.close();
      nip4SubscriptionRef.current = null;
    }
    if (nip17SubscriptionRef.current) {
      nip17SubscriptionRef.current.close();
      nip17SubscriptionRef.current = null;
    }
    setSubscriptionStatus({ isNIP4Connected: false, isNIP17Connected: false });
  }, []);
  
  // Start NIP-4 subscription
  const startNIP4Subscription = useCallback(async (messagingState: MessagingState) => {
    if (!user?.pubkey || !nostr) {
      console.warn('[NewDM] Cannot start NIP-4 subscription:', { hasUser: !!user?.pubkey, hasNostr: !!nostr });
      return;
    }
    
    if (nip4SubscriptionRef.current) {
      nip4SubscriptionRef.current.close();
      nip4SubscriptionRef.current = null;
    }
    
    try {
      const myRelays = messagingState.participants[user.pubkey]?.derivedRelays || [];
      if (myRelays.length === 0) {
        console.warn('[NewDM] No relays available for NIP-4 subscription');
        return;
      }
      
      // Subscribe from last cache time with 10s overlap for race conditions
      const since = messagingState.syncState.lastCacheTime 
        ? Math.floor(messagingState.syncState.lastCacheTime / 1000) - 10
        : Math.floor(Date.now() / 1000);
      
      const filters = [
        { kinds: [4], '#p': [user.pubkey], since },
        { kinds: [4], authors: [user.pubkey], since }
      ];
      
      const relayGroup = nostr.group(myRelays);
      const subscription = relayGroup.req(filters);
      let isActive = true;
      
      (async () => {
        try {
          for await (const msg of subscription) {
            if (!isActive) break;
            if (msg[0] === 'EVENT') {
              await processIncomingMessage(msg[2]);
            }
          }
        } catch (error) {
          if (isActive) {
            console.error('[NewDM] NIP-4 subscription error:', error);
          }
        }
      })();
      
      nip4SubscriptionRef.current = {
        close: () => {
          isActive = false;
        }
      };
      
      setSubscriptionStatus(prev => ({ ...prev, isNIP4Connected: true }));
      console.log('[NewDM] NIP-4 subscription started on', myRelays.length, 'relays');
    } catch (error) {
      console.error('[NewDM] Failed to start NIP-4 subscription:', error);
      setSubscriptionStatus(prev => ({ ...prev, isNIP4Connected: false }));
    }
  }, [user, nostr, processIncomingMessage]);
  
  // Start NIP-17 subscription
  const startNIP17Subscription = useCallback(async (messagingState: MessagingState) => {
    if (!user?.pubkey || !nostr) {
      console.warn('[NewDM] Cannot start NIP-17 subscription:', { hasUser: !!user?.pubkey, hasNostr: !!nostr });
      return;
    }
    
    if (nip17SubscriptionRef.current) {
      nip17SubscriptionRef.current.close();
      nip17SubscriptionRef.current = null;
    }
    
    try {
      const myRelays = messagingState.participants[user.pubkey]?.derivedRelays || [];
      if (myRelays.length === 0) {
        console.warn('[NewDM] No relays available for NIP-17 subscription');
        return;
      }
      
      // Subscribe from last cache time with 10s overlap, adjusted for NIP-17 timestamp fuzzing (±2 days)
      const TWO_DAYS_IN_SECONDS = 2 * 24 * 60 * 60;
      const since = messagingState.syncState.lastCacheTime 
        ? Math.floor(messagingState.syncState.lastCacheTime / 1000) - 10 - TWO_DAYS_IN_SECONDS
        : Math.floor(Date.now() / 1000) - TWO_DAYS_IN_SECONDS;
      
      const filters = [{
        kinds: [1059],
        '#p': [user.pubkey],
        since,
      }];
      
      const relayGroup = nostr.group(myRelays);
      const subscription = relayGroup.req(filters);
      let isActive = true;
      
      (async () => {
        try {
          for await (const msg of subscription) {
            if (!isActive) break;
            if (msg[0] === 'EVENT') {
              await processIncomingMessage(msg[2]);
            }
          }
        } catch (error) {
          if (isActive) {
            console.error('[NewDM] NIP-17 subscription error:', error);
          }
        }
      })();
      
      nip17SubscriptionRef.current = {
        close: () => {
          isActive = false;
        }
      };
      
      setSubscriptionStatus(prev => ({ ...prev, isNIP17Connected: true }));
      console.log('[NewDM] NIP-17 subscription started on', myRelays.length, 'relays');
    } catch (error) {
      console.error('[NewDM] Failed to start NIP-17 subscription:', error);
      setSubscriptionStatus(prev => ({ ...prev, isNIP17Connected: false }));
    }
  }, [user, nostr, processIncomingMessage]);
  
  // Start all subscriptions
  const startSubscriptions = useCallback(async (messagingState: MessagingState) => {
    console.log('[NewDM] Starting subscriptions...');
    await Promise.all([
      startNIP4Subscription(messagingState),
      startNIP17Subscription(messagingState)
    ]);
    console.log('[NewDM] Subscriptions started');
  }, [startNIP4Subscription, startNIP17Subscription]);
  
  // do our intiial load (cold or warm) of messaging state
  useEffect(() => {
    if (!user) {
      console.log('[NewDM] No user logged in, resetting state');
      initialisedForPubkey.current = null;
      setContext({ messagingState: null, isLoading: false, timing: {}, phase: null });
      return;
    }
    
    if (initialisedForPubkey.current === user.pubkey) {
      console.log('[NewDM] Already initialized for', user.pubkey.substring(0, 8));
      return;
    }
    
    console.log('[NewDM] User logged in:', user.pubkey.substring(0, 8));
    const previousUser = initialisedForPubkey.current;
    const isChangingAccount = previousUser !== null && previousUser !== user.pubkey;
    
    initialisedForPubkey.current = user.pubkey;
    setContext({ messagingState: null, isLoading: true, timing: {}, phase: null });
    
    (async () => {
      // FIRST: Clear old user's cache if switching accounts (BLOCKING)
      if (isChangingAccount) {
        console.log('[NewDM] User switched from', previousUser.substring(0, 8), 'to', user.pubkey.substring(0, 8), '- clearing old cache');
        try {
          const { deleteMessagesFromDB } = await import('@/lib/dmMessageStore');
          await deleteMessagesFromDB(previousUser!);
          console.log('[NewDM] Old cache cleared successfully');
        } catch (error) {
          console.warn('[NewDM] Failed to clear old user cache:', error);
        }
      }
      
      // THEN: Start initialization with clean slate
      try {
        console.log('[NewDM] Starting initialization for', user.pubkey.substring(0, 8));
        const settings: DMSettings = {
          discoveryRelays,
          relayMode: appConfig.relayMode,
          relayTTL: DEFAULT_RELAY_TTL,
          queryLimit: DEFAULT_QUERY_LIMIT,
        };
        
        const finalState = await initialiseMessaging(nostr, user.signer, user.pubkey, settings, updateContext);
        console.log('[NewDM] ✅ Initialization complete');
        
        // Start real-time subscriptions after initialization completes
        // Pass the state directly to avoid stale context issues
        await startSubscriptions(finalState);
        console.log('[NewDM] ✅ Subscriptions active');
      } catch (error) {
        console.error('[NewDM] ❌ Initialization failed:', error);
        setContext({
          messagingState: {
            participants: {},
            conversationMetadata: {},
            conversationMessages: {},
            syncState: { lastCacheTime: null, queriedRelays: [], queryLimitReached: false },
            relayInfo: {}
          },
          isLoading: false,
          timing: {},
          phase: null
        });
      }
    })();
  }, [user?.pubkey, nostr, discoveryRelays]);
  
  // Handle network reconnection
  useEffect(() => {
    if (!isOnline) {
      console.log('[NewDM] Network offline');
      toast({
        title: 'Connection lost',
        description: 'You are offline. Messages will sync when connection is restored.',
        variant: 'destructive',
      });
      return;
    }

    if (wasOffline && user?.pubkey && context.messagingState) {
      console.log('[NewDM] Network restored - restarting subscriptions');
      toast({ title: 'Connection restored', description: 'Reconnecting...' });
      startSubscriptions(context.messagingState);
    }
  }, [isOnline, wasOffline, user?.pubkey, context.messagingState, toast, startSubscriptions]);
  
  // Use ref to access current messaging state in mutations
  const messagingStateRef = useRef<MessagingState | null>(null);
  
  // Keep ref in sync with context
  useEffect(() => {
    messagingStateRef.current = context.messagingState;
  }, [context.messagingState]);

  // Write messaging state to cache
  const writeToCache = useCallback(async () => {
    if (!user?.pubkey || !context.messagingState) return;

    try {
      // Update lastCacheTime before saving
      const stateToSave: MessagingState = {
        ...context.messagingState,
        syncState: {
          ...context.messagingState.syncState,
          lastCacheTime: Date.now(),
        },
      };
      
      await DMLib.Impure.Cache.saveToCache(user.pubkey, stateToSave);
    } catch (error) {
      console.error('[NewDM] Error writing to cache:', error);
    }
  }, [user?.pubkey, context.messagingState]);

  // Trigger debounced write
  const triggerDebouncedWrite = useCallback(() => {
    if (debouncedWriteRef.current) {
      clearTimeout(debouncedWriteRef.current);
    }
    debouncedWriteRef.current = setTimeout(() => {
      writeToCache();
      debouncedWriteRef.current = null;
    }, DEBOUNCED_WRITE_DELAY);
  }, [writeToCache]);

  // Watch messaging state and save to cache
  useEffect(() => {
    if (!user?.pubkey || !context.messagingState || context.isLoading) return;
    
    // Don't save during initial load phases
    if (context.phase === NEW_DM_PHASES.CACHE || context.phase === NEW_DM_PHASES.INITIAL_QUERY) return;
    
    triggerDebouncedWrite();
  }, [user?.pubkey, context.messagingState, context.isLoading, context.phase, triggerDebouncedWrite]);

  // Watch messaging state and update search indices (debounced)
  useEffect(() => {
    if (!user?.pubkey || !context.messagingState || context.isLoading) return;
    
    // Don't update during initial load phases
    if (context.phase === NEW_DM_PHASES.CACHE || context.phase === NEW_DM_PHASES.INITIAL_QUERY) return;
    
    triggerSearchIndexUpdate();
  }, [user?.pubkey, context.messagingState, context.isLoading, context.phase, triggerSearchIndexUpdate]);


  // Background task: Refresh stale participant relay lists
  useEffect(() => {
    if (!user?.pubkey || !context.messagingState || context.isLoading) return;
    
    // Don't run during initial load
    if (context.phase === NEW_DM_PHASES.CACHE || context.phase === NEW_DM_PHASES.INITIAL_QUERY) return;
    
    const checkAndRefreshStaleRelays = async () => {
      if (!context.messagingState) return;
      
      const now = Date.now();
      const staleParticipants: string[] = [];
      
      // Find participants with expired relay lists (excluding current user)
      for (const [pubkey, participant] of Object.entries(context.messagingState.participants)) {
        if (pubkey === user.pubkey) continue; // Skip current user
        
        const age = now - participant.lastFetched;
        if (age > DEFAULT_RELAY_TTL) {
          staleParticipants.push(pubkey);
        }
      }
      
      if (staleParticipants.length === 0) {
        return; // Nothing to refresh
      }
      
      console.log(`[NewDM] Background refresh: ${staleParticipants.length} stale participants found`, 
        staleParticipants.map(p => p.substring(0, 8)));
      
      try {
        // Fetch fresh relay lists for stale participants
        const refreshedParticipants = await DMLib.Impure.Participant.fetchAndMergeParticipants(
          nostr,
          context.messagingState.participants,
          staleParticipants,
          appConfig.relayMode,
          discoveryRelays
        );
        
        // Update messaging state with refreshed participants using helper
        setContext(prev => {
          if (!prev.messagingState) return prev;
          
          const updatedParticipants = DMLib.Pure.Participant.mergeParticipants(
            prev.messagingState.participants,
            refreshedParticipants
          );
          
          return {
            ...prev,
            messagingState: {
              ...prev.messagingState,
              participants: updatedParticipants,
            },
          };
        });
        
        console.log(`[NewDM] Background refresh: Updated ${staleParticipants.length} participants`);
      } catch (error) {
        console.error('[NewDM] Background refresh failed:', error);
      }
    };
    
    // Run check immediately on mount
    checkAndRefreshStaleRelays();
    
    // Set up periodic check
    relayRefreshIntervalRef.current = setInterval(checkAndRefreshStaleRelays, RELAY_REFRESH_CHECK_INTERVAL);
    
    return () => {
      if (relayRefreshIntervalRef.current) {
        clearInterval(relayRefreshIntervalRef.current);
        relayRefreshIntervalRef.current = null;
      }
    };
  }, [user?.pubkey, context.messagingState, context.isLoading, context.phase, nostr, appConfig.relayMode, discoveryRelays]);

  // Helper: Get inbox relays for a pubkey from participants state (fetches on-demand if missing)
  const getInboxRelaysForPubkey = useCallback(async (pubkey: string): Promise<string[]> => {
    // Check cache first
    const cachedRelays = messagingStateRef.current?.participants[pubkey]?.derivedRelays;
    if (cachedRelays?.length) return cachedRelays;
    
    // Fetch on-demand for new participants
    console.log(`[NewDM] Fetching relay info for new participant ${pubkey.substring(0, 8)}...`);
    const newParticipants = await DMLib.Impure.Participant.fetchAndMergeParticipants(
      nostr,
      messagingStateRef.current?.participants || {},
      [pubkey],
      appConfig.relayMode,
      discoveryRelays
    );
    
    const fetchedRelays = newParticipants[pubkey]?.derivedRelays;
    if (!fetchedRelays?.length) {
      throw new Error(`Could not find relay info for ${pubkey.substring(0, 8)}...`);
    }
    
    // Update state with new participant
    setContext(prev => {
      if (!prev.messagingState) return prev;
      return {
        ...prev,
        messagingState: {
          ...prev.messagingState,
          participants: { ...prev.messagingState.participants, ...newParticipants },
        },
      };
    });
    
    return fetchedRelays;
  }, [nostr, appConfig.relayMode, discoveryRelays]);

  // Search messages
  const searchMessages = useCallback((query: string, conversationId?: string): MessageSearchResult[] => {
    if (!context.messageSearchIndex || !query.trim()) return [];
    
    const results = context.messageSearchIndex.search(query);
    
    // Filter by conversation if specified
    const filteredResults = conversationId
      ? results.filter(r => r.item.conversationId === conversationId)
      : results;
    
    return filteredResults.map(r => ({
      message: r.item.message,
      conversationId: r.item.conversationId,
      score: r.score,
      matches: r.matches,
    }));
  }, [context.messageSearchIndex]);
  
  // Search conversations by participant names using Fuse
  const searchConversations = useCallback((query: string): ConversationSearchResult[] => {
    if (!context.conversationSearchIndex || !query.trim()) return [];
    
    const results = context.conversationSearchIndex.search(query);
    
    return results.map(r => ({
      conversationId: r.item.conversationId,
      participantPubkeys: r.item.participantPubkeys,
      score: r.score,
      matches: r.matches,
    }));
  }, [context.conversationSearchIndex]);

  // Prepare NIP-04 Message (internal)
  const prepareNIP4Message = useCallback(async (
    recipientPubkey: string,
    content: string,
    attachments: FileAttachment[] = []
  ) => {
    if (!user) throw new Error('User is not logged in');
    const userInbox = messagingStateRef.current?.participants[user.pubkey]?.derivedRelays;
    if (!userInbox?.length) throw new Error('User inbox relays not found');
    const recipientInbox = await getInboxRelaysForPubkey(recipientPubkey);
    return DMLib.Impure.Message.prepareNIP04Message(
      nostr,
      user.signer,
      user.pubkey,
      recipientPubkey,
      content,
      attachments,
      userInbox,
      recipientInbox,
      createEvent
    );
  }, [user, nostr, createEvent, getInboxRelaysForPubkey]);

  // Prepare NIP-17 Message (internal)
  const prepareNIP17Message = useCallback(async (
    recipients: string[],
    content: string,
    attachments: FileAttachment[] = [],
    subject?: string
  ) => {
    if (!user) throw new Error('User is not logged in');
    return DMLib.Impure.Message.prepareNIP17Message(
      nostr,
      user.signer,
      user.pubkey,
      recipients,
      content,
      attachments,
      getInboxRelaysForPubkey,
      subject
    );
  }, [user, nostr, getInboxRelaysForPubkey]);

  // Send message
  const sendMessage = useCallback(async (params: {
    recipientPubkey: string;
    content: string;
    protocol: MessageProtocol;
    attachments?: FileAttachment[];
  }) => {
    if (!user?.pubkey || !context.messagingState) {
      console.warn('[NewDM] Cannot send message: missing user or messagingState');
      return;
    }

    const { recipientPubkey, content, protocol = MESSAGE_PROTOCOL.NIP17, attachments, subject: newSubject } = params;

    // Parse conversation ID to get participants (no subject in ID per NIP-17)
    const allParticipants = DMLib.Pure.Conversation.parseConversationId(recipientPubkey);
    
    // Get current conversation's subject from metadata, or use provided subject
    const currentConversation = context.messagingState.conversationMetadata[recipientPubkey];
    const subject = newSubject !== undefined ? newSubject : (currentConversation?.subject || '');
    
    // Recipients are everyone except the sender
    let recipients = allParticipants.filter(p => p !== user.pubkey);
    
    // For self-messaging, ensure we include ourselves as the recipient
    if (recipients.length === 0 && allParticipants.length === 1) {
      recipients = [user.pubkey];
    }

    let eventId: string;
    let giftWrapId: string | undefined;
    let publishFn: () => Promise<NostrEvent>;
    const attachmentsArray = attachments || [];
    const hasAttachments = attachmentsArray.length > 0;

    console.log('[NewDM] Preparing message:', { protocol, hasAttachments, attachmentsCount: attachmentsArray.length });

    try {
      if (protocol === MESSAGE_PROTOCOL.NIP04) {
        const result = await prepareNIP4Message(recipients[0], content, attachmentsArray);
        eventId = result.eventId;
        publishFn = result.publish;
      } else if (protocol === MESSAGE_PROTOCOL.NIP17) {
        const result = await prepareNIP17Message(recipients, content, attachmentsArray, subject);
        giftWrapId = result.giftWrapId;
        eventId = giftWrapId;
        publishFn = result.publish;
        console.log('[NewDM] NIP-17 message prepared:', { giftWrapId, hasAttachments, expectedKind: hasAttachments ? 15 : 14 });
      } else {
        throw new Error(`Unsupported protocol: ${protocol}`);
      }
    } catch (error) {
      console.error(`[NewDM] Failed to prepare ${protocol} message:`, error);
      toast({ title: 'Failed to send message', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const optimisticKind = protocol === MESSAGE_PROTOCOL.NIP04 ? 4 : (hasAttachments ? 15 : 14);
    
    const optimisticEvent: NostrEvent = {
      id: eventId,
      kind: optimisticKind,
      pubkey: user.pubkey,
      created_at: now,
      tags: recipients.map(p => ['p', p]),
      content: content,
      sig: '',
    };

    console.log('[NewDM] Optimistic message:', { id: eventId, giftWrapId, kind: optimisticKind, hasAttachments });

    const optimisticMessageWithMetadata: DMLib.MessageWithMetadata = {
      event: optimisticEvent,
      senderPubkey: user.pubkey,
      participants: [user.pubkey, ...recipients],
      subject: subject || '',
      ...(giftWrapId && { giftWrapId }),
    };

    setContext(prev => {
      if (!prev.messagingState) return prev;
      
      const updatedState = DMLib.Pure.Sync.addMessageToState(
        prev.messagingState,
        optimisticMessageWithMetadata,
        user.pubkey
      );
      
      const computedConversationId = DMLib.Pure.Conversation.computeConversationId(
        optimisticMessageWithMetadata.participants || []
      );
      
      const conversationMessages = updatedState.conversationMessages[computedConversationId] || [];
      const optimisticMessage = conversationMessages.find(msg => 
        (giftWrapId && msg.giftWrapId === giftWrapId) || (!giftWrapId && msg.id === eventId)
      );
      
      if (optimisticMessage) {
        optimisticMessage.isSending = true;
        optimisticMessage.clientFirstSeen = Date.now();
      } 
      
      return { ...prev, messagingState: updatedState };
    });

    try {
      await publishFn();
    } catch (error) {
      console.error(`[NewDM] Failed to publish ${protocol} message:`, error);
      toast({ title: 'Failed to send message', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
      setContext(prev => {
        if (!prev.messagingState) return prev;
        const conversationMessages = prev.messagingState.conversationMessages[recipientPubkey] || [];
        const filteredMessages = conversationMessages.filter(msg => 
          (giftWrapId && msg.giftWrapId !== giftWrapId) || (!giftWrapId && msg.id !== eventId)
        );
        return {
          ...prev,
          messagingState: {
            ...prev.messagingState,
            conversationMessages: {
              ...prev.messagingState.conversationMessages,
              [recipientPubkey]: filteredMessages,
            },
          },
        };
      });
    }
  }, [user, context.messagingState, prepareNIP4Message, prepareNIP17Message, toast]);
  
  const getConversationRelays = useCallback((conversationId: string): ConversationRelayInfo[] => {
    if (!user?.pubkey || !context.messagingState) {
      return [];
    }

    return DMLib.Pure.Conversation.getConversationRelays(
      conversationId,
      context.messagingState.participants,
      user.pubkey
    );
  }, [user, context.messagingState]);
  
  // Clear cache and refetch from relays
  const clearCacheAndRefetch = useCallback(async () => {
    if (!user?.pubkey) return;
    
    try {
      cleanupSubscriptions();
      
      const { deleteMessagesFromDB } = await import('@/lib/dmMessageStore');
      await deleteMessagesFromDB(user.pubkey);
      
      // Also clear media cache
      const { clearMediaCache } = await import('@/lib/dmMediaCache');
      await clearMediaCache();
      
      // Reset state and trigger reload
      setContext({
        messagingState: null,
        isLoading: true,
        timing: {},
        phase: null
      });
      initialisedForPubkey.current = null; // Force re-initialization
      
      console.log('[NewDM] Cache cleared, reloading from relays...');
      toast({
        title: 'Cache cleared',
        description: 'All messages and media have been reloaded from relays',
        duration: 5000,
        className: 'border-2 bg-card',
      });
    } catch (error) {
      console.error('[NewDM] Error clearing cache:', error);
      toast({
        title: 'Error clearing cache',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      throw error;
    }
  }, [user?.pubkey, cleanupSubscriptions, toast]);
  
  // Function to reload messages after settings change (called by SettingsModal)
  const reloadAfterSettingsChange = useCallback(async () => {
    console.log('[NewDM] Reloading after settings change');
    await clearCacheAndRefetch();
  }, [clearCacheAndRefetch]);
  
  // Cleanup subscriptions, debounced writes, and refresh interval on unmount or user change
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
      if (debouncedWriteRef.current) {
        clearTimeout(debouncedWriteRef.current);
        debouncedWriteRef.current = null;
      }
      if (relayRefreshIntervalRef.current) {
        clearInterval(relayRefreshIntervalRef.current);
        relayRefreshIntervalRef.current = null;
      }
      if (searchIndexUpdateRef.current) {
        clearTimeout(searchIndexUpdateRef.current);
        searchIndexUpdateRef.current = null;
      }
    };
  }, [user?.pubkey, cleanupSubscriptions]);
  
  // Detect hard refresh shortcut (Ctrl+Shift+R / Cmd+Shift+R) to clear cache
  useEffect(() => {
    if (!user?.pubkey) return;
    
    const handleHardRefresh = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        try {
          sessionStorage.setItem('dm-clear-cache-on-load', 'true');
        } catch (error) {
          console.warn('[NewDM] SessionStorage unavailable, cache won\'t clear on hard refresh:', error);
        }
      }
    };
    
    window.addEventListener('keydown', handleHardRefresh);
    return () => window.removeEventListener('keydown', handleHardRefresh);
  }, [user?.pubkey]);
  
  // Clear cache after hard refresh
  useEffect(() => {
    if (!user?.pubkey) return;
    
    try {
      const shouldClearCache = sessionStorage.getItem('dm-clear-cache-on-load');
      if (shouldClearCache) {
        sessionStorage.removeItem('dm-clear-cache-on-load');
        toast({
          title: 'Clearing cache',
          description: 'Reloading all messages from scratch',
          duration: 5000,
          className: 'border-2 bg-card',
        });
        clearCacheAndRefetch();
      }
    } catch (error) {
      console.warn('[NewDM] Could not check sessionStorage for cache clear flag:', error);
    }
  }, [user?.pubkey, clearCacheAndRefetch, toast]);
  
  const isDoingInitialLoad = context.isLoading && (context.phase === NEW_DM_PHASES.CACHE || context.phase === NEW_DM_PHASES.INITIAL_QUERY);

  // Initialize all conversations for first-time users
  const initializeConversationsForFirstTime = useCallback((): void => {
    if (!context.messagingState) return;
    
    const updatedMetadata = { ...context.messagingState.conversationMetadata };
    let hasUpdates = false;
    
    for (const [conversationId, conversation] of Object.entries(updatedMetadata)) {
      const messages = context.messagingState.conversationMessages?.[conversationId] || [];
      let needsUpdate = false;
      let updatedConversation = { ...conversation };
      
      // Initialize lastReadAt if needed (first-time); store in ms for comparison with message timestamps
      if (!conversation.lastReadAt || conversation.lastReadAt === 0) {
        const latestMessageTime = messages.length > 0
          ? Math.max(...messages.map(m => m.event.created_at)) * 1000
          : Date.now();
        updatedConversation.lastReadAt = latestMessageTime;
        needsUpdate = true;
      }
      
      // Set unread count from actual messages (uses inner event timestamp for NIP-17)
      const unreadCount = countUnread(messages, updatedConversation.lastReadAt, user?.pubkey ?? '');
      if (updatedConversation.unreadCount !== unreadCount) {
        updatedConversation.unreadCount = unreadCount;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        updatedMetadata[conversationId] = updatedConversation;
        hasUpdates = true;
      }
    }
    
    if (hasUpdates) {
      setContext(prevContext => ({
        ...prevContext,
        messagingState: prevContext.messagingState ? {
          ...prevContext.messagingState,
          conversationMetadata: updatedMetadata
        } : null
      }));
    }
  }, [context.messagingState]);
  
  // Run initialization once when messaging state is loaded
  useEffect(() => {
    if (context.messagingState && !context.isLoading) {
      initializeConversationsForFirstTime();
    }
  }, [context.messagingState, context.isLoading, initializeConversationsForFirstTime]);

  const markConversationAsRead = useCallback((conversationId: string): void => {
    if (!context.messagingState?.conversationMetadata?.[conversationId]) return;
    
    const conversation = context.messagingState.conversationMetadata[conversationId];
    const messages = context.messagingState.conversationMessages?.[conversationId] || [];
    
    // If this is the first time marking as read, set lastReadAt to latest message time (ms); else now
    const latestMessageTimeMs = messages.length > 0 ? Math.max(...messages.map(m => m.event.created_at)) * 1000 : Date.now();
    const newLastReadAt = conversation.lastReadAt && conversation.lastReadAt > 0 ? Date.now() : latestMessageTimeMs;
    
    setContext(prevContext => ({
      ...prevContext,
      messagingState: prevContext.messagingState ? {
        ...prevContext.messagingState,
        conversationMetadata: {
          ...prevContext.messagingState.conversationMetadata,
          [conversationId]: {
            ...prevContext.messagingState.conversationMetadata[conversationId],
            lastReadAt: newLastReadAt,
            unreadCount: 0 // Reset to 0 when marked as read
          }
        }
      } : null
    }));
  }, [context.messagingState]);

  const { unreadActive, unreadRequests, unreadTotal } = useMemo(() => {
    const meta = context.messagingState?.conversationMetadata ?? {};
    let active = 0;
    let requests = 0;
    for (const c of Object.values(meta)) {
      const n = c.unreadCount ?? 0;
      if (c.isKnown) active += n;
      if (c.isRequest) requests += n;
    }
    return { unreadActive: active, unreadRequests: requests, unreadTotal: active + requests };
  }, [context.messagingState?.conversationMetadata]);

  const value: NewDMContextValue = {
    ...context,
    sendMessage,
    protocolMode,
    getConversationRelays,
    clearCacheAndRefetch,
    subscriptions: subscriptionStatus,
    scanProgress, // TODO: Implement batch progress tracking
    isDoingInitialLoad,
    reloadAfterSettingsChange,
    searchMessages,
    searchConversations,
    markConversationAsRead,
    unreadActive,
    unreadRequests,
    unreadTotal,
  };
  
  // Add debug function to window for testing
  if (typeof window !== 'undefined') {
    (window as any).debugUnreadMessages = {
      resetAllConversations: () => {
        if (!context.messagingState) return;
        const updatedMetadata = { ...context.messagingState.conversationMetadata };
        for (const conversationId of Object.keys(updatedMetadata)) {
          updatedMetadata[conversationId] = {
            ...updatedMetadata[conversationId],
            lastReadAt: 0 // Reset to show all as unread for testing
          };
        }
        setContext(prevContext => ({
          ...prevContext,
          messagingState: prevContext.messagingState ? {
            ...prevContext.messagingState,
            conversationMetadata: updatedMetadata
          } : null
        }));
      }
    };
  }
  
  return (
    <NewDMContext.Provider value={value}>
      {children}
    </NewDMContext.Provider>
  );
}

export const useNewDMContext = (): NewDMContextValue => {
  const context = useContext(NewDMContext);
  if (!context) {
    throw new Error('useNewDMContext must be used within a NewDMProvider');
  }
  return context;
}

export function useConversationMessages(conversationId: string) {
  const { messagingState } = useNewDMContext();
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE);

  const result = useMemo(() => {
    const messages = messagingState?.conversationMessages[conversationId] || [];
    const totalCount = messages.length;
    const hasMore = totalCount > visibleCount;
    const visibleMessages = messages.slice(-visibleCount);

    return {
      messages: visibleMessages,
      hasMoreMessages: hasMore,
      totalCount,
    };
  }, [messagingState?.conversationMessages, conversationId, visibleCount]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleCount(prev => prev + MESSAGES_PER_PAGE);
  }, []);

  useEffect(() => {
    setVisibleCount(MESSAGES_PER_PAGE);
  }, [conversationId]);

  return {
    ...result,
    loadEarlierMessages,
  };
}
