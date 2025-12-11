/* eslint-disable */
// @ts-nocheck
import { createContext, useContext, ReactNode, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { RELAY_MODE } from '@/lib/dmTypes';
import type {
  DMSettings,
  MessagingState,
} from '@/lib/dmTypes';
import {
  loadFromCache,
  fetchMyRelayInfo,
  deriveRelaySet,
  refreshStaleParticipants,
  computeSinceTimestamp,
  queryMessages,
  extractNewPubkeys,
  fetchAndMergeParticipants,
  findNewRelaysToQuery,
  queryNewRelays,
  computeAllQueriedRelays,
  buildAndSaveCache,
} from '@/lib/dmLib';

const MESSAGES_PER_PAGE = 25;

enum StartupMode {
  COLD = 'cold',
  WARM = 'warm',
}

// ============================================================================
// Orchestrators
// ============================================================================

const initialiseMessaging = async (nostr: NPool, signer: Signer, myPubkey: string, settings: DMSettings): Promise<MessagingState> => {
  const cached = await loadFromCache(myPubkey);
  // todo: have a const define a ttl and compare it here
  const mode = cached && cached.syncState.lastCacheTime ? StartupMode.WARM : StartupMode.COLD;
  
  // A. Fetch my relay lists
  const { myLists, myBlockedRelays } = await fetchMyRelayInfo(nostr, settings.discoveryRelays, myPubkey);
  // B. Derive my relay set
  const relaySet = deriveRelaySet(myLists.kind10002, myLists.kind10050, myBlockedRelays, settings.relayMode, settings.discoveryRelays);
  // B.2/B.3 Refresh stale participants (warm start only)
  const baseParticipants = mode === StartupMode.WARM ? await refreshStaleParticipants(nostr, cached.participants, myBlockedRelays, settings.relayMode, settings.discoveryRelays, settings.relayTTL) : {};
  // C. Query messages
  const since = mode === StartupMode.WARM ? computeSinceTimestamp(cached.syncState.lastCacheTime, 2) : null;
  const { messagesWithMetadata, limitReached: isLimitReachedDuringInitialQuery } = await queryMessages(nostr, signer, relaySet, myPubkey, since, settings.queryLimit);
  // D. Extract unique users
  const newPubkeys = extractNewPubkeys(messagesWithMetadata, baseParticipants, myPubkey, mode);
  // E+F. Fetch relay lists and merge participants
  const participants = await fetchAndMergeParticipants(nostr, baseParticipants, newPubkeys, myBlockedRelays, settings.relayMode, settings.discoveryRelays);
  // H. Find new relays to query
  const alreadyQueried = mode === StartupMode.WARM ? cached.syncState.queriedRelays : relaySet;
  const newRelays = findNewRelaysToQuery(participants, alreadyQueried);
  // I. Query new relays
  const { allMessages, limitReached: isLimitReachedDuringGapQuery } = await queryNewRelays(nostr, signer, newRelays, myPubkey, settings.queryLimit);
  // J. Build and save
  const allQueriedRelays = computeAllQueriedRelays(mode, cached, relaySet, newRelays);
  return await buildAndSaveCache(myPubkey, participants, allQueriedRelays, isLimitReachedDuringInitialQuery || isLimitReachedDuringGapQuery);
}

// ============================================================================
// React Context
// ============================================================================

interface NewDMContextValue {
  messagingState: MessagingState | null;
  isLoading: boolean;
}

const NewDMContext = createContext<NewDMContextValue | undefined>(undefined);

export const NewDMProvider = ({ children }: { children: ReactNode }) => {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config: appConfig } = useAppContext();
  
  const [messagingState, setMessagingState] = useState<MessagingState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const initialisedForPubkey = useRef<string | null>(null);
  
  // do our intiial load (cold or warm) of messaging state
  useEffect(() => {
    if (!user) {
      initialisedForPubkey.current = null;
      setMessagingState(null);
      setIsLoading(true);
      return;
    }
    
    if (initialisedForPubkey.current === user.pubkey) return;
    
    initialisedForPubkey.current = user.pubkey;
    setMessagingState(null);
    setIsLoading(true);
    
    (async () => {
      const settings: DMSettings = {
        discoveryRelays: appConfig.discoveryRelays,
        relayMode: RELAY_MODE.HYBRID,
        relayTTL: 7 * 24 * 60 * 60 * 1000,
        queryLimit: 20000,
      };
      
      const result = await initialiseMessaging(nostr, user.signer, user.pubkey, settings);
      setMessagingState(result);
      setIsLoading(false);
    })();
  }, [user?.pubkey, nostr, appConfig.discoveryRelays]);
  
  const value: NewDMContextValue = {
    messagingState,
    isLoading,
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
    const messages = messagingState?.messages[conversationId] || [];
    const totalCount = messages.length;
    const hasMore = totalCount > visibleCount;
    const visibleMessages = messages.slice(-visibleCount);

    return {
      messages: visibleMessages,
      hasMoreMessages: hasMore,
      totalCount,
    };
  }, [messagingState?.messages[conversationId], visibleCount]);

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
