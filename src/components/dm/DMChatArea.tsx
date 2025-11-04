import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useConversationMessages, useDMContext, type DecryptedMessage } from '@/contexts/DMContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { genUserName } from '@/lib/genUserName';
import { MESSAGE_PROTOCOL, PROTOCOL_MODE, type MessageProtocol } from '@/lib/dmConstants';
import { formatConversationTime, formatFullDateTime, parseConversationId, getPubkeyColor } from '@/lib/dmUtils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Send, Loader2, AlertTriangle, FileJson } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NoteContent } from '@/components/NoteContent';
import type { NostrEvent } from '@nostrify/nostrify';

interface DMChatAreaProps {
  conversationId: string | null;
  onBack?: () => void;
  className?: string;
}

const RawEventModal = ({ 
  outerEvent, 
  innerEvent,
  giftWrapEvent,
  open, 
  onOpenChange 
}: {
  outerEvent: NostrEvent;
  innerEvent?: NostrEvent;
  giftWrapEvent?: NostrEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const isNIP17 = outerEvent.kind === 13 && innerEvent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Raw Nostr Event{isNIP17 ? 's' : ''}</DialogTitle>
        </DialogHeader>
        {isNIP17 ? (
          <Tabs defaultValue="inner" className="flex-1 flex flex-col min-h-0">
            <TabsList className="h-auto bg-transparent px- pt-0 pb-2 flex items-center gap-2">
              <TabsTrigger value="giftwrap" className="px-3 py-1.5 rounded data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                Gift Wrap (1059)
              </TabsTrigger>
              <span className="text-muted-foreground">→</span>
              <TabsTrigger value="seal" className="px-3 py-1.5 rounded data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                Seal (13)
              </TabsTrigger>
              <span className="text-muted-foreground">→</span>
              <TabsTrigger value="inner" className="px-3 py-1.5 rounded data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                Message ({innerEvent.kind})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="giftwrap" className="flex-1 mt-4">
              <ScrollArea className="h-full">
                {giftWrapEvent ? (
                  <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto">
                    <code>{JSON.stringify(giftWrapEvent, null, 2)}</code>
                  </pre>
                ) : (
                  <div className="p-4 text-muted-foreground text-sm">
                    Gift wrap not available for this message
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="seal" className="flex-1 mt-4">
              <ScrollArea className="h-full">
                <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto">
                  <code>{JSON.stringify(outerEvent, null, 2)}</code>
                </pre>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="inner" className="flex-1 mt-4">
              <ScrollArea className="h-full">
                <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto">
                  <code>{JSON.stringify(innerEvent, null, 2)}</code>
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : (
          <ScrollArea className="flex-1">
            <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto">
              <code>{JSON.stringify(outerEvent, null, 2)}</code>
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};

const MessageBubble = memo(({
  message,
  isFromCurrentUser,
  showSenderName = false,
  devMode = false,
}: {
  message: DecryptedMessage;
  isFromCurrentUser: boolean;
  showSenderName?: boolean;
  devMode?: boolean;
}) => {
  const [showRawEvent, setShowRawEvent] = useState(false);
  // For NIP-17, use inner message kind (14/15); for NIP-04, use message kind (4)
  const actualKind = message.decryptedEvent?.kind || message.kind;
  const isNIP4Message = message.kind === 4;
  const isNIP17Message = message.kind === 13 && message.decryptedEvent; // Kind 13 = seal
  const isFileAttachment = actualKind === 15; // Kind 15 = files/attachments

  // Fetch sender profile for group chats
  const senderProfile = useAuthor(message.pubkey);
  const metadata = senderProfile.data?.metadata;
  const senderName = metadata?.display_name || metadata?.name || genUserName(message.pubkey);
  const senderTextColor = getPubkeyColor(message.pubkey, 'text');

  // Create a NostrEvent object for NoteContent (only used for kind 15)
  // For NIP-17 file attachments, use the decryptedEvent which has the actual tags
  const messageEvent: NostrEvent = message.decryptedEvent || {
    ...(message.id && { id: message.id }),
    pubkey: message.pubkey,
    created_at: message.created_at,
    kind: message.kind,
    tags: message.tags,
    content: message.decryptedContent || '',
    ...(message.sig && { sig: message.sig }),
  } as NostrEvent;

  // For dev modal: reconstruct the outer event
  // For NIP-17 this is the Seal (kind 13) with encrypted content (no id/sig)
  // For NIP-04 this is the Kind 4 event with encrypted content (has id/sig)
  const messageAsEvent = message as DecryptedMessage;
  const outerEvent = {
    ...(messageAsEvent.id && { id: messageAsEvent.id }),
    pubkey: messageAsEvent.pubkey,
    created_at: messageAsEvent.created_at,
    kind: messageAsEvent.kind,
    tags: messageAsEvent.tags,
    content: messageAsEvent.content || '', // Encrypted content as stored
    ...(messageAsEvent.sig && { sig: messageAsEvent.sig }),
  } as NostrEvent;

  return (
    <div className={cn("flex mb-4", isFromCurrentUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[70%] rounded-lg px-4 py-2",
        isFromCurrentUser
          ? "bg-primary text-primary-foreground"
          : "bg-muted"
      )}>
        {showSenderName && !isFromCurrentUser && (
          <div className={cn("text-xs font-semibold mb-1", senderTextColor)}>
            {senderName}
          </div>
        )}
        {message.error ? (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <p className="text-sm italic opacity-70 cursor-help">🔒 Failed to decrypt</p>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{message.error}</p>
            </TooltipContent>
          </Tooltip>
        ) : isFileAttachment ? (
          // Kind 15: Use NoteContent to render files/media with imeta tags
          <div className="text-sm">
            <NoteContent event={messageEvent} className="whitespace-pre-wrap break-words" />
          </div>
        ) : (
          // Kind 4 (NIP-04) and Kind 14 (NIP-17 text): Display plain text
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.decryptedContent}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <span className={cn(
                    "text-xs opacity-70 cursor-default",
                    isFromCurrentUser ? "text-primary-foreground" : "text-muted-foreground"
                  )}>
                    {formatConversationTime(message.created_at)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{formatFullDateTime(message.created_at)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {isNIP4Message && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex-shrink-0">
                      <AlertTriangle className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Uses outdated NIP-04 encryption</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {message.isSending && (
              <Loader2 className="h-3 w-3 animate-spin opacity-70" />
            )}
          </div>

          {devMode && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowRawEvent(true)}
                    className={cn(
                      "opacity-50 hover:opacity-100 transition-opacity",
                      isFromCurrentUser ? "text-primary-foreground" : "text-foreground"
                    )}
                  >
                    <FileJson className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">View raw event</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <RawEventModal
          outerEvent={outerEvent}
          innerEvent={isNIP17Message ? message.decryptedEvent : undefined}
          giftWrapEvent={isNIP17Message ? messageAsEvent.originalGiftWrap : undefined}
          open={showRawEvent}
          onOpenChange={setShowRawEvent}
        />
      </div>
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

const GroupAvatar = ({ pubkeys }: { pubkeys: string[] }) => {
  const author1 = useAuthor(pubkeys[0] || '');
  const author2 = useAuthor(pubkeys[1] || '');
  const author3 = useAuthor(pubkeys[2] || '');
  const author4 = useAuthor(pubkeys[3] || '');

  const authors = [author1, author2, author3, author4];

  if (pubkeys.length === 1) {
    const metadata = author1.data?.metadata;
    const displayName = metadata?.name || genUserName(pubkeys[0]);
    const avatarUrl = metadata?.picture;
    const initials = displayName.slice(0, 2).toUpperCase();
    const bgColor = getPubkeyColor(pubkeys[0]);

    return (
      <Avatar className="h-10 w-10">
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className={cn(bgColor, "text-white")}>{initials}</AvatarFallback>
      </Avatar>
    );
  }

  // For 2 people: split circle vertically
  if (pubkeys.length === 2) {
    return (
      <div className="relative h-10 w-10 rounded-full overflow-hidden flex-shrink-0">
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
                <div className={cn("h-full w-full", bgColor)} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // For 3+ people: split into 4 quarters
  return (
    <div className="relative h-10 w-10 rounded-full overflow-hidden flex-shrink-0">
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
              <div className={cn("h-full w-full", bgColor)} />
            )}
          </div>
        );
      })}
    </div>
  );
};

const ParticipantNames = ({ pubkeys }: { pubkeys: string[] }) => {
  // Fetch author data for first 2 participants
  const author1 = useAuthor(pubkeys[0]);
  const author2 = useAuthor(pubkeys[1]);

  const name1 = author1.data?.metadata?.name || genUserName(pubkeys[0]);
  const name2 = author2.data?.metadata?.name || genUserName(pubkeys[1]);

  if (pubkeys.length === 1) {
    return <span>{name1}</span>;
  } else if (pubkeys.length === 2) {
    return <span>{name1} and {name2}</span>;
  } else {
    const remaining = pubkeys.length - 2;
    return <span>{name1}, {name2}, and {remaining} other{remaining > 1 ? 's' : ''}</span>;
  }
};

const ChatHeader = ({ conversationId, onBack }: { conversationId: string; onBack?: () => void }) => {
  const { user } = useCurrentUser();
  
  // Parse conversation participants and exclude current user from display
  const allParticipants = parseConversationId(conversationId);
  const conversationParticipants = allParticipants.filter(pk => pk !== user?.pubkey);

  // Check if this is a self-messaging conversation
  const isSelfMessaging = conversationParticipants.length === 0;

  // For 1-on-1 chats, fetch the single participant's profile (or self if messaging yourself)
  const displayPubkey = isSelfMessaging ? user?.pubkey : conversationParticipants[0];
  const singleParticipant = useAuthor(displayPubkey || '');
  const metadata = singleParticipant.data?.metadata;

  // Derive display values
  const isMultiPerson = conversationParticipants.length > 1;
  const displayName = isMultiPerson 
    ? null // Will use ParticipantNames component
    : isSelfMessaging
      ? `${metadata?.name || genUserName(user?.pubkey || '')} (You)`
      : metadata?.name || genUserName(displayPubkey || '');
  const subtitle = isMultiPerson
    ? `${conversationParticipants.length} other participants`
    : isSelfMessaging
      ? 'Private notes to yourself'
      : metadata?.nip05;

  return (
    <div className="p-4 border-b flex items-center gap-3">
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="md:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}

      <GroupAvatar pubkeys={isSelfMessaging ? [user!.pubkey] : conversationParticipants} />

      <div className="flex-1 min-w-0">
        <h2 className="font-semibold truncate">
          {isMultiPerson ? <ParticipantNames pubkeys={conversationParticipants} /> : displayName}
        </h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
};

const EmptyState = ({ isLoading }: { isLoading: boolean }) => {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center text-muted-foreground max-w-sm">
        {isLoading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-sm">Loading conversations...</p>
            <p className="text-xs mt-2">
              Fetching encrypted messages from relays
            </p>
          </>
        ) : (
          <>
            <p className="text-sm">Select a conversation to start messaging</p>
            <p className="text-xs mt-2">
              Your messages are encrypted and stored locally
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export const DMChatArea = ({ conversationId, onBack, className }: DMChatAreaProps) => {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { sendMessage, protocolMode, isLoading } = useDMContext();
  const { messages, hasMoreMessages, loadEarlierMessages } = useConversationMessages(conversationId || '');

  const devMode = config.devMode ?? false;

  // Check if this is a group chat (3+ participants including current user)
  const allParticipants = parseConversationId(conversationId || '');
  const isGroupChat = allParticipants.length >= 3;

  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Determine default protocol based on mode
  const getDefaultProtocol = () => {
    if (protocolMode === PROTOCOL_MODE.NIP04_ONLY) return MESSAGE_PROTOCOL.NIP04;
    if (protocolMode === PROTOCOL_MODE.NIP17_ONLY) return MESSAGE_PROTOCOL.NIP17;
    if (protocolMode === PROTOCOL_MODE.NIP04_OR_NIP17) return MESSAGE_PROTOCOL.NIP17;
    // Fallback to NIP-17 for any unexpected mode
    return MESSAGE_PROTOCOL.NIP17;
  };

  const [selectedProtocol, setSelectedProtocol] = useState<MessageProtocol>(getDefaultProtocol());
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Determine if selection is allowed
  const allowSelection = protocolMode === PROTOCOL_MODE.NIP04_OR_NIP17;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !conversationId || !user) return;

    setIsSending(true);
    try {
      await sendMessage({
        recipientPubkey: conversationId,
        content: messageText.trim(),
        protocol: selectedProtocol,
      });
      setMessageText('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  }, [messageText, conversationId, user, sendMessage, selectedProtocol]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleLoadMore = useCallback(async () => {
    if (!scrollAreaRef.current || isLoadingMore) return;

    const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (!scrollContainer) return;

    // Store current scroll position and height
    const previousScrollHeight = scrollContainer.scrollHeight;
    const previousScrollTop = scrollContainer.scrollTop;

    setIsLoadingMore(true);

    // Load more messages
    loadEarlierMessages();

    // Wait for DOM to update, then restore relative scroll position
    setTimeout(() => {
      if (scrollContainer) {
        const newScrollHeight = scrollContainer.scrollHeight;
        const heightDifference = newScrollHeight - previousScrollHeight;
        scrollContainer.scrollTop = previousScrollTop + heightDifference;
      }
      setIsLoadingMore(false);
    }, 0);
  }, [loadEarlierMessages, isLoadingMore]);

  if (!conversationId) {
    return (
      <Card className={cn("h-full", className)}>
        <EmptyState isLoading={isLoading} />
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className={cn("h-full flex items-center justify-center", className)}>
        <div className="text-center text-muted-foreground">
          <p className="text-sm">Please log in to view messages</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <ChatHeader conversationId={conversationId} onBack={onBack} />

      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-sm">No messages yet</p>
              <p className="text-xs mt-1">Send a message to start the conversation</p>
            </div>
          </div>
        ) : (
          <div>
            {hasMoreMessages && (
              <div className="flex justify-center mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="text-xs"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-2" />
                      Loading...
                    </>
                  ) : (
                    'Load Earlier Messages'
                  )}
                </Button>
              </div>
            )}
            {messages.map((message) => (
              <MessageBubble
                key={message.originalGiftWrapId || message.id}
                message={message}
                isFromCurrentUser={message.pubkey === user.pubkey}
                showSenderName={isGroupChat}
                devMode={devMode}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            className="min-h-[80px] resize-none"
            disabled={isSending}
          />
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSend}
              disabled={!messageText.trim() || isSending}
              size="icon"
              className="h-[44px] w-[90px]"
            >
              {isSending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
            <Select
              value={selectedProtocol}
              onValueChange={(value) => setSelectedProtocol(value as MessageProtocol)}
              disabled={!allowSelection}
            >
              <SelectTrigger className="h-[32px] w-[90px] text-xs px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MESSAGE_PROTOCOL.NIP17} className="text-xs">
                  NIP-17
                </SelectItem>
                <SelectItem value={MESSAGE_PROTOCOL.NIP04} className="text-xs">
                  NIP-04
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </Card>
  );
};
