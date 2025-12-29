/* eslint-disable */
// @ts-nocheck
import { createContext, useContext, ReactNode, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import type { NPool } from '@nostrify/nostrify';
import { RELAY_MODE } from '@/lib/dmTypes';
import type {
  DMSettings,
  MessagingState,
  Participant,
} from '@/lib/dmTypes';
import * as DMLib from '@/lib/dmLib';
import type { Signer } from '@/lib/dmLib';
import { PROTOCOL_MODE, type ProtocolMode, type MessageProtocol, NEW_DM_PHASES, type NewDMPhase } from '@/lib/dmConstants';
import type { ConversationRelayInfo } from '@/contexts/DMContext';

const MESSAGES_PER_PAGE = 25;

// ============================================================================
// Helper Functions
// ============================================================================

const mergeMessagingState = (base: MessagingState | null, updates: MessagingState): MessagingState => {
  if (!base) return updates;
  
  return {
    ...updates,
    conversationMetadata: { ...base.conversationMetadata, ...updates.conversationMetadata },
    conversationMessages: { ...base.conversationMessages, ...updates.conversationMessages },
    relayInfo: { ...base.relayInfo, ...updates.relayInfo }
  };
};

// ============================================================================
// Orchestrators
// ============================================================================

const initialiseMessaging = async (
  nostr: NPool, 
  signer: Signer, 
  myPubkey: string, 
  settings: DMSettings,
  updateContext: (updates: Partial<MessagingContext>) => void
): Promise<void> => {
  const timings: Record<string, number> = {};
  const startTime = Date.now();
  
  const cached = await DMLib.Impure.Cache.loadFromCache(myPubkey);
  timings.loadCache = Date.now() - startTime;
  
  // todo: have a const define a ttl and compare it here
  const mode = cached && cached.syncState.lastCacheTime ? DMLib.StartupMode.WARM : DMLib.StartupMode.COLD;
  console.log('[NewDM] Mode:', mode, cached ? `(cache age: ${Math.round((Date.now() - (cached.syncState.lastCacheTime || 0)) / 1000)}s)` : '');
  
  // UPDATE 1: Show cached data immediately
  let currentState: MessagingState | null = null;
  
  if (cached && mode === DMLib.StartupMode.WARM) {
    const cachedConvoCount = Object.keys(cached.conversationMetadata || {}).length;
    if (cachedConvoCount > 0) {
      console.log(`[NewDM] 📦 Showing cache (${cachedConvoCount} convos) - ${Date.now() - startTime}ms`);
      currentState = cached;
      updateContext({ messagingState: cached, phase: NEW_DM_PHASES.CACHE, isLoading: false, timing: timings });
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
  
  // C. Query messages (use current user's relays from participants)
  console.log('[NewDM] C. Querying messages...');
  const stepC = Date.now();
  const since = mode === DMLib.StartupMode.WARM ? DMLib.Pure.Sync.computeSinceTimestamp(cached.syncState.lastCacheTime, 2) : null;
  const { messagesWithMetadata, limitReached: isLimitReachedDuringInitialQuery, relayInfo: relayInfoFromInitial } = await DMLib.Impure.Message.queryMessages(nostr, signer, baseParticipants[myPubkey].derivedRelays, myPubkey, since, settings.queryLimit);
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
  
  currentState = mergeMessagingState(currentState, newState);
  updateContext({ messagingState: currentState, phase: NEW_DM_PHASES.INITIAL_QUERY, isLoading: false, timing: timings });
  
  // D. Extract unique users
  console.log('[NewDM] D. Extracting new pubkeys...');
  const newPubkeys = DMLib.Pure.Participant.extractNewPubkeys(messagesWithMetadata, baseParticipants, myPubkey, mode);
  console.log('[NewDM] D. New pubkeys:', newPubkeys);
  
  // E+F. Fetch relay lists and merge participants
  console.log('[NewDM] E+F. Fetching and merging participants...');
  const stepEF = Date.now();
  const participants = await DMLib.Impure.Participant.fetchAndMergeParticipants(nostr, baseParticipants, newPubkeys, settings.relayMode, settings.discoveryRelays);
  timings.fetchAndMergeParticipants = Date.now() - stepEF;
  console.log('[NewDM] E+F. Final participants:', Object.keys(participants), 'includes me?', myPubkey in participants);
  
  // H. Find new relays to query
  const alreadyQueried = mode === DMLib.StartupMode.WARM ? cached.syncState.queriedRelays : participants[myPubkey].derivedRelays;
  const newRelays = DMLib.Pure.Relay.findNewRelaysToQuery(participants, alreadyQueried);
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
  
  currentState = mergeMessagingState(currentState, gapFillingState);
  
  // Save to cache
  await DMLib.Impure.Cache.saveToCache(myPubkey, currentState!);
  
  timings.buildAndSave = Date.now() - stepK;
  timings.total = Date.now() - startTime;
  
  console.log(`[NewDM] ✅ Complete - ${Object.keys(currentState!.conversationMetadata).length} convos, ${timings.total}ms`);
  
  updateContext({ messagingState: currentState, phase: NEW_DM_PHASES.COMPLETE, isLoading: false, timing: timings });
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

interface MessagingContext {
  messagingState: MessagingState | null;
  isLoading: boolean;
  timing: Record<string, number>;
  phase: NewDMPhase | null;
}

interface NewDMContextValue extends MessagingContext {
  // TODO: Not yet implemented
  sendMessage: (params: {
    recipientPubkey: string;
    content: string;
    protocol: MessageProtocol;
  }) => Promise<void>;
  protocolMode: ProtocolMode;
  getConversationRelays: (conversationId: string) => ConversationRelayInfo[];
  clearCacheAndRefetch: () => Promise<void>;
  subscriptions: SubscriptionStatus; // TODO: Implement real-time subscriptions
  scanProgress: ScanProgressState; // TODO: Implement batch progress tracking
  isDoingInitialLoad: boolean; // Derived from isLoading + phase
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
  const { config: appConfig } = useAppContext();
  
  // Stabilize discovery relays reference to avoid triggering effects
  const discoveryRelays = useMemo(() => appConfig.discoveryRelays, [appConfig.discoveryRelays.join(',')]);
  
  const [context, setContext] = useState<MessagingContext>({
    messagingState: null,
    isLoading: true,
    timing: {},
    phase: null
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
  
  // Stable callback - doesn't depend on context
  const updateContext = useCallback((updates: Partial<MessagingContext>) => {
    setContext(prev => ({ ...prev, ...updates }));
  }, []);
  
  // Process incoming message and add to state incrementally
  const processIncomingMessage = useCallback(async (event: DMLib.NostrEvent) => {
    if (!user?.pubkey || !context.messagingState) return;
    
    try {
      // Decrypt message using shared library function (reuses same logic as initial load)
      const messagesWithMetadata = await DMLib.Impure.Message.decryptAllMessages(
        [event],
        user.signer,
        user.pubkey
      );
      
      if (messagesWithMetadata.length === 0) {
        return; // Failed to process or decrypt
      }
      
      // Add message incrementally (much more efficient than rebuilding entire state)
      const updatedState = DMLib.Pure.Sync.addMessageToState(
        context.messagingState,
        messagesWithMetadata[0],
        user.pubkey
      );
      
      updateContext({ messagingState: updatedState });
    } catch (error) {
      console.error('[NewDM] Failed to process incoming message:', error);
    }
  }, [user, context.messagingState, updateContext]);
  
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
  const startNIP4Subscription = useCallback(async () => {
    if (!user?.pubkey || !nostr || !context.messagingState) return;
    
    if (nip4SubscriptionRef.current) {
      nip4SubscriptionRef.current.close();
      nip4SubscriptionRef.current = null;
    }
    
    try {
      const myRelays = context.messagingState.participants[user.pubkey]?.derivedRelays || [];
      if (myRelays.length === 0) {
        console.warn('[NewDM] No relays available for NIP-4 subscription');
        return;
      }
      
      // Subscribe from last cache time with 10s overlap for race conditions
      const since = context.messagingState.syncState.lastCacheTime 
        ? Math.floor(context.messagingState.syncState.lastCacheTime / 1000) - 10
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
  }, [user, nostr, context.messagingState, processIncomingMessage]);
  
  // Start NIP-17 subscription
  const startNIP17Subscription = useCallback(async () => {
    if (!user?.pubkey || !nostr || !context.messagingState) return;
    
    if (nip17SubscriptionRef.current) {
      nip17SubscriptionRef.current.close();
      nip17SubscriptionRef.current = null;
    }
    
    try {
      const myRelays = context.messagingState.participants[user.pubkey]?.derivedRelays || [];
      if (myRelays.length === 0) {
        console.warn('[NewDM] No relays available for NIP-17 subscription');
        return;
      }
      
      // Subscribe from last cache time with 10s overlap, adjusted for NIP-17 timestamp fuzzing (±2 days)
      const TWO_DAYS_IN_SECONDS = 2 * 24 * 60 * 60;
      const since = context.messagingState.syncState.lastCacheTime 
        ? Math.floor(context.messagingState.syncState.lastCacheTime / 1000) - 10 - TWO_DAYS_IN_SECONDS
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
  }, [user, nostr, context.messagingState, processIncomingMessage]);
  
  // Start all subscriptions
  const startSubscriptions = useCallback(async () => {
    console.log('[NewDM] Starting subscriptions...');
    await Promise.all([
      startNIP4Subscription(),
      startNIP17Subscription()
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
    initialisedForPubkey.current = user.pubkey;
    setContext({ messagingState: null, isLoading: true, timing: {}, phase: null });
    
    (async () => {
      try {
        console.log('[NewDM] Starting initialization for', user.pubkey.substring(0, 8));
        const settings: DMSettings = {
          discoveryRelays,
          relayMode: RELAY_MODE.HYBRID,
          relayTTL: 7 * 24 * 60 * 60 * 1000,
          queryLimit: 20000,
        };
        
        await initialiseMessaging(nostr, user.signer, user.pubkey, settings, updateContext);
        console.log('[NewDM] ✅ Initialization complete');
        
        // Start real-time subscriptions after initialization completes
        await startSubscriptions();
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
  
  // TODO: Not yet implemented - stub implementations
  const sendMessage = useCallback(async (_params: {
    recipientPubkey: string;
    content: string;
    protocol: MessageProtocol;
  }) => {
    console.log('[NewDM] sendMessage not yet implemented');
  }, []);
  
  const getConversationRelays = useCallback((_conversationId: string): ConversationRelayInfo[] => {
    // TODO: Implement relay lookup from participants
    return [];
  }, []);
  
  // Clear cache and refetch from relays
  const clearCacheAndRefetch = useCallback(async () => {
    if (!user?.pubkey) return;
    
    try {
      cleanupSubscriptions();
      
      const { deleteMessagesFromDB } = await import('@/lib/dmMessageStore');
      await deleteMessagesFromDB(user.pubkey);
      
      // Reset state and trigger reload
      setContext({
        messagingState: null,
        isLoading: true,
        timing: {},
        phase: null
      });
      initialisedForPubkey.current = null; // Force re-initialization
      
      console.log('[NewDM] Cache cleared, reloading...');
    } catch (error) {
      console.error('[NewDM] Error clearing cache:', error);
    }
  }, [user?.pubkey, cleanupSubscriptions]);
  
  // Cleanup subscriptions on unmount or user change
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
    };
  }, [user?.pubkey]);
  
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
        clearCacheAndRefetch();
      }
    } catch (error) {
      console.warn('[NewDM] Could not check sessionStorage for cache clear flag:', error);
    }
  }, [user?.pubkey]);
  
  const isDoingInitialLoad = context.isLoading && (context.phase === NEW_DM_PHASES.CACHE || context.phase === NEW_DM_PHASES.INITIAL_QUERY);

  const value: NewDMContextValue = {
    ...context,
    sendMessage,
    protocolMode,
    getConversationRelays,
    clearCacheAndRefetch,
    subscriptions: subscriptionStatus,
    scanProgress, // TODO: Implement batch progress tracking
    isDoingInitialLoad,
  };
  
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
