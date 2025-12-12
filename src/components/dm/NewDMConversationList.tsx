import { useMemo, useState, memo, useEffect, useRef } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { useNewDMContext } from '@/contexts/NewDMContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { getDisplayName } from '@/lib/genUserName';
import { formatConversationTime, formatFullDateTime, parseConversationId, getPubkeyColor } from '@/lib/dmUtils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { LOADING_PHASES } from '@/lib/dmConstants';
import { NewConversationDialog } from '@/components/NewConversationDialog';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants';

interface DMConversationListProps {
  selectedPubkey: string | null;
  onSelectConversation: (conversationId: string) => void;
  className?: string;
  onStatusClick?: () => void;
}

interface ConversationItemProps {
  pubkey: string;
  isSelected: boolean;
  onClick: () => void;
  lastMessage: { decryptedContent?: string; error?: string } | null;
  lastActivity: number;
  hasNIP4Messages: boolean;
}

const GroupAvatar = ({ pubkeys, isSelected }: { pubkeys: string[]; isSelected: boolean }) => {
  const author1 = useAuthor(pubkeys[0] || '');
  const author2 = useAuthor(pubkeys[1] || '');
  const author3 = useAuthor(pubkeys[2] || '');
  const author4 = useAuthor(pubkeys[3] || '');

  const authors = [author1, author2, author3, author4];

  if (pubkeys.length === 1) {
    const metadata = author1.data?.metadata;
    const displayName = getDisplayName(pubkeys[0], metadata);
    const avatarUrl = metadata?.picture;
    const initials = displayName.slice(0, 2).toUpperCase();
    const bgColor = getPubkeyColor(pubkeys[0]);

    return (
      <Avatar className={cn("h-10 w-10 flex-shrink-0 transition-opacity", !isSelected && "opacity-40")}>
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className="text-white" style={{ backgroundColor: bgColor }}>{initials}</AvatarFallback>
      </Avatar>
    );
  }

  // For 2 people: split circle vertically
  if (pubkeys.length === 2) {
    return (
      <div className={cn("relative h-10 w-10 rounded-full overflow-hidden flex-shrink-0 transition-opacity", !isSelected && "opacity-40")}>
        {pubkeys.slice(0, 2).map((pubkey, index) => {
          const author = authors[index];
          const metadata = author?.data?.metadata;
          const avatarUrl = metadata?.picture;
          const bgColor = getPubkeyColor(pubkey);

          return (
            <div
              key={pubkey}
              className="absolute inset-0 w-1/2"
              style={{ left: index === 0 ? 0 : '50%' }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" style={{ backgroundColor: bgColor }} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // For 3+ people: split into 4 quarters
  return (
    <div className={cn("relative h-10 w-10 rounded-full overflow-hidden flex-shrink-0 transition-opacity", !isSelected && "opacity-40")}>
      {pubkeys.slice(0, 4).map((pubkey, index) => {
        const author = authors[index];
        const metadata = author?.data?.metadata;
        const avatarUrl = metadata?.picture;
        const bgColor = getPubkeyColor(pubkey);

        const positions = [
          { top: 0, left: 0 }, // top-left
          { top: 0, left: '50%' }, // top-right
          { top: '50%', left: 0 }, // bottom-left
          { top: '50%', left: '50%' }, // bottom-right
        ];

        return (
          <div
            key={pubkey}
            className="absolute w-1/2 h-1/2"
            style={positions[index]}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full" style={{ backgroundColor: bgColor }} />
            )}
          </div>
        );
      })}
    </div>
  );
};

const ConversationItemComponent = ({
  pubkey,
  isSelected,
  onClick,
  lastMessage,
  lastActivity,
}: ConversationItemProps) => {
  const { user } = useCurrentUser();
  
  // Parse conversation participants and exclude current user from display
  const allParticipants = parseConversationId(pubkey);
  const conversationParticipants = allParticipants.filter(pk => pk !== user?.pubkey);

  // Check if this is a self-messaging conversation
  const isSelfMessaging = conversationParticipants.length === 0;

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

  const lastMessagePreview = lastMessage?.error
    ? '🔒 Encrypted message'
    : lastMessage?.decryptedContent || 'No messages yet';

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
          <GroupAvatar pubkeys={isSelfMessaging ? [user!.pubkey] : conversationParticipants} isSelected={isSelected} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {isLoadingProfile ? (
                <Skeleton className="h-[1.25rem] w-24" />
              ) : (
                <span className="font-medium text-sm truncate">{conversationDisplayName}</span>
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

          <p className="text-sm text-muted-foreground truncate">
            {lastMessagePreview}
          </p>
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
  onStatusClick
}: DMConversationListProps) => {
  const { conversations, isLoading, loadingPhase } = useNewDMContext();
  const [activeTab, setActiveTab] = useState<'known' | 'requests'>('known');
  const prevWasRequestRef = useRef<Set<string>>(new Set());

  // Filter conversations by type
  const { knownConversations, requestConversations } = useMemo(() => {
    return {
      knownConversations: conversations.filter(c => c.isKnown),
      requestConversations: conversations.filter(c => c.isRequest),
    };
  }, [conversations]);

  // Auto-switch to "known" tab when a request conversation becomes known
  useEffect(() => {
    if (!selectedPubkey) return;
    
    const selectedConversation = conversations.find(c => c.pubkey === selectedPubkey);
    if (!selectedConversation) return;
    
    // If this was a request but is now known, switch to known tab
    if (selectedConversation.isKnown && prevWasRequestRef.current.has(selectedPubkey)) {
      setActiveTab('known');
      prevWasRequestRef.current.delete(selectedPubkey);
    } else if (selectedConversation.isRequest) {
      prevWasRequestRef.current.add(selectedPubkey);
    }
  }, [selectedPubkey, conversations]);

  // Get the current list based on active tab
  const currentConversations = activeTab === 'known' ? knownConversations : requestConversations;

  // Show skeleton during initial load (cache + relays) if we have no conversations yet
  const isInitialLoad = (loadingPhase === LOADING_PHASES.CACHE || loadingPhase === LOADING_PHASES.RELAYS) && conversations.length === 0;

  return (
    <div className={cn("h-full flex flex-col overflow-hidden border-r border-border bg-card", className)}>
      {/* Header - always visible */}
      <div className="px-4 py-4 border-b flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex flex-col justify-center min-h-[32px]">
              <h1 className="text-lg font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent leading-none">
                {APP_NAME}
              </h1>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{APP_DESCRIPTION}</p>
            </div>
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

      {/* Tab buttons - always visible */}
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
            {activeTab === 'requests' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>
      </div>

      {/* Content area - show skeleton during initial load, otherwise show conversations */}
      <div className="flex-1 min-h-0 mt-2 overflow-hidden">
        {(isLoading || isInitialLoad) ? (
          <ConversationListSkeleton />
        ) : conversations.length === 0 ? (
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
                  key={conversation.pubkey}
                  pubkey={conversation.pubkey}
                  isSelected={selectedPubkey === conversation.pubkey}
                  onClick={() => onSelectConversation(conversation.pubkey)}
                  lastMessage={conversation.lastMessage}
                  lastActivity={conversation.lastActivity}
                  hasNIP4Messages={conversation.hasNIP4Messages}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};
