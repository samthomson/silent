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
import { PROTOCOL_MODE, type ProtocolMode, type MessageProtocol } from '@/lib/dmConstants';
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
      updateContext({ messagingState: cached, phase: 'cache', isLoading: false, timing: timings });
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
  updateContext({ messagingState: currentState, phase: 'initial_query', isLoading: false, timing: timings });
  
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
  
  updateContext({ messagingState: currentState, phase: 'complete', isLoading: false, timing: timings });
}

// ============================================================================
// React Context
// ============================================================================

interface MessagingContext {
  messagingState: MessagingState | null;
  isLoading: boolean;
  timing: Record<string, number>;
  phase: 'cache' | 'initial_query' | 'gap_filling' | 'complete' | null;
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
  
  const [context, setContext] = useState<MessagingContext>({
    messagingState: null,
    isLoading: true,
    timing: {},
    phase: null
  });
  
  const initialisedForPubkey = useRef<string | null>(null);
  
  const updateContext = useCallback((updates: Partial<MessagingContext>) => {
    setContext(prev => ({ ...prev, ...updates }));
  }, []);
  
  // do our intiial load (cold or warm) of messaging state
  useEffect(() => {
    if (!user) {
      initialisedForPubkey.current = null;
      setContext({ messagingState: null, isLoading: true, timing: {}, phase: null });
      return;
    }
    
    if (initialisedForPubkey.current === user.pubkey) return;
    
    initialisedForPubkey.current = user.pubkey;
    setContext({ messagingState: null, isLoading: true, timing: {}, phase: null });
    
    (async () => {
      try {
        console.log('[NewDM] Starting initialization...');
        const settings: DMSettings = {
          discoveryRelays: appConfig.discoveryRelays,
          relayMode: RELAY_MODE.HYBRID,
          relayTTL: 7 * 24 * 60 * 60 * 1000,
          queryLimit: 20000,
        };
        
        await initialiseMessaging(nostr, user.signer, user.pubkey, settings, updateContext);
        console.log('[NewDM] ✅ Initialization complete');
      } catch (error) {
        console.error('[NewDM] Initialization failed:', error);
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
  }, [user?.pubkey, nostr, appConfig.discoveryRelays]);
  
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
  }, [user?.pubkey, clearCacheAndRefetch]);
  
  const value: NewDMContextValue = {
    ...context,
    sendMessage,
    protocolMode,
    getConversationRelays,
    clearCacheAndRefetch,
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
