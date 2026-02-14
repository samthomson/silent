import { useMemo, useState, memo, useEffect, useRef } from 'react';
import { Info, Loader2, AlertCircle, Radio, Search, X } from 'lucide-react';
import { useNewDMContext } from '@/contexts/NewDMContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useDebounce } from '@/hooks/useDebounce';
import { getDisplayName } from '@/lib/genUserName';
import { formatConversationTime, formatFullDateTime } from '@/lib/dmUtils';
import { GroupAvatar } from '@/components/dm/GroupAvatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { NewConversationDialog } from '@/components/NewConversationDialog';
import { SearchResults } from '@/components/dm/SearchResults';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants';
import { ShortsStrip } from '@/components/shorts/ShortsStrip';

interface DMConversationListProps {
  selectedPubkey: string | null;
  onSelectConversation: (conversationId: string, messageId?: string) => void;
  className?: string;
  onStatusClick?: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  onSearchFocus?: () => void;
  filterConversationId?: string | null;
  onClearFilter?: () => void;
}

interface ConversationItemProps {
  conversationId: string;
  participantPubkeys: string[];
  isSelected: boolean;
  onClick: () => void;
  lastMessage: { decryptedContent?: string; error?: string; hasAttachments?: boolean } | null;
  lastActivity: number;
  hasDecryptionErrors?: boolean;
  hasFailedRelays?: boolean;
  unreadCount: number;
}

// Truncated version for chip display
const ConversationNameTruncated = ({ pubkey, maxLength }: { pubkey: string; maxLength: number }) => {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = getDisplayName(pubkey, metadata);
  const truncated = name.length > maxLength ? `${name.slice(0, maxLength)}...` : name;
  return <>{truncated}</>;
};

const ConversationItemComponent = ({
  conversationId: _conversationId,
  participantPubkeys,
  isSelected,
  onClick,
  lastMessage,
  lastActivity,
  hasDecryptionErrors,
  hasFailedRelays,
  unreadCount,
}: ConversationItemProps) => {
  const { user } = useCurrentUser();
  
  // Exclude current user from display
  const conversationParticipants = participantPubkeys.filter(pk => pk !== user?.pubkey);

  // Check if this is a self-messaging conversation
  const isSelfMessaging = conversationParticipants.length === 0;
  
  // Check if this is a group chat (3+ participants including current user)
  const isGroupChat = participantPubkeys.length >= 3;

  // Fetch profile data for participants (used in display name logic)
  const displayPubkey = isSelfMessaging ? user?.pubkey : conversationParticipants[0];
  const firstParticipant = useAuthor(displayPubkey || '');
  const secondParticipant = useAuthor(conversationParticipants[1] || '');
  
  const firstMetadata = firstParticipant.data?.metadata;

  const conversationDisplayName = (() => {
    // Self-messaging conversation
    if (isSelfMessaging) {
      const selfName = getDisplayName(user?.pubkey || '', firstMetadata);
      return `${selfName} (You)`;
    }

    // If only one other person, show their name (1-on-1)
    if (conversationParticipants.length === 1) {
      return getDisplayName(conversationParticipants[0], firstMetadata);
    }

    // Multiple people - show first 2 names + remaining count
    const firstName = getDisplayName(conversationParticipants[0], firstMetadata);
    const secondName = getDisplayName(conversationParticipants[1], secondParticipant.data?.metadata);

    if (conversationParticipants.length === 2) {
      return `${firstName}, ${secondName}`;
    } else {
      const remaining = conversationParticipants.length - 2;
      return `${firstName}, ${secondName}, +${remaining}`;
    }
  })();

  const lastMessagePreview = (() => {
    if (!lastMessage) return 'No messages yet';
    if (lastMessage.error) return <span className="italic">Message could not be read</span>;
    
    // If there's text content, show it
    if (lastMessage.decryptedContent) return lastMessage.decryptedContent;
    
    // If no text but has attachments, show file indicator
    if (lastMessage.hasAttachments) {
      return (
        <span className="flex items-center gap-1.5">
          <span>📎</span>
          <span>Attachment</span>
        </span>
      );
    }
    
    // Fallback for empty messages
    return 'No messages yet';
  })();

  // Show skeleton only for name/avatar while loading (we already have message data)
  const isLoadingProfile = !isSelfMessaging && conversationParticipants.length === 1 && firstParticipant.isLoading && !firstMetadata;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-colors hover:bg-accent block overflow-hidden",
        isSelected && "bg-accent"
      )}
    >
      <div className="flex items-start gap-3 max-w-full">
        {isLoadingProfile ? (
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
        ) : (
          <GroupAvatar pubkeys={isSelfMessaging ? [user!.pubkey] : isGroupChat ? participantPubkeys : conversationParticipants} isSelected={isSelected} />
        )}

        <div className="flex-1 min-w-0">
          {/* Line 1: Name and timestamp */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {isLoadingProfile ? (
                <Skeleton className="h-[1.125rem] w-24" />
              ) : (
                <span className={cn(
                  "text-sm truncate",
                  unreadCount > 0 ? "font-semibold" : "font-medium"
                )}>{conversationDisplayName}</span>
              )}
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 cursor-default">
                    {formatConversationTime(lastActivity)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p className="text-xs">{formatFullDateTime(lastActivity)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Line 2: Message preview and unread count + indicators */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground truncate flex-1">
              {lastMessagePreview}
            </p>
            
            {/* Right side: other indicators then unread count (most important) */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {hasFailedRelays && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Radio className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p className="text-xs">Some relays failed to connect</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {hasDecryptionErrors && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p className="text-xs">Some messages failed to decrypt</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {unreadCount > 0 && (
                <div className="bg-primary text-primary-foreground text-xs font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-lg">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
};

const ConversationItem = memo(ConversationItemComponent);
ConversationItem.displayName = 'ConversationItem';

const ConversationListSkeleton = () => {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
};

export const NewDMConversationList = ({
  selectedPubkey,
  onSelectConversation,
  className,
  onStatusClick,
  searchInputRef,
  onSearchFocus,
  filterConversationId,
  onClearFilter
}: DMConversationListProps) => {
  const { messagingState, isLoading, phase, getConversationRelays, unreadActive, unreadRequests } = useNewDMContext();
  const { user } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<'known' | 'requests'>('known');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const prevWasRequestRef = useRef<Set<string>>(new Set());
  const internalSearchInputRef = useRef<HTMLInputElement>(null);
  
  // Use external ref if provided, otherwise use internal ref
  const effectiveSearchInputRef = searchInputRef || internalSearchInputRef;
  
  const isSearching = debouncedSearchQuery.trim().length > 0 || !!filterConversationId;

  // Get filter conversation name for chip display
  const filterConversation = filterConversationId ? messagingState?.conversationMetadata[filterConversationId] : null;
  const filterConversationParticipants = filterConversationId 
    ? filterConversation?.participantPubkeys.filter(pk => pk !== user?.pubkey) || []
    : [];

  const conversations = useMemo(() => {
    if (!messagingState?.conversationMetadata) return [];
    
    // Convert to array and sort by lastActivity (most recent first)
    return Object.values(messagingState.conversationMetadata)
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }, [messagingState?.conversationMetadata]);

  // Compute failed relays for each conversation
  const conversationsWithRelayStatus = useMemo(() => {
    if (!user?.pubkey || !messagingState) return conversations;

    return conversations.map(conv => {
      const relayInfo = getConversationRelays(conv.id);
      const hasFailedRelays = relayInfo.some(({ relay }) => {
        const info = messagingState.relayInfo[relay];
        return info && !info.lastQuerySucceeded;
      });

      return { ...conv, hasFailedRelays };
    });
  }, [conversations, user?.pubkey, messagingState, getConversationRelays]);

  // Filter conversations by type
  const { knownConversations, requestConversations } = useMemo(() => {
    return {
      knownConversations: conversationsWithRelayStatus.filter(c => c.isKnown),
      requestConversations: conversationsWithRelayStatus.filter(c => c.isRequest),
    };
  }, [conversationsWithRelayStatus]);

  // Auto-switch to "known" tab when a request conversation becomes known
  useEffect(() => {
    if (!selectedPubkey) return;
    
    const selectedConversation = conversationsWithRelayStatus.find(c => c.id === selectedPubkey);
    if (!selectedConversation) return;
    
    // If this was a request but is now known, switch to known tab
    if (selectedConversation.isKnown && prevWasRequestRef.current.has(selectedPubkey)) {
      setActiveTab('known');
      prevWasRequestRef.current.delete(selectedPubkey);
    } else if (selectedConversation.isRequest) {
      prevWasRequestRef.current.add(selectedPubkey);
    }
  }, [selectedPubkey, conversationsWithRelayStatus]);

  // Get the current list based on active tab
  const currentConversations = activeTab === 'known' ? knownConversations : requestConversations;

  // Show skeleton only during initial load when we have no data yet (not during sync)
  const isInitialLoad = isLoading && conversationsWithRelayStatus.length === 0 && !phase;

  return (
    <div className={cn("h-full flex flex-col overflow-hidden border-r border-border bg-card", className)}>
      {/* Header - always visible */}
      <div className="px-4 border-b flex-shrink-0 h-[80px] flex items-center">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex flex-col justify-center">
              <h1 className="text-xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent leading-none">
                {APP_NAME}
              </h1>
              <p className="text-xs text-muted-foreground leading-tight mt-1">{APP_DESCRIPTION}</p>
            </div>
            {/* TODO: Re-implement with new loading phases when cold/warm start flow is finalized */}
            {/* Old code:
            {(loadingPhase === LOADING_PHASES.CACHE ||
              loadingPhase === LOADING_PHASES.RELAYS ||
              loadingPhase === LOADING_PHASES.SUBSCRIPTIONS) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center pt-1">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {loadingPhase === LOADING_PHASES.CACHE && 'Loading from cache...'}
                      {loadingPhase === LOADING_PHASES.RELAYS && 'Querying relays for new messages...'}
                      {loadingPhase === LOADING_PHASES.SUBSCRIPTIONS && 'Setting up subscriptions...'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            */}
            {isLoading && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/40">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground/80 font-medium leading-none">
                  Syncing...
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <NewConversationDialog onStartConversation={onSelectConversation} />
            {onStatusClick && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onStatusClick}
                aria-label="View messaging status"
              >
                <Info className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Shorts strip */}
      <ShortsStrip />

      {/* Search input */}
      <div className="py-3 border-b flex-shrink-0">
        <div className="px-4">
          <div className="relative flex items-center gap-2 bg-muted/50 rounded-sm px-3 py-2 focus-within:bg-muted">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            
            {/* Filter chip */}
            {filterConversationId && filterConversationParticipants.length > 0 && (
              <div className="flex items-center gap-1 bg-primary text-primary-foreground px-2 py-0.5 rounded-full text-xs flex-shrink-0">
                <GroupAvatar pubkeys={filterConversationParticipants} size="xs" />
                <span className="font-medium truncate" style={{ maxWidth: '60px' }}>
                  {filterConversationParticipants.length === 1 ? (
                    <ConversationNameTruncated pubkey={filterConversationParticipants[0]} maxLength={8} />
                  ) : (
                    `${filterConversationParticipants.length} people`
                  )}
                </span>
                <button
                  onClick={onClearFilter}
                  className="hover:bg-primary-foreground/20 rounded-full p-0.5"
                  aria-label="Clear filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            
            <input
              ref={effectiveSearchInputRef}
              type="text"
              placeholder={filterConversationId ? "Search in conversation..." : "Search conversations..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={onSearchFocus}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.currentTarget.blur();
                }
              }}
              className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/40 focus:placeholder:text-muted-foreground min-w-0"
            />
            
            {(searchQuery || filterConversationId) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  onClearFilter?.();
                }}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab buttons - hidden when searching */}
      {!isSearching && (
        <div className="px-4 flex-shrink-0 border-b border-border">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('known')}
              className={cn(
                "text-sm py-3 font-medium transition-colors relative",
                activeTab === 'known'
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Active {knownConversations.length > 0 && `(${knownConversations.length})`}
              {unreadActive > 0 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary ml-1 align-middle" aria-hidden />}
              {activeTab === 'known' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={cn(
                "text-sm py-3 font-medium transition-colors relative",
                activeTab === 'requests'
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Requests {requestConversations.length > 0 && `(${requestConversations.length})`}
              {unreadRequests > 0 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary ml-1 align-middle" aria-hidden />}
              {activeTab === 'requests' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Content area - show search results when searching, otherwise show conversations */}
      <div className="flex-1 min-h-0 mt-2 overflow-hidden">
        {isSearching ? (
          <SearchResults 
            query={debouncedSearchQuery} 
            onSelectConversation={onSelectConversation}
            filterConversationId={filterConversationId}
            selectedPubkey={selectedPubkey}
          />
        ) : isInitialLoad ? (
          <ConversationListSkeleton />
        ) : conversationsWithRelayStatus.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center text-muted-foreground px-4">
            <div>
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs mt-1">Start a new conversation to get started</p>
            </div>
          </div>
        ) : currentConversations.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-center text-muted-foreground px-4">
            <p className="text-sm">No {activeTab} conversations</p>
          </div>
        ) : (
          <ScrollArea className="h-full block">
            <div className="block w-full px-2 py-2 space-y-1">
              {currentConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversationId={conversation.id}
                  participantPubkeys={conversation.participantPubkeys}
                  isSelected={selectedPubkey === conversation.id}
                  onClick={() => onSelectConversation(conversation.id)}
                  lastMessage={conversation.lastMessage}
                  lastActivity={conversation.lastActivity}
                  hasDecryptionErrors={conversation.hasDecryptionErrors}
                  hasFailedRelays={conversation.hasFailedRelays}
                  unreadCount={conversation.unreadCount || 0}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};
