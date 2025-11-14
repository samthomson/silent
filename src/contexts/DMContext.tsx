import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@nostrify/react';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useRelayLists } from '@/hooks/useRelayList';
import { validateDMEvent, createConversationId, parseConversationId } from '@/lib/dmUtils';
import { LOADING_PHASES, type LoadingPhase, PROTOCOL_MODE, type ProtocolMode } from '@/lib/dmConstants';
import { fetchRelayListsBulk } from '@/lib/relayUtils';
import { NSecSigner, type NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey } from 'nostr-tools';
import type { MessageProtocol } from '@/lib/dmConstants';
import { MESSAGE_PROTOCOL } from '@/lib/dmConstants';

// ============================================================================
// DM Types and Constants
// ============================================================================

interface ParticipantData {
  messages: DecryptedMessage[];
  lastActivity: number;
  lastMessage: DecryptedMessage | null;
  hasNIP4: boolean;
  hasNIP17: boolean;
}

type MessagesState = Map<string, ParticipantData>;

interface LastSyncData {
  nip4: number | null;
  nip17: number | null;
}

interface SubscriptionStatus {
  isNIP4Connected: boolean;
  isNIP17Connected: boolean;
}

interface ScanProgress {
  current: number;
  status: string;
}

interface ScanProgressState {
  nip4: ScanProgress | null;
  nip17: ScanProgress | null;
}

interface ConversationSummary {
  id: string;
  pubkey: string;
  lastMessage: DecryptedMessage | null;
  lastActivity: number;
  hasNIP4Messages: boolean;
  hasNIP17Messages: boolean;
  isKnown: boolean;
  isRequest: boolean;
  lastMessageFromUser: boolean;
}

interface MessageProcessingResult {
  lastMessageTimestamp?: number;
  messageCount: number;
}

interface DecryptionResult {
  decryptedContent: string;
  error?: string;
}

export interface DecryptedMessage extends NostrEvent {
  decryptedContent?: string;
  error?: string;
  isSending?: boolean;
  clientFirstSeen?: number;
  decryptedEvent?: NostrEvent; // For NIP-17: the inner kind 14/15 event
  originalGiftWrapId?: string; // Store gift wrap ID for NIP-17 deduplication
  originalGiftWrap?: NostrEvent; // Store full gift wrap for debugging
}

interface NIP17ProcessingResult {
  processedMessage: DecryptedMessage;
  conversationPartner: string;
  sealEvent: NostrEvent; // Return the seal so we can cache it
}

const DM_CONSTANTS = {
  DEBOUNCED_WRITE_DELAY: 15000,
  RECENT_MESSAGE_THRESHOLD: 5000,
  SUBSCRIPTION_OVERLAP_SECONDS: 10, // Overlap for subscriptions to catch race conditions
  SCAN_TOTAL_LIMIT: 20000,
  SCAN_BATCH_SIZE: 1000,
  NIP4_QUERY_TIMEOUT: 15000,
  NIP17_QUERY_TIMEOUT: 30000,
  ERROR_LOG_DEBOUNCE_DELAY: 2000,
} as const;

const SCAN_STATUS_MESSAGES = {
  NIP4_STARTING: 'Starting NIP-4 scan...',
  NIP17_STARTING: 'Starting NIP-17 scan...',
} as const;

const createErrorLogger = (name: string) => {
  let count = 0;
  let timeout: NodeJS.Timeout | null = null;

  return (_error: Error) => {
    count++;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (count > 0) {
        console.error(`[DM] ${name} processing complete with ${count} errors`);
        count = 0;
      }
    }, DM_CONSTANTS.ERROR_LOG_DEBOUNCE_DELAY);
  };
};

const nip17ErrorLogger = createErrorLogger('NIP-17');

/**
 * Direct Messaging context interface providing access to all DM functionality.
 *
 * @property messages - Raw message state (Map of pubkey -> participant data)
 * @property isLoading - True during initial load phases
 * @property loadingPhase - Current loading phase (CACHE, RELAYS, SUBSCRIPTIONS, READY, IDLE)
 * @property isDoingInitialLoad - True only during cache/relay loading (not subscriptions)
 * @property lastSync - Unix timestamps of last successful sync for each protocol
 * @property subscriptions - Connection status for real-time message subscriptions
 * @property conversations - Array of conversation summaries sorted by last activity
 * @property sendMessage - Send an encrypted direct message (NIP-04 or NIP-17)
 * @property protocolMode - Current protocol mode (NIP04_ONLY, NIP17_ONLY, or BOTH)
 * @property scanProgress - Progress info for large message history scans
 * @property clearCacheAndRefetch - Clear IndexedDB cache and reload all messages from relays
 */
interface RelayError {
  timestamp: number;
  message: string;
  protocol: MessageProtocol;
  failedRelays: string[];
  totalRelays: number;
}

interface DMContextType {
  messages: MessagesState;
  isLoading: boolean;
  loadingPhase: LoadingPhase;
  isDoingInitialLoad: boolean;
  lastSync: LastSyncData;
  subscriptions: SubscriptionStatus;
  conversations: ConversationSummary[];
  sendMessage: (params: {
    recipientPubkey: string | string[];
    content: string;
    protocol?: MessageProtocol;
    attachments?: FileAttachment[];
  }) => Promise<void>;
  protocolMode: ProtocolMode;
  scanProgress: ScanProgressState;
  clearCacheAndRefetch: () => Promise<void>;
  relayError: RelayError | null;
  clearRelayError: () => void;
}

const DMContext = createContext<DMContextType | null>(null);

/**
 * Hook to access the direct messaging system.
 *
 * Provides access to conversations, message sending, loading states, and cache management.
 * Must be used within a DMProvider.
 *
 * @example
 * ```tsx
 * import { useDMContext } from '@/contexts/DMContext';
 * import { MESSAGE_PROTOCOL } from '@/lib/dmConstants';
 *
 * function MyComponent() {
 *   const { conversations, sendMessage, isLoading } = useDMContext();
 *
 *   // Send a message
 *   await sendMessage({
 *     recipientPubkey: 'hex-pubkey',
 *     content: 'Hello!',
 *     protocol: MESSAGE_PROTOCOL.NIP17
 *   });
 *
 *   // Display conversations
 *   return (
 *     <div>
 *       {isLoading ? 'Loading...' : conversations.map(c => (
 *         <div key={c.pubkey}>{c.lastMessage?.decryptedContent}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @returns DMContextType - The direct messaging context
 * @throws Error if used outside DMProvider
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDMContext(): DMContextType {
  const context = useContext(DMContext);
  if (!context) {
    throw new Error('useDMContext must be used within DMProvider');
  }
  return context;
}

const MESSAGES_PER_PAGE = 25;

/**
 * Hook to access paginated messages for a specific conversation.
 *
 * Returns the most recent messages (default 25) with the ability to load earlier messages.
 * Automatically resets to default page size when switching conversations.
 *
 * @example
 * ```tsx
 * import { useConversationMessages } from '@/contexts/DMContext';
 *
 * function MessageThread({ recipientPubkey }: { recipientPubkey: string }) {
 *   const {
 *     messages,
 *     hasMoreMessages,
 *     loadEarlierMessages,
 *     totalCount
 *   } = useConversationMessages(recipientPubkey);
 *
 *   return (
 *     <div>
 *       {hasMoreMessages && (
 *         <button onClick={loadEarlierMessages}>
 *           Load Earlier ({totalCount - messages.length} more)
 *         </button>
 *       )}
 *       {messages.map(msg => (
 *         <div key={msg.id}>{msg.decryptedContent}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @param conversationId - The pubkey of the conversation participant
 * @returns Paginated message data with loading function
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useConversationMessages(conversationId: string) {
  const { messages: allMessages } = useDMContext();
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE);

  const result = useMemo(() => {
    const conversationData = allMessages.get(conversationId);

    if (!conversationData) {
      return {
        messages: [],
        hasMoreMessages: false,
        totalCount: 0,
        lastMessage: null,
        lastActivity: 0,
      };
    }

    const totalMessages = conversationData.messages.length;
    const hasMore = totalMessages > visibleCount;

    // Return the most recent N messages (slice from the end)
    const visibleMessages = conversationData.messages.slice(-visibleCount);

    return {
      messages: visibleMessages,
      hasMoreMessages: hasMore,
      totalCount: totalMessages,
      lastMessage: conversationData.lastMessage,
      lastActivity: conversationData.lastActivity,
    };
  }, [allMessages, conversationId, visibleCount]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleCount(prev => prev + MESSAGES_PER_PAGE);
  }, []);

  // Reset visible count when conversation changes
  useEffect(() => {
    setVisibleCount(MESSAGES_PER_PAGE);
  }, [conversationId]);

  return {
    ...result,
    loadEarlierMessages,
  };
}

export interface DMConfig {
  enabled?: boolean;
  protocolMode?: ProtocolMode;
}

interface DMProviderProps {
  children: ReactNode;
  config?: DMConfig;
}

// ============================================================================
// Message Sending Types and Helpers (Internal)
// ============================================================================

/**
 * File attachment for direct messages (NIP-92 compatible).
 *
 * All fields are required. Use with `useUploadFile` hook to upload files
 * and generate the proper tags format.
 *
 * @example
 * ```tsx
 * import { useUploadFile } from '@/hooks/useUploadFile';
 * import type { FileAttachment } from '@/contexts/DMContext';
 *
 * const { mutateAsync: uploadFile } = useUploadFile();
 *
 * const tags = await uploadFile(file);
 * const attachment: FileAttachment = {
 *   url: tags[0][1],
 *   mimeType: file.type,
 *   size: file.size,
 *   name: file.name,
 *   tags: tags
 * };
 *
 * await sendMessage({
 *   recipientPubkey: 'hex-pubkey',
 *   content: 'Check out this file!',
 *   attachments: [attachment]
 * });
 * ```
 *
 * @property url - Blossom server URL where file is hosted
 * @property mimeType - MIME type of the file (e.g., 'image/png')
 * @property size - File size in bytes
 * @property name - Original filename
 * @property tags - NIP-94 file metadata tags (includes hashes)
 */
export interface FileAttachment {
  url: string;
  mimeType: string;
  size: number;
  name: string;
  tags: string[][];
}

/**
 * Prepare message content with file URLs appended
 */
function prepareMessageContent(content: string, attachments: FileAttachment[] = []): string {
  if (attachments.length === 0) return content;

  const fileUrls = attachments.map(file => file.url).join('\n');
  return content ? `${content}\n\n${fileUrls}` : fileUrls;
}

/**
 * Create imeta tags for file attachments (NIP-92)
 */
function createImetaTags(attachments: FileAttachment[] = []): string[][] {
  return attachments.map(file => {
    const imetaTag = ['imeta'];
    imetaTag.push(`url ${file.url}`);
    if (file.mimeType) imetaTag.push(`m ${file.mimeType}`);
    if (file.size) imetaTag.push(`size ${file.size}`);
    if (file.name) imetaTag.push(`alt ${file.name}`);

    // Add hash tags from file.tags
    file.tags.forEach(tag => {
      if (tag[0] === 'x') imetaTag.push(`x ${tag[1]}`);
      if (tag[0] === 'ox') imetaTag.push(`ox ${tag[1]}`);
    });

    return imetaTag;
  });
}

// ============================================================================
// DMProvider Component
// ============================================================================

export function DMProvider({ children, config }: DMProviderProps) {
  const { enabled = false, protocolMode = PROTOCOL_MODE.NIP17_ONLY } = config || {};
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const { config: appConfig } = useAppContext();
  const queryClient = useQueryClient();

  const userPubkey = useMemo(() => user?.pubkey, [user?.pubkey]);

  // Get user's relay lists (both 10002 and 10050 in one query)
  const { data: relayLists } = useRelayLists();
  
  // Extract user's inbox relays with priority fallback: 10050 → 10002 read relays → discovery relays
  const userInboxRelays = useMemo(() => {
    // Priority 1: NIP-17 DM inbox relays (kind 10050)
    if (relayLists?.dmInbox?.relays && relayLists.dmInbox.relays.length > 0) {
      return relayLists.dmInbox.relays;
    }
    
    // Priority 2: NIP-65 read relays (kind 10002)
    const readRelays = relayLists?.nip65?.relays?.filter(r => r.read)?.map(r => r.url);
    if (readRelays && readRelays.length > 0) {
      return readRelays;
    }
    
    // Priority 3: Discovery relays
    return appConfig.discoveryRelays;
  }, [relayLists, appConfig.discoveryRelays]);

  // Track relay list changes by event IDs
  const previousDMEventId = useRef<string>();
  const previousNIP65EventId = useRef<string>();

  // Determine if NIP-17 is enabled based on protocol mode
  const enableNIP17 = protocolMode !== PROTOCOL_MODE.NIP04_ONLY;

  const [messages, setMessages] = useState<MessagesState>(new Map());
  const [lastSync, setLastSync] = useState<LastSyncData>({
    nip4: null,
    nip17: null
  });
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(LOADING_PHASES.IDLE);
  const [subscriptions, setSubscriptions] = useState<SubscriptionStatus>({
    isNIP4Connected: false,
    isNIP17Connected: false
  });
  const [hasInitialLoadCompleted, setHasInitialLoadCompleted] = useState(false);
  const [shouldSaveImmediately, setShouldSaveImmediately] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressState>({
    nip4: null,
    nip17: null
  });
  const [relayError, setRelayError] = useState<RelayError | null>(null);

  const nip4SubscriptionRef = useRef<{ close: () => void } | null>(null);
  const nip17SubscriptionRef = useRef<{ close: () => void } | null>(null);
  const debouncedWriteRef = useRef<NodeJS.Timeout | null>(null);

  const clearRelayError = useCallback(() => {
    setRelayError(null);
  }, []);

  // ============================================================================
  // Helper: Get inbox relays for a pubkey
  // ============================================================================

  const getInboxRelaysForPubkey = useCallback(async (pubkey: string): Promise<string[]> => {
    try {
      const relayGroup = nostr.group(appConfig.discoveryRelays);
      const events = await relayGroup.query(
        [{ kinds: [10002], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(3000) }
      );

      if (events.length === 0) {
        return appConfig.discoveryRelays;
      }

      const readRelays = events[0].tags
        .filter(tag => tag[0] === 'r')
        .filter(tag => !tag[2] || tag[2] === 'read')
        .map(tag => tag[1])
        .filter(Boolean);

      return readRelays.length > 0 ? readRelays : appConfig.discoveryRelays;
    } catch (error) {
      console.error('[DM] Failed to fetch inbox relays for', pubkey, error);
      return appConfig.discoveryRelays;
    }
  }, [nostr, appConfig.discoveryRelays]);

  // ============================================================================
  // Internal Message Sending Mutations
  // ============================================================================

  // Send NIP-04 Message (internal)
  const sendNIP4Message = useMutation<NostrEvent, Error, {
    recipientPubkey: string;
    content: string;
    attachments?: FileAttachment[];
  }>({
    mutationFn: async ({ recipientPubkey, content, attachments = [] }) => {
      if (!user) {
        throw new Error('User is not logged in');
      }

      if (!user.signer.nip04) {
        throw new Error('NIP-04 encryption not available');
      }

      // Prepare content with file URLs
      const messageContent = prepareMessageContent(content, attachments);

      // Encrypt the content
      const encryptedContent = await user.signer.nip04.encrypt(recipientPubkey, messageContent);

      // Build tags with imeta tags for attachments
      const tags: string[][] = [
        ['p', recipientPubkey],
        ...createImetaTags(attachments)
      ];

      // Get inbox relays for both user and recipient
      const [userInbox, recipientInbox] = await Promise.all([
        Promise.resolve(userInboxRelays),
        getInboxRelaysForPubkey(recipientPubkey)
      ]);

      // Combine both inboxes (NIP-4 is a shared event visible to both parties)
      const publishRelays = Array.from(new Set([...userInbox, ...recipientInbox]));
      const relayGroup = nostr.group(publishRelays);

      // Sign the event using createEvent (includes "client" tag)
      const signedEvent = await createEvent({
        kind: 4,
        content: encryptedContent,
        tags,
      });

      // Publish to both inboxes
      await relayGroup.event(signedEvent);
      return signedEvent;
    },
    onError: (error) => {
      console.error('[DM] Failed to send NIP-04 message:', error);
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Send NIP-17 Message (internal)
  const sendNIP17Message = useMutation<NostrEvent, Error, {
    recipientPubkey: string | string[];
    content: string;
    attachments?: FileAttachment[];
  }>({
    mutationFn: async ({ recipientPubkey, content, attachments = [] }) => {
      // Normalize to array for consistent handling
      const recipients = Array.isArray(recipientPubkey) ? recipientPubkey : [recipientPubkey];
      if (!user) {
        throw new Error('User is not logged in');
      }

      if (!user.signer.nip44) {
        throw new Error('NIP-44 encryption not available');
      }

      // Step 1: Create the inner Kind 14 Private Direct Message
      const now = Math.floor(Date.now() / 1000);

      // Generate randomized timestamps for gift wraps (NIP-59 metadata privacy)
      // Randomize within ±2 days in the PAST only (relays reject future timestamps > +30min)
      const randomizeTimestamp = (baseTime: number) => {
        const twoDaysInSeconds = 2 * 24 * 60 * 60;
        // Random offset between -2 days and 0 (never future)
        const randomOffset = -Math.floor(Math.random() * twoDaysInSeconds);
        return baseTime + randomOffset;
      };

      // Prepare content with file URLs
      const messageContent = prepareMessageContent(content, attachments);

      // Build tags with p tags for all recipients and imeta tags for attachments
      const tags: string[][] = [
        ...recipients.map(pubkey => ['p', pubkey]),
        ...createImetaTags(attachments)
      ];

      // Use kind 15 for messages with file attachments, kind 14 for text-only
      const messageKind = (attachments && attachments.length > 0) ? 15 : 14;

      const privateMessage: Omit<NostrEvent, 'id' | 'sig'> = {
        kind: messageKind,
        pubkey: user.pubkey,
        created_at: now,
        tags,
        content: messageContent,
      };

      // Step 2: Create Kind 13 Seal events and Kind 1059 Gift Wraps for each recipient + sender
      // For NIP-17 group chats, we send a separate gift wrap to each participant
      // Deduplicate to avoid sending duplicate gift wraps for self-messaging
      const allRecipients = [...new Set([...recipients, user.pubkey])];
      const giftWraps: NostrEvent[] = [];

      for (const recipientPubkey of allRecipients) {
        // Create seal for this recipient
        const seal: Omit<NostrEvent, 'id' | 'sig'> = {
          kind: 13,
          pubkey: user.pubkey,
          created_at: now,
          tags: [],
          content: await user.signer.nip44.encrypt(recipientPubkey, JSON.stringify(privateMessage)),
        };

        // Generate random secret key for gift wrap
        const randomKey = generateSecretKey();
        const randomSigner = new NSecSigner(randomKey);

        // Encrypt the seal using the random signer
        const giftWrapContent = await randomSigner.nip44!.encrypt(recipientPubkey, JSON.stringify(seal));

        // Sign gift wrap with random key and randomized timestamp
        const giftWrap = await randomSigner.signEvent({
          kind: 1059,
          created_at: randomizeTimestamp(now),
          tags: [['p', recipientPubkey]],
          content: giftWrapContent,
        });

        giftWraps.push(giftWrap);
      }

      // Publish each gift wrap to the recipient's inbox relays
      try {
        // Fetch all inbox relays in parallel first
        const inboxRelayPromises = giftWraps.map(async (giftWrap) => {
          const recipientPubkey = giftWrap.tags.find(tag => tag[0] === 'p')?.[1];
          if (!recipientPubkey) {
            throw new Error('Gift wrap missing recipient pubkey');
          }
          const inboxRelays = await getInboxRelaysForPubkey(recipientPubkey);
          return { giftWrap, inboxRelays };
        });

        const giftWrapWithRelays = await Promise.all(inboxRelayPromises);

        // Now publish all in parallel
        const publishPromises = giftWrapWithRelays.map(({ giftWrap, inboxRelays }) => {
          const relayGroup = nostr.group(inboxRelays);
          return relayGroup.event(giftWrap);
        });

        const results = await Promise.allSettled(publishPromises);

        // Check for failures and log detailed errors
        const failures = results.filter(r => r.status === 'rejected');

        if (failures.length > 0) {
          console.error(`[DM] Failed to publish ${failures.length}/${giftWraps.length} gift wraps`);
          failures.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[DM] Gift wrap ${index} failed:`, result.reason);
            }
          });
        }

        // If all failed, throw error
        if (failures.length === giftWraps.length) {
          throw new Error(`All gift wraps rejected. Check console for details.`);
        }

        // Check if gift wraps to other participants failed (excluding sender's own gift wrap)
        const recipientGiftWrapCount = giftWraps.length - 1; // Exclude sender's gift wrap
        const recipientFailures = failures.length > 0 && failures.length >= recipientGiftWrapCount;

        if (recipientFailures && recipients.length > 0) {
          // Only sender's gift wrap succeeded - warn user
          throw new Error(`Message may not have been delivered to recipients. Please check your relay connection and try again.`);
        }

        // Log success count
        const successCount = giftWraps.length - failures.length;
        console.log(`[DM] Successfully published ${successCount}/${giftWraps.length} gift wraps`);
      } catch (publishError) {
        console.error('[DM] Publish error:', publishError);
        throw publishError;
      }

      // Return the first gift wrap (for compatibility)
      return giftWraps[0];
    },
    onError: (error) => {
      console.error('[DM] Failed to send NIP-17 message:', error);
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // ============================================================================
  // Message Loading and Processing
  // ============================================================================

  // Load past NIP-4 messages
  const loadPastNIP4Messages = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey) return;

    let allMessages: NostrEvent[] = [];
    let processedMessages = 0;
    let currentSince = sinceTimestamp || 0;

    setScanProgress(prev => ({ ...prev, nip4: { current: 0, status: SCAN_STATUS_MESSAGES.NIP4_STARTING } }));

    // Use user's inbox relays (read relays) for receiving DMs
    const relayGroup = nostr.group(userInboxRelays);

    while (processedMessages < DM_CONSTANTS.SCAN_TOTAL_LIMIT) {
      const batchLimit = Math.min(DM_CONSTANTS.SCAN_BATCH_SIZE, DM_CONSTANTS.SCAN_TOTAL_LIMIT - processedMessages);

      const filters = [
        { kinds: [4], '#p': [user.pubkey], limit: batchLimit, since: currentSince },
        { kinds: [4], authors: [user.pubkey], limit: batchLimit, since: currentSince }
      ];

      try {
        const batchDMs = await relayGroup.query(filters, { signal: AbortSignal.timeout(DM_CONSTANTS.NIP4_QUERY_TIMEOUT) });
        const validBatchDMs = batchDMs.filter(validateDMEvent);

        // Clear relay error on successful query
        setRelayError(null);

        if (validBatchDMs.length === 0) break;

        allMessages = [...allMessages, ...validBatchDMs];
        processedMessages += validBatchDMs.length;

        setScanProgress(prev => ({
          ...prev,
          nip4: {
            current: allMessages.length,
            status: `Batch ${Math.floor(processedMessages / DM_CONSTANTS.SCAN_BATCH_SIZE) + 1} complete: ${validBatchDMs.length} messages`
          }
        }));

        const oldestToMe = validBatchDMs.filter(m => m.pubkey !== user.pubkey).length > 0
          ? Math.min(...validBatchDMs.filter(m => m.pubkey !== user.pubkey).map(m => m.created_at))
          : Infinity;
        const oldestFromMe = validBatchDMs.filter(m => m.pubkey === user.pubkey).length > 0
          ? Math.min(...validBatchDMs.filter(m => m.pubkey === user.pubkey).map(m => m.created_at))
          : Infinity;

        const oldestInBatch = Math.min(oldestToMe, oldestFromMe);
        if (oldestInBatch !== Infinity) {
          currentSince = oldestInBatch;
        }

        if (validBatchDMs.length < batchLimit * 2) break;
      } catch (error) {
        console.error('[DM] NIP-4 Error in batch query:', error);
        setScanProgress(prev => ({ ...prev, nip4: null }));
        
        // Set relay error state with specific relay URLs
        setRelayError({
          timestamp: Date.now(),
          message: 'Failed to load messages from your inbox relays. Check your relay configuration.',
          protocol: MESSAGE_PROTOCOL.NIP04,
          failedRelays: userInboxRelays,
          totalRelays: userInboxRelays.length
        });
        
        // Also show toast for immediate feedback
        toast({
          title: 'Failed to load messages',
          description: `Failed to query ${userInboxRelays.length} inbox relay${userInboxRelays.length > 1 ? 's' : ''}. Check your relay configuration in settings.`,
          variant: 'destructive',
        });
        throw new Error('Failed to query inbox relays - check your NIP-65 relay configuration');
      }
    }

    setScanProgress(prev => ({ ...prev, nip4: null }));
    return allMessages;
  }, [user, nostr, userInboxRelays, toast]);

  // Load past NIP-17 messages
  const loadPastNIP17Messages = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey) return;

    let allNIP17Events: NostrEvent[] = [];
    let processedMessages = 0;

    // Adjust since timestamp to account for NIP-17 timestamp fuzzing (±2 days)
    // We need to query from (lastSync - 2 days) to catch messages with randomized past timestamps
    // This may fetch duplicates, but they're filtered by message ID in addMessageToState
    const TWO_DAYS_IN_SECONDS = 2 * 24 * 60 * 60;
    let currentSince = sinceTimestamp ? sinceTimestamp - TWO_DAYS_IN_SECONDS : 0;

    setScanProgress(prev => ({ ...prev, nip17: { current: 0, status: SCAN_STATUS_MESSAGES.NIP17_STARTING } }));

    // Use user's inbox relays (read relays) for receiving DMs
    const relayGroup = nostr.group(userInboxRelays);

    while (processedMessages < DM_CONSTANTS.SCAN_TOTAL_LIMIT) {
      const batchLimit = Math.min(DM_CONSTANTS.SCAN_BATCH_SIZE, DM_CONSTANTS.SCAN_TOTAL_LIMIT - processedMessages);

      const filters = [
        { kinds: [1059], '#p': [user.pubkey], limit: batchLimit, since: currentSince }
      ];

      try {
        const batchEvents = await relayGroup.query(filters, { signal: AbortSignal.timeout(DM_CONSTANTS.NIP17_QUERY_TIMEOUT) });

        // Clear relay error on successful query
        setRelayError(null);

        if (batchEvents.length === 0) break;

        allNIP17Events = [...allNIP17Events, ...batchEvents];
        processedMessages += batchEvents.length;

        setScanProgress(prev => ({
          ...prev,
          nip17: {
            current: allNIP17Events.length,
            status: `Batch ${Math.floor(processedMessages / DM_CONSTANTS.SCAN_BATCH_SIZE) + 1} complete: ${batchEvents.length} messages`
          }
        }));

        if (batchEvents.length > 0) {
          const oldestInBatch = Math.min(...batchEvents.map(m => m.created_at));
          currentSince = oldestInBatch;
        }

        if (batchEvents.length < batchLimit) break;
      } catch (error) {
        console.error('[DM] NIP-17 Error in batch query:', error);
        setScanProgress(prev => ({ ...prev, nip17: null }));
        
        // Set relay error state with specific relay URLs
        setRelayError({
          timestamp: Date.now(),
          message: 'Failed to load messages from your inbox relays. Check your relay configuration.',
          protocol: MESSAGE_PROTOCOL.NIP17,
          failedRelays: userInboxRelays,
          totalRelays: userInboxRelays.length
        });
        
        // Also show toast for immediate feedback
        toast({
          title: 'Failed to load messages',
          description: `Failed to query ${userInboxRelays.length} inbox relay${userInboxRelays.length > 1 ? 's' : ''}. Check your relay configuration in settings.`,
          variant: 'destructive',
        });
        throw new Error('Failed to query inbox relays - check your NIP-65 relay configuration');
      }
    }

    setScanProgress(prev => ({ ...prev, nip17: null }));
    return allNIP17Events;
  }, [user, nostr, userInboxRelays, toast]);

  // Query relays for messages
  const queryRelaysForMessagesSince = useCallback(async (protocol: MessageProtocol, sinceTimestamp?: number): Promise<MessageProcessingResult> => {
    if (protocol === MESSAGE_PROTOCOL.NIP17 && !enableNIP17) {
      return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
    }

    if (!userPubkey) {
      return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
    }

    if (protocol === MESSAGE_PROTOCOL.NIP04) {
      const messages = await loadPastNIP4Messages(sinceTimestamp);

      if (messages && messages.length > 0) {
        const newState = new Map();

        for (const message of messages) {
          const isFromUser = message.pubkey === user?.pubkey;
          const recipientPTag = message.tags?.find(([name]) => name === 'p')?.[1];
          const otherPubkey = isFromUser ? recipientPTag : message.pubkey;

          if (!otherPubkey) continue;

          const { decryptedContent, error } = await decryptNIP4Message(message, otherPubkey);

          const decryptedMessage: DecryptedMessage = {
            ...message,
            content: message.content,
            decryptedContent: decryptedContent,
            error: error,
          };

          const messageAge = Date.now() - (message.created_at * 1000);
          if (messageAge < 5000) {
            decryptedMessage.clientFirstSeen = Date.now();
          }

          // Use consistent conversation ID format (same as NIP-17)
          // For NIP-04, this is always a 1-on-1 conversation
          const conversationId = createConversationId([userPubkey, otherPubkey]);

          if (!newState.has(conversationId)) {
            newState.set(conversationId, createEmptyParticipant());
          }

          const participant = newState.get(conversationId)!;
          participant.messages.push(decryptedMessage);
          participant.hasNIP4 = true;
        }

        newState.forEach(participant => {
          sortAndUpdateParticipantState(participant);
        });

        mergeMessagesIntoState(newState);

        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip4: currentTime }));

        const newestMessage = messages.reduce((newest, msg) =>
          msg.created_at > newest.created_at ? msg : newest
        );
        return { lastMessageTimestamp: newestMessage.created_at, messageCount: messages.length };
      } else {
        // No new messages, but we still successfully queried relays - update lastSync
        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip4: currentTime }));
        return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
      }
    } else if (protocol === MESSAGE_PROTOCOL.NIP17) {
      const messages = await loadPastNIP17Messages(sinceTimestamp);

      if (messages && messages.length > 0) {
        const newState = new Map();

        for (const giftWrap of messages) {
          try {
            const { processedMessage, conversationPartner, sealEvent } = await processNIP17GiftWrap(giftWrap);

            // Skip messages with decryption errors
            if (processedMessage.error) {
              continue;
            }

            // Store the seal (kind 13) as-is + add decryptedEvent for inner message access + gift wrap for debugging
            const messageWithAnimation: DecryptedMessage = {
              ...sealEvent, // Seal fields (kind 13, seal pubkey, encrypted content, etc.)
              created_at: processedMessage.created_at, // Use real timestamp from inner message
              decryptedEvent: {
                ...processedMessage,
                content: processedMessage.decryptedContent,
              } as NostrEvent,
              decryptedContent: processedMessage.decryptedContent,
              originalGiftWrapId: giftWrap.id, // Store gift wrap ID for deduplication
              originalGiftWrap: giftWrap, // Store full gift wrap for debugging
            };

          // Use real message timestamp for recency check
          const messageAge = Date.now() - (processedMessage.created_at * 1000);
          if (messageAge < 5000) {
            messageWithAnimation.clientFirstSeen = Date.now();
          }

          if (!newState.has(conversationPartner)) {
            newState.set(conversationPartner, createEmptyParticipant());
          }

          newState.get(conversationPartner)!.messages.push(messageWithAnimation);
          newState.get(conversationPartner)!.hasNIP17 = true;
          } catch (error) {
            console.error('[DM] Error processing gift wrap from relay:', error);
          }
        }

        newState.forEach(participant => {
          sortAndUpdateParticipantState(participant);
        });

        mergeMessagesIntoState(newState);

        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip17: currentTime }));

        const newestMessage = messages.reduce((newest, msg) =>
          msg.created_at > newest.created_at ? msg : newest
        );
        return { lastMessageTimestamp: newestMessage.created_at, messageCount: messages.length };
      } else {
        // No new messages, but we still successfully queried relays - update lastSync
        const currentTime = Math.floor(Date.now() / 1000);
        setLastSync(prev => ({ ...prev, nip17: currentTime }));
        return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
      }
    }

    return { lastMessageTimestamp: sinceTimestamp, messageCount: 0 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableNIP17, userPubkey, loadPastNIP4Messages, loadPastNIP17Messages, user]);

  // Decrypt NIP-4 message
  const decryptNIP4Message = useCallback(async (event: NostrEvent, otherPubkey: string): Promise<DecryptionResult> => {
    try {
      if (user?.signer?.nip04) {
        const decryptedContent = await user.signer.nip04.decrypt(otherPubkey, event.content);
        return { decryptedContent };
      } else {
        return {
          decryptedContent: '',
          error: 'No NIP-04 decryption available'
        };
      }
    } catch (error) {
      console.error(`[DM] Failed to decrypt NIP-4 message ${event.id}:`, error);
      return {
        decryptedContent: '',
        error: 'Decryption failed'
      };
    }
  }, [user]);

  // Create empty participant
  const createEmptyParticipant = useCallback(() => ({
    messages: [],
    lastActivity: 0,
    lastMessage: null,
    hasNIP4: false,
    hasNIP17: false,
  }), []);

  // Sort and update participant state
  const sortAndUpdateParticipantState = useCallback((participant: { messages: DecryptedMessage[]; lastActivity: number; lastMessage: DecryptedMessage | null }) => {
    participant.messages.sort((a, b) => a.created_at - b.created_at);
    if (participant.messages.length > 0) {
      participant.lastActivity = participant.messages[participant.messages.length - 1].created_at;
      participant.lastMessage = participant.messages[participant.messages.length - 1];
    }
  }, []);

  // Merge messages into state
  const mergeMessagesIntoState = useCallback((newState: MessagesState) => {
    setMessages(prev => {
      const finalMap = new Map(prev);

      newState.forEach((value, key) => {
        const existing = finalMap.get(key);
        if (existing) {
          // For NIP-17 messages with originalGiftWrapId, dedupe by gift wrap ID
          // For NIP-04 and cached NIP-17 messages, dedupe by message ID
          const existingMessageIds = new Set(
            existing.messages.map(msg => msg.originalGiftWrapId || msg.id)
          );
          const newMessages = value.messages.filter(msg =>
            !existingMessageIds.has(msg.originalGiftWrapId || msg.id)
          );

          const mergedMessages = [...existing.messages, ...newMessages];
          mergedMessages.sort((a, b) => a.created_at - b.created_at);

          // Recalculate lastActivity and lastMessage after merging
          const lastMessage = mergedMessages.length > 0 ? mergedMessages[mergedMessages.length - 1] : null;
          const lastActivity = lastMessage ? lastMessage.created_at : existing.lastActivity;

          finalMap.set(key, {
            ...existing,
            messages: mergedMessages,
            lastActivity,
            lastMessage,
            hasNIP4: existing.hasNIP4 || value.hasNIP4,
            hasNIP17: existing.hasNIP17 || value.hasNIP17,
          });
        } else {
          finalMap.set(key, value);
        }
      });

      return finalMap;
    });
  }, []);

  // Add message to state
  const addMessageToState = useCallback((message: DecryptedMessage, conversationPartner: string, protocol: MessageProtocol, userPubkey?: string) => {
    setMessages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(conversationPartner);

      if (existing) {
        // For NIP-17 messages with originalGiftWrapId, dedupe by gift wrap ID
        // For NIP-04 and cached NIP-17 messages, dedupe by message ID
        const messageId = message.originalGiftWrapId || message.id;
        if (existing.messages.some(msg => (msg.originalGiftWrapId || msg.id) === messageId)) {
          console.log('[DM] Skipping duplicate message by ID:', messageId);
          return prev;
        }

        // Try to match with optimistic message
        // For incoming messages from the user themselves, match against optimistic sends
        // Match by content and timestamp, since optimistic messages don't have real IDs
        const optimisticIndex = !message.isSending && message.pubkey === userPubkey
          ? existing.messages.findIndex(msg =>
              msg.isSending &&
              msg.pubkey === message.pubkey &&
              msg.decryptedContent === message.decryptedContent &&
              Math.abs(msg.created_at - message.created_at) <= 60 // Increased to 60s for better matching
            )
          : -1;

        console.log('[DM] Adding message to conversation:', {
          conversationPartner,
          messageId,
          isSending: message.isSending,
          isFromCurrentUser: message.pubkey === userPubkey,
          optimisticIndex,
          pubkey: message.pubkey?.substring(0, 8),
          content: message.decryptedContent?.substring(0, 50),
          timestamp: message.created_at,
          existingCount: existing.messages.length,
          optimisticMessages: existing.messages.filter(m => m.isSending).length,
        });

        let updatedMessages: DecryptedMessage[];
        if (optimisticIndex !== -1) {
          // Replace optimistic message with real one
          console.log('[DM] ✅ Replacing optimistic message at index:', optimisticIndex);
          const existingMessage = existing.messages[optimisticIndex];
          updatedMessages = [...existing.messages];
          updatedMessages[optimisticIndex] = {
            ...message,
            created_at: existingMessage.created_at,
            clientFirstSeen: existingMessage.clientFirstSeen
          };
        } else {
          console.log('[DM] ➕ Adding new message (no optimistic match)');
          updatedMessages = [...existing.messages, message];
        }

        updatedMessages.sort((a, b) => a.created_at - b.created_at);

        const actualLastMessage = updatedMessages[updatedMessages.length - 1];

        newMap.set(conversationPartner, {
          ...existing,
          messages: updatedMessages,
          lastActivity: actualLastMessage.created_at,
          lastMessage: actualLastMessage,
          hasNIP4: protocol === MESSAGE_PROTOCOL.NIP04 ? true : existing.hasNIP4,
          hasNIP17: protocol === MESSAGE_PROTOCOL.NIP17 ? true : existing.hasNIP17,
        });
      } else {
        console.log('[DM] 🆕 Creating new conversation:', conversationPartner);
        const newConversation = {
          messages: [message],
          lastActivity: message.created_at,
          lastMessage: message,
          hasNIP4: protocol === MESSAGE_PROTOCOL.NIP04,
          hasNIP17: protocol === MESSAGE_PROTOCOL.NIP17,
        };

        newMap.set(conversationPartner, newConversation);
      }

      return newMap;
    });
  }, []);

  // Process incoming NIP-4 message
  const processIncomingNIP4Message = useCallback(async (event: NostrEvent) => {
    if (!user?.pubkey) return;

    if (!validateDMEvent(event)) return;

    const isFromUser = event.pubkey === user.pubkey;
    const recipientPTag = event.tags?.find(([name]) => name === 'p')?.[1];
    const otherPubkey = isFromUser ? recipientPTag : event.pubkey;

    if (!otherPubkey) return;

    const { decryptedContent, error } = await decryptNIP4Message(event, otherPubkey);

    const decryptedMessage: DecryptedMessage = {
      ...event,
      content: event.content,
      decryptedContent: decryptedContent,
      error: error,
    };

    const messageAge = Date.now() - (event.created_at * 1000);
    if (messageAge < 5000) {
      decryptedMessage.clientFirstSeen = Date.now();
    }

    // Use consistent conversation ID format (same as NIP-17)
    const conversationId = createConversationId([user.pubkey, otherPubkey]);

    addMessageToState(decryptedMessage, conversationId, MESSAGE_PROTOCOL.NIP04, user.pubkey);
  }, [user, decryptNIP4Message, addMessageToState]);

  // Process NIP-17 Gift Wrap
  const processNIP17GiftWrap = useCallback(async (event: NostrEvent): Promise<NIP17ProcessingResult> => {
    if (!user?.signer?.nip44) {
      return {
        processedMessage: {
          ...event,
          content: '',
          decryptedContent: '',
          error: 'No NIP-44 decryption available',
        },
        conversationPartner: event.pubkey,
        sealEvent: event, // Return the event itself as fallback
      };
    }

    try {
      // Decrypt using the ephemeral sender's pubkey (event.pubkey)
      const sealContent = await user.signer.nip44.decrypt(event.pubkey, event.content);
      const sealEvent = JSON.parse(sealContent) as NostrEvent;

      if (sealEvent.kind !== 13) {
        console.log(`[DM] ⚠️ NIP-17 INVALID SEAL - expected kind 13, got ${sealEvent.kind}`, {
          giftWrapId: event.id,
          sealKind: sealEvent.kind,
        });
        return {
          processedMessage: {
            ...event,
            content: '',
            decryptedContent: '',
            error: `Invalid Seal format - expected kind 13, got ${sealEvent.kind}`,
          },
          conversationPartner: event.pubkey,
          sealEvent: event, // Return the gift wrap as fallback
        };
      }

      const messageContent = await user.signer.nip44.decrypt(sealEvent.pubkey, sealEvent.content);
      const messageEvent = JSON.parse(messageContent) as NostrEvent;

      // Accept both kind 14 (text) and kind 15 (files/attachments)
      if (messageEvent.kind !== 14 && messageEvent.kind !== 15) {
        console.log(`[DM] ⚠️ NIP-17 MESSAGE WITH UNSUPPORTED INNER EVENT KIND:`, {
          giftWrapId: event.id,
          innerKind: messageEvent.kind,
          expectedKinds: [14, 15],
          sealPubkey: sealEvent.pubkey,
          messageEvent: messageEvent,
        });
        return {
          processedMessage: {
            ...event,
            content: '',
            decryptedContent: '',
            error: `Invalid message format - expected kind 14 or 15, got ${messageEvent.kind}`,
          },
          conversationPartner: event.pubkey,
          sealEvent, // Return the seal
        };
      }

      // Determine conversation ID based on ALL participants (sender + recipients)
      // Get all p tags (recipients)
      const allRecipients = messageEvent.tags
        .filter(([name]) => name === 'p')
        .map(([, pubkey]) => pubkey);

      if (allRecipients.length === 0) {
        return {
          processedMessage: {
            ...event,
            content: '',
            decryptedContent: '',
            error: 'Invalid message - no recipients',
          },
          conversationPartner: event.pubkey,
          sealEvent,
        };
      }

      // Get the sender from the seal (the person who actually sent the message)
      const sender = sealEvent.pubkey;

      // Create conversation ID from all participants (sender + recipients)
      const allParticipants = [sender, ...allRecipients];
      const conversationPartner = createConversationId(allParticipants);

      return {
        processedMessage: {
          ...messageEvent,
          id: messageEvent.id || `missing-nip17-inner-${messageEvent.created_at}-${messageEvent.pubkey.substring(0, 8)}-${messageEvent.content.substring(0, 16)}`,
          decryptedContent: messageEvent.content, // Plaintext from inner message
        },
        conversationPartner,
        sealEvent, // Return the seal (kind 13) for storage
      };
    } catch (error) {
      console.error('[DM] Failed to process NIP-17 gift wrap:', {
        giftWrapId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      nip17ErrorLogger(error as Error);
      return {
        processedMessage: {
          ...event,
          content: '',
          decryptedContent: '',
          error: error instanceof Error ? error.message : 'Failed to decrypt or parse NIP-17 message',
        },
        conversationPartner: event.pubkey,
        sealEvent: event, // Return the gift wrap as fallback
      };
    }
  }, [user]);

  // Process incoming NIP-17 message
  const processIncomingNIP17Message = useCallback(async (event: NostrEvent) => {
    if (!user?.pubkey) return;

    if (event.kind !== 1059) return;

    try {
      const { processedMessage, conversationPartner, sealEvent } = await processNIP17GiftWrap(event);

      console.log('[DM] Processing incoming NIP-17 message:', {
        giftWrapId: event.id,
        conversationPartner,
        sealPubkey: sealEvent.pubkey,
        userPubkey: user.pubkey,
        isFromUser: sealEvent.pubkey === user.pubkey,
        content: processedMessage.decryptedContent?.substring(0, 50),
      });

      // Check if decryption failed
      if (processedMessage.error) {
        console.error('[DM] NIP-17 message decryption failed:', {
          giftWrapId: event.id,
          error: processedMessage.error,
        });
        nip17ErrorLogger(new Error(processedMessage.error));
        return;
      }

      // Store the seal (kind 13) as-is + add decryptedEvent for inner message access + gift wrap for debugging
      const messageWithAnimation: DecryptedMessage = {
        ...sealEvent, // Seal fields (kind 13, seal pubkey, encrypted content, etc.)
        created_at: processedMessage.created_at, // Use real timestamp from inner message
        decryptedEvent: {
          ...processedMessage,
          content: processedMessage.decryptedContent,
        } as NostrEvent,
        decryptedContent: processedMessage.decryptedContent,
        originalGiftWrapId: event.id, // Store gift wrap ID for deduplication
        originalGiftWrap: event, // Store full gift wrap for debugging
      };

      // Use real message timestamp for recency check
      const messageAge = Date.now() - (processedMessage.created_at * 1000);
      if (messageAge < 5000) {
        messageWithAnimation.clientFirstSeen = Date.now();
      }

      addMessageToState(messageWithAnimation, conversationPartner, MESSAGE_PROTOCOL.NIP17, user.pubkey);
    } catch (error) {
      console.error('[DM] Exception in processIncomingNIP17Message:', {
        giftWrapId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      nip17ErrorLogger(error as Error);
    }
  }, [user, processNIP17GiftWrap, addMessageToState]);

  // Start NIP-4 subscription
  const startNIP4Subscription = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey || !nostr) return;

    if (nip4SubscriptionRef.current) {
      nip4SubscriptionRef.current.close();
    }

    try {
      let subscriptionSince = sinceTimestamp || Math.floor(Date.now() / 1000);
      if (!sinceTimestamp && lastSync.nip4) {
        subscriptionSince = lastSync.nip4 - DM_CONSTANTS.SUBSCRIPTION_OVERLAP_SECONDS;
      }

      const filters = [
        { kinds: [4], '#p': [user.pubkey], since: subscriptionSince },
        { kinds: [4], authors: [user.pubkey], since: subscriptionSince }
      ];

      // Subscribe to user's inbox relays (read relays)
      const relayGroup = nostr.group(userInboxRelays);
      const subscription = relayGroup.req(filters);
      let isActive = true;

      (async () => {
        try {
          for await (const msg of subscription) {
            if (!isActive) break;
            if (msg[0] === 'EVENT') {
              await processIncomingNIP4Message(msg[2]);
            }
          }
        } catch (error) {
          if (isActive) {
            console.error('[DM] NIP-4 subscription error:', error);
          }
        }
      })();

      nip4SubscriptionRef.current = {
        close: () => {
          isActive = false;
        }
      };

      setSubscriptions(prev => ({ ...prev, isNIP4Connected: true }));
    } catch (error) {
      console.error('[DM] Failed to start NIP-4 subscription:', error);
      setSubscriptions(prev => ({ ...prev, isNIP4Connected: false }));
    }
  }, [user, nostr, lastSync.nip4, processIncomingNIP4Message, userInboxRelays]);

  // Start NIP-17 subscription
  const startNIP17Subscription = useCallback(async (sinceTimestamp?: number) => {
    if (!user?.pubkey || !nostr || !enableNIP17) return;

    if (nip17SubscriptionRef.current) {
      nip17SubscriptionRef.current.close();
    }

    try {
      let subscriptionSince = sinceTimestamp || Math.floor(Date.now() / 1000);
      if (!sinceTimestamp && lastSync.nip17) {
        subscriptionSince = lastSync.nip17 - DM_CONSTANTS.SUBSCRIPTION_OVERLAP_SECONDS;
      }

      // Adjust for NIP-17 timestamp fuzzing (±2 days)
      // Subscribe from (lastSync - 2 days) to catch messages with randomized past timestamps
      const TWO_DAYS_IN_SECONDS = 2 * 24 * 60 * 60;
      subscriptionSince = subscriptionSince - TWO_DAYS_IN_SECONDS;

      const filters = [{
        kinds: [1059],
        '#p': [user.pubkey],
        since: subscriptionSince,
      }];

      // Subscribe to user's inbox relays (read relays)
      const relayGroup = nostr.group(userInboxRelays);
      const subscription = relayGroup.req(filters);
      let isActive = true;

      (async () => {
        try {
          for await (const msg of subscription) {
            if (!isActive) break;
            if (msg[0] === 'EVENT') {
              await processIncomingNIP17Message(msg[2]);
            }
          }
        } catch (error) {
          if (isActive) {
            console.error('[DM] NIP-17 subscription error:', error);
          }
        }
      })();

      nip17SubscriptionRef.current = {
        close: () => {
          isActive = false;
        }
      };

      setSubscriptions(prev => ({ ...prev, isNIP17Connected: true }));
    } catch (error) {
      console.error('[DM] Failed to start NIP-17 subscription:', error);
      setSubscriptions(prev => ({ ...prev, isNIP17Connected: false }));
    }
  }, [user, nostr, lastSync.nip17, enableNIP17, processIncomingNIP17Message, userInboxRelays]);

  // Load all cached messages at once (both protocols)
  const loadAllCachedMessages = useCallback(async (): Promise<{ nip4Since?: number; nip17Since?: number }> => {
    if (!userPubkey) return {};

    try {
      const { readMessagesFromDB } = await import('@/lib/dmMessageStore');

      const cachedStore = await readMessagesFromDB(userPubkey);

      if (!cachedStore || Object.keys(cachedStore.participants).length === 0) {
        return {};
      }

      const filteredParticipants = enableNIP17
        ? cachedStore.participants
        : Object.fromEntries(
          Object.entries(cachedStore.participants).filter(([_, participant]) => !participant.hasNIP17)
        );

      const newState = new Map();

      // Decrypt each message individually (they're stored in original encrypted form)
      for (const [participantPubkey, participant] of Object.entries(filteredParticipants)) {
        const processedMessages = await Promise.all(participant.messages.map(async (msg) => {
          // Decrypt based on message kind
          let decryptedContent: string | undefined;
          let error: string | undefined;

          if (msg.kind === 4) {
            // NIP-04 message
            const otherPubkey = msg.pubkey === user?.pubkey
              ? msg.tags.find(([name]) => name === 'p')?.[1]
              : msg.pubkey;

            if (otherPubkey && user?.signer?.nip04) {
              try {
                decryptedContent = await user.signer.nip04.decrypt(otherPubkey, msg.content);
              } catch {
                error = 'Decryption failed';
              }
            }
          } else if (msg.kind === 13) {
            // NIP-17 seal - decrypt to get the inner kind 14/15 event
            if (user?.signer?.nip44) {
              try {
                const sealContent = await user.signer.nip44.decrypt(msg.pubkey, msg.content);
                const decryptedEvent = JSON.parse(sealContent) as NostrEvent;

                // Keep seal structure but add decryptedEvent for access to inner fields
                // Also preserve originalGiftWrap if it was stored
                const msgWithExtra = msg as NostrEvent & { originalGiftWrap?: NostrEvent };
                return {
                  ...msg,
                  decryptedEvent,                         // Full inner event (kind 14/15)
                  decryptedContent: decryptedEvent.content, // Plaintext message
                  ...(msgWithExtra.originalGiftWrap && { originalGiftWrap: msgWithExtra.originalGiftWrap }),
                } as NostrEvent & { decryptedEvent?: NostrEvent; decryptedContent?: string; error?: string; originalGiftWrap?: NostrEvent };
              } catch {
                error = 'Decryption failed';
              }
            }
          }

          return {
            ...msg,
            id: msg.id || `missing-${msg.kind}-${msg.created_at}-${msg.pubkey.substring(0, 8)}-${msg.content?.substring(0, 16) || 'nocontent'}`,
            decryptedContent,
            error,
          } as NostrEvent & { decryptedContent?: string; error?: string };
        }));

        newState.set(participantPubkey, {
          messages: processedMessages,
          lastActivity: participant.lastActivity,
          lastMessage: processedMessages.length > 0 ? processedMessages[processedMessages.length - 1] : null,
          hasNIP4: participant.hasNIP4,
          hasNIP17: participant.hasNIP17,
        });
      }

      setMessages(newState);
      if (cachedStore.lastSync) {
        setLastSync(cachedStore.lastSync);
      }

      return {
        nip4Since: cachedStore.lastSync?.nip4 || undefined,
        nip17Since: cachedStore.lastSync?.nip17 || undefined,
      };
    } catch (error) {
      console.error('[DM] Error loading cached messages:', error);
      return {};
    }
  }, [userPubkey, enableNIP17, user]);

  // Start message loading
  const startMessageLoading = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setLoadingPhase(LOADING_PHASES.CACHE);

    try {
      // ===== PHASE 1: Load cache and show immediately =====
      const { nip4Since, nip17Since } = await loadAllCachedMessages();

      // Mark as completed BEFORE releasing isLoading to prevent re-trigger
      setHasInitialLoadCompleted(true);

      // Show cached messages immediately! Don't wait for relays
      setLoadingPhase(LOADING_PHASES.READY);
      setIsLoading(false);

      // ===== PHASE 2: Query relays in background (non-blocking, parallel) =====
      setLoadingPhase(LOADING_PHASES.RELAYS);

      // Run NIP-04 and NIP-17 queries IN PARALLEL
      const [nip4Result, nip17Result] = await Promise.all([
        queryRelaysForMessagesSince(MESSAGE_PROTOCOL.NIP04, nip4Since),
        enableNIP17 ? queryRelaysForMessagesSince(MESSAGE_PROTOCOL.NIP17, nip17Since) : Promise.resolve({ lastMessageTimestamp: undefined, messageCount: 0 })
      ]);

      const totalNewMessages = nip4Result.messageCount + (nip17Result?.messageCount || 0);
      if (totalNewMessages > 0) {
        setShouldSaveImmediately(true);
      }

      // ===== PHASE 3: Setup subscriptions =====
      setLoadingPhase(LOADING_PHASES.SUBSCRIPTIONS);

      await Promise.all([
        startNIP4Subscription(nip4Result.lastMessageTimestamp),
        enableNIP17 ? startNIP17Subscription(nip17Result?.lastMessageTimestamp) : Promise.resolve()
      ]);

      setLoadingPhase(LOADING_PHASES.READY);
    } catch (error) {
      console.error('[DM] Error in message loading:', error);
      setHasInitialLoadCompleted(true);
      setLoadingPhase(LOADING_PHASES.READY);
      setIsLoading(false);
    }
  }, [loadAllCachedMessages, queryRelaysForMessagesSince, startNIP4Subscription, startNIP17Subscription, enableNIP17, isLoading]);

  // Clear cache and refetch from relays
  const clearCacheAndRefetch = useCallback(async () => {
    if (!enabled || !userPubkey) return;

    try {
      // Close existing subscriptions
      if (nip4SubscriptionRef.current) {
        nip4SubscriptionRef.current.close();
        nip4SubscriptionRef.current = null;
      }
      if (nip17SubscriptionRef.current) {
        nip17SubscriptionRef.current.close();
        nip17SubscriptionRef.current = null;
      }

      // Clear IndexedDB cache
      const { deleteMessagesFromDB } = await import('@/lib/dmMessageStore');
      await deleteMessagesFromDB(userPubkey);

      // Reset all state
      setMessages(new Map());
      setLastSync({ nip4: null, nip17: null });
      setSubscriptions({ isNIP4Connected: false, isNIP17Connected: false });
      setScanProgress({ nip4: null, nip17: null });
      setLoadingPhase(LOADING_PHASES.IDLE);

      // Trigger reload by setting hasInitialLoadCompleted to false
      setHasInitialLoadCompleted(false);
    } catch (error) {
      console.error('[DM] Error clearing cache:', error);
      throw error;
    }
  }, [enabled, userPubkey]);

  // Main effect to load messages
  useEffect(() => {
    if (!enabled || !userPubkey || hasInitialLoadCompleted || isLoading) return;
    startMessageLoading();
  }, [enabled, userPubkey, hasInitialLoadCompleted, isLoading, startMessageLoading]);

  // Cleanup effect
  useEffect(() => {
    if (!enabled) return;

    return () => {
      if (nip4SubscriptionRef.current) {
        nip4SubscriptionRef.current.close();
        nip4SubscriptionRef.current = null;
      }
      if (nip17SubscriptionRef.current) {
        nip17SubscriptionRef.current.close();
        nip17SubscriptionRef.current = null;
      }
    };
  }, [enabled, userPubkey]);

  // Cleanup subscriptions
  useEffect(() => {
    if (!enabled) return;

    return () => {
      if (nip4SubscriptionRef.current) {
        nip4SubscriptionRef.current.close();
      }
      if (nip17SubscriptionRef.current) {
        nip17SubscriptionRef.current.close();
      }
      if (debouncedWriteRef.current) {
        clearTimeout(debouncedWriteRef.current);
      }
      setSubscriptions({ isNIP4Connected: false, isNIP17Connected: false });
    };
  }, [enabled]);

  // Detect NIP-65 changes and reload messages (track by event ID)
  useEffect(() => {
    const currentDMEventId = relayLists?.dmInbox?.eventId;
    const currentNIP65EventId = relayLists?.nip65?.eventId;
    
    const dmRelaysChanged = previousDMEventId.current !== undefined && previousDMEventId.current !== currentDMEventId;
    const nip65RelaysChanged = previousNIP65EventId.current !== undefined && previousNIP65EventId.current !== currentNIP65EventId;
    
    previousDMEventId.current = currentDMEventId;
    previousNIP65EventId.current = currentNIP65EventId;

    if ((dmRelaysChanged || nip65RelaysChanged) && enabled && userPubkey && hasInitialLoadCompleted) {
      console.log('[DM] Relay list changed (new event ID), clearing cache and refetching');
      clearCacheAndRefetch();
    }
  }, [enabled, userPubkey, relayLists?.dmInbox?.eventId, relayLists?.nip65?.eventId, hasInitialLoadCompleted, clearCacheAndRefetch]);

  // Detect hard refresh shortcut (Ctrl+Shift+R / Cmd+Shift+R) to clear cache
  useEffect(() => {
    if (!enabled || !userPubkey) return;

    const handleHardRefresh = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        try {
          sessionStorage.setItem('dm-clear-cache-on-load', 'true');
        } catch (error) {
          console.warn('[DM] SessionStorage unavailable, cache won\'t clear on hard refresh:', error);
        }
      }
    };

    window.addEventListener('keydown', handleHardRefresh);
    return () => window.removeEventListener('keydown', handleHardRefresh);
  }, [enabled, userPubkey]);

  // Clear cache after hard refresh
  useEffect(() => {
    if (!enabled || !userPubkey) return;

    try {
      const shouldClearCache = sessionStorage.getItem('dm-clear-cache-on-load');
      if (shouldClearCache) {
        sessionStorage.removeItem('dm-clear-cache-on-load');
        clearCacheAndRefetch();
      }
    } catch (error) {
      console.warn('[DM] Could not check sessionStorage for cache clear flag:', error);
    }
  }, [enabled, userPubkey, clearCacheAndRefetch]);

  // Conversations summary
  const conversations = useMemo(() => {
    const conversationsList: ConversationSummary[] = [];

    messages.forEach((participant, participantPubkey) => {
      if (!participant.messages.length) return;

      const userHasSentMessage = participant.messages.some(msg => msg.pubkey === user?.pubkey);
      const isKnown = userHasSentMessage;
      const isRequest = !userHasSentMessage;

      const lastMessage = participant.messages[participant.messages.length - 1];
      const isFromUser = lastMessage.pubkey === user?.pubkey;

      conversationsList.push({
        id: participantPubkey,
        pubkey: participantPubkey,
        lastMessage: participant.lastMessage,
        lastActivity: participant.lastActivity,
        hasNIP4Messages: participant.hasNIP4,
        hasNIP17Messages: participant.hasNIP17,
        isKnown: isKnown,
        isRequest: isRequest,
        lastMessageFromUser: isFromUser,
      });
    });

    return conversationsList.sort((a, b) => b.lastActivity - a.lastActivity);
  }, [messages, user?.pubkey]);

  // Pre-fetch relay lists for all conversation participants
  // This populates React Query cache so sending messages has no delay
  useEffect(() => {
    if (!enabled || conversations.length === 0) return;

    const fetchRelayLists = async () => {
      // Extract unique participant pubkeys from all conversations
      const pubkeys: string[] = [];
      conversations.forEach(conv => {
        const participants = parseConversationId(conv.id);
        pubkeys.push(...participants);
      });
      const uniquePubkeys = Array.from(new Set(pubkeys));

      if (uniquePubkeys.length === 0) return;

      // Bulk fetch all relay lists in ONE query (much more efficient)
      const relayLists = await fetchRelayListsBulk(nostr, appConfig.discoveryRelays, uniquePubkeys);

      // Cache each result in React Query
      relayLists.forEach((relays, pubkey) => {
        queryClient.setQueryData(['nostr', 'relay-list', pubkey], relays);
      });

      console.debug(`[DM] Pre-fetched ${relayLists.size}/${uniquePubkeys.length} relay lists`);
    };

    fetchRelayLists();
  }, [enabled, conversations, nostr, appConfig.discoveryRelays, queryClient]);

  // Write to store
  const writeAllMessagesToStore = useCallback(async () => {
    if (!userPubkey) return;

    try {
      const { writeMessagesToDB } = await import('@/lib/dmMessageStore');

      const messageStore = {
        participants: {} as Record<string, {
          messages: NostrEvent[];
          lastActivity: number;
          hasNIP4: boolean;
          hasNIP17: boolean;
        }>,
        lastSync: {
          nip4: lastSync.nip4,
          nip17: lastSync.nip17,
        }
      };

      messages.forEach((participant, participantPubkey) => {
        messageStore.participants[participantPubkey] = {
          messages: participant.messages.map(msg => ({
            // Store messages in their ORIGINAL ENCRYPTED form
            // Just strip the decrypted fields (decryptedContent, decryptedEvent)
            // Keep originalGiftWrapId and originalGiftWrap for NIP-17 debugging
            id: msg.id,
            pubkey: msg.pubkey,
            content: msg.content, // Encrypted content (NIP-04 or seal)
            created_at: msg.created_at,
            kind: msg.kind,       // 4 for NIP-04, 13 for NIP-17
            tags: msg.tags,
            sig: msg.sig,
            ...(msg.originalGiftWrapId && { originalGiftWrapId: msg.originalGiftWrapId }),
            ...(msg.originalGiftWrap && { originalGiftWrap: msg.originalGiftWrap }),
          } as NostrEvent)),
          lastActivity: participant.lastActivity,
          hasNIP4: participant.hasNIP4,
          hasNIP17: participant.hasNIP17,
        };
      });

      await writeMessagesToDB(userPubkey, messageStore);

      const currentTime = Math.floor(Date.now() / 1000);
      setLastSync(prev => ({
        nip4: prev.nip4 || currentTime,
        nip17: prev.nip17 || currentTime
      }));
    } catch (error) {
      console.error('[DM] Error writing messages to IndexedDB:', error);
    }
  }, [messages, userPubkey, lastSync]);

  // Trigger debounced write
  const triggerDebouncedWrite = useCallback(() => {
    if (debouncedWriteRef.current) {
      clearTimeout(debouncedWriteRef.current);
    }
    debouncedWriteRef.current = setTimeout(() => {
      writeAllMessagesToStore();
      debouncedWriteRef.current = null;
    }, DM_CONSTANTS.DEBOUNCED_WRITE_DELAY);
  }, [writeAllMessagesToStore]);

  // Watch messages and save
  useEffect(() => {
    if (!enabled || messages.size === 0) return;

    if (shouldSaveImmediately) {
      setShouldSaveImmediately(false);
      writeAllMessagesToStore();
    } else {
      triggerDebouncedWrite();
    }
  }, [enabled, messages, shouldSaveImmediately, writeAllMessagesToStore, triggerDebouncedWrite]);

  // Send message
  const sendMessage = useCallback(async (params: {
    recipientPubkey: string | string[];
    content: string;
    protocol?: MessageProtocol;
    attachments?: FileAttachment[];
  }) => {
    if (!enabled) return;

    const { recipientPubkey, content, protocol = MESSAGE_PROTOCOL.NIP04, attachments } = params;
    if (!userPubkey) return;

    // Parse recipients and create conversation ID
    let recipients: string[];

    if (typeof recipientPubkey === 'string' && recipientPubkey.startsWith('group:')) {
      // Extract pubkeys from group ID (which includes sender)
      const allParticipants = parseConversationId(recipientPubkey);
      // Recipients are everyone except the sender
      recipients = allParticipants.filter(p => p !== userPubkey);
      
      // For self-messaging, ensure we include ourselves as the recipient
      if (recipients.length === 0 && allParticipants.length === 1) {
        recipients = [userPubkey];
      }
    } else if (Array.isArray(recipientPubkey)) {
      recipients = recipientPubkey;
    } else {
      recipients = [recipientPubkey];
    }

    // Create conversation ID from all participants (including current user)
    const conversationId = createConversationId([userPubkey, ...recipients]);

    console.log('[DM] Sending message:', {
      recipients,
      conversationId,
      protocol,
      isGroup: recipients.length > 1,
    });

    const optimisticId = `optimistic-${Date.now()}-${Math.random()}`;
    const optimisticMessage: DecryptedMessage = {
      id: optimisticId,
      kind: protocol === MESSAGE_PROTOCOL.NIP04 ? 4 : 14,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: recipients.map(p => ['p', p]),
      content: '',
      decryptedContent: content,
      sig: '',
      isSending: true,
      clientFirstSeen: Date.now(),
    };

    addMessageToState(optimisticMessage, conversationId, protocol === MESSAGE_PROTOCOL.NIP04 ? MESSAGE_PROTOCOL.NIP04 : MESSAGE_PROTOCOL.NIP17, userPubkey);

    try {
      if (protocol === MESSAGE_PROTOCOL.NIP04) {
        // NIP-04 doesn't support group chats, only send to first recipient
        await sendNIP4Message.mutateAsync({ recipientPubkey: recipients[0], content, attachments });
      } else if (protocol === MESSAGE_PROTOCOL.NIP17) {
        // NIP-17 supports group chats natively
        await sendNIP17Message.mutateAsync({ recipientPubkey: recipients, content, attachments });
      }
    } catch (error) {
      console.error(`[DM] Failed to send ${protocol} message:`, error);
    }
  }, [enabled, userPubkey, addMessageToState, sendNIP4Message, sendNIP17Message]);

  const isDoingInitialLoad = isLoading && (loadingPhase === LOADING_PHASES.CACHE || loadingPhase === LOADING_PHASES.RELAYS);

  const contextValue: DMContextType = {
    messages,
    isLoading,
    loadingPhase,
    isDoingInitialLoad,
    lastSync,
    conversations,
    sendMessage,
    protocolMode,
    scanProgress,
    subscriptions,
    clearCacheAndRefetch,
    relayError,
    clearRelayError,
  };

  return (
    <DMContext.Provider value={contextValue}>
      {children}
    </DMContext.Provider>
  );
}

