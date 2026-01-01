import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { useConversationMessages, useNewDMContext } from '@/contexts/NewDMContext';
import type { Message } from '@/lib/dmTypes';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { useAppContext } from '@/hooks/useAppContext';
import { MESSAGE_PROTOCOL, PROTOCOL_MODE, type MessageProtocol } from '@/lib/dmConstants';
import { getDisplayName } from '@/lib/genUserName';
import { formatConversationTime, formatFullDateTime, getPubkeyColor } from '@/lib/dmUtils';
import { Pure as DMLib } from '@/lib/dmLib';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Send, Loader2, AlertTriangle, AlertCircle, FileJson, FileLock, Server, ExternalLink, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NoteContent } from '@/components/NoteContent';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

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
  // NIP-17 has a seal (kind 13) wrapping the inner message
  const isNIP17 = outerEvent.kind === 13 && !!innerEvent;

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
            <TabsContent value="giftwrap" className="flex-1 mt-4 overflow-auto">
              {giftWrapEvent ? (
                <pre className="text-xs bg-muted p-4 rounded-md">
                  <code>{JSON.stringify(giftWrapEvent, null, 2)}</code>
                </pre>
              ) : (
                <div className="p-4 text-muted-foreground text-sm">
                  Gift wrap not available for this message
                </div>
              )}
            </TabsContent>
            <TabsContent value="seal" className="flex-1 mt-4 overflow-auto">
              {outerEvent.kind === 13 ? (
                <pre className="text-xs bg-muted p-4 rounded-md">
                  <code>{JSON.stringify(outerEvent, null, 2)}</code>
                </pre>
              ) : (
                <div className="p-4 text-muted-foreground text-sm">
                  Seal (kind 13) not available for this message
                </div>
              )}
            </TabsContent>
            <TabsContent value="inner" className="flex-1 mt-4 overflow-auto">
              <pre className="text-xs bg-muted p-4 rounded-md">
                <code>{JSON.stringify(innerEvent, null, 2)}</code>
              </pre>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex-1 overflow-auto">
            <pre className="text-xs bg-muted p-4 rounded-md">
              <code>{JSON.stringify(outerEvent, null, 2)}</code>
            </pre>
          </div>
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
  message: Message;
  isFromCurrentUser: boolean;
  showSenderName?: boolean;
  devMode?: boolean;
}) => {
  const [showRawEvent, setShowRawEvent] = useState(false);
  const { config } = useAppContext();
  
  // Access the actual event (kind 4, 14, or 15 with decrypted content)
  const event = message.event;
  const actualKind = event.kind;
  const isNIP4Message = message.protocol === 'nip04';
  const isNIP17Message = message.protocol === 'nip17';
  const isFileAttachment = actualKind === 15; // Kind 15 = files/attachments
  const renderInlineMedia = config.renderInlineMedia ?? true;
  const shouldRenderMedia = isFileAttachment || renderInlineMedia;

  // Check if it's an encrypted file attachment
  const hasEncryption = isFileAttachment && event.tags.some(
    ([tagName]) => tagName === 'encryption-algorithm' || tagName === 'decryption-key'
  );

  // Fetch sender profile for group chats
  const senderProfile = useAuthor(event.pubkey);
  const metadata = senderProfile.data?.metadata;
  const senderName = getDisplayName(event.pubkey, metadata);
  const senderColor = getPubkeyColor(event.pubkey);

  // The event is already the decrypted inner message (kind 4, 14, or 15)
  const messageEvent: NostrEvent = event;

  return (
    <div className={cn("flex mb-4", isFromCurrentUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[70%] rounded-lg px-4 py-2",
        isFromCurrentUser
          ? "bg-primary text-primary-foreground"
          : "bg-muted"
      )}>
        {showSenderName && !isFromCurrentUser && (
          <div className="text-xs font-semibold mb-1" style={{ color: senderColor }}>
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
        ) : shouldRenderMedia ? (
          <div className="text-sm">
            <NoteContent event={messageEvent} className="whitespace-pre-wrap break-words" />
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words">
            {event.content}
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
                    {formatConversationTime(event.created_at)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{formatFullDateTime(event.created_at)}</p>
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
            {hasEncryption && (
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="flex-shrink-0">
                      <FileLock className="h-3 w-3 text-orange-500 dark:text-orange-400" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Encrypted file (not yet supported)</p>
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
          outerEvent={message.sealEvent || event}
          innerEvent={isNIP17Message ? event : undefined}
          giftWrapEvent={message.giftWrapEvent}
          open={showRawEvent}
          onOpenChange={setShowRawEvent}
        />
      </div>
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

// Smaller avatar for chat header
const ChatGroupAvatar = ({ pubkeys }: { pubkeys: string[] }) => {
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
      <Avatar className="h-8 w-8">
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className="text-white text-xs" style={{ backgroundColor: bgColor }}>{initials}</AvatarFallback>
      </Avatar>
    );
  }

  // For 2 people: split circle vertically
  if (pubkeys.length === 2) {
    return (
      <div className="relative h-8 w-8 rounded-full overflow-hidden flex-shrink-0">
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
    <div className="relative h-8 w-8 rounded-full overflow-hidden flex-shrink-0">
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

const ParticipantNames = ({ pubkeys }: { pubkeys: string[] }) => {
  // Fetch author data for first 2 participants
  const author1 = useAuthor(pubkeys[0]);
  const author2 = useAuthor(pubkeys[1]);

  const name1 = getDisplayName(pubkeys[0], author1.data?.metadata);
  const name2 = getDisplayName(pubkeys[1], author2.data?.metadata);

  if (pubkeys.length === 1) {
    return <span>{name1}</span>;
  } else if (pubkeys.length === 2) {
    return <span>{name1} and {name2}</span>;
  } else {
    const remaining = pubkeys.length - 2;
    return <span>{name1}, {name2}, and {remaining} other{remaining > 1 ? 's' : ''}</span>;
  }
};

// Component to display user labels for a relay
const RelayUserLabels = ({ users, authorsMap, relay, discoveryRelays }: { 
  users: Array<{ pubkey: string; isCurrentUser: boolean; source: string }>; 
  authorsMap: Map<string, { event?: NostrEvent; metadata?: import('@nostrify/nostrify').NostrMetadata }>;
  relay?: string;
  discoveryRelays?: Set<string>;
}) => {
  const userLabels = users.map(user => {
    if (user.isCurrentUser) {
      // Check if this relay is ONLY in discovery relays (not in user's actual relay lists)
      const isOnlyDiscovery = relay && discoveryRelays && discoveryRelays.has(relay);
      return { 
        label: isOnlyDiscovery ? 'Discovery' : 'Yours', 
        source: user.source, 
        isCurrentUser: !isOnlyDiscovery,
        isDiscovery: isOnlyDiscovery,
        type: isOnlyDiscovery ? 'discovery' : 'yours'
      };
    }
    
    const authorData = authorsMap.get(user.pubkey);
    const metadata = authorData?.metadata;
    const displayName = getDisplayName(user.pubkey, metadata);
    // Add possessive 's to show it's their relay
    const possessiveLabel = displayName.endsWith('s') ? `${displayName}'` : `${displayName}'s`;
    return { 
      label: possessiveLabel, 
      source: user.source, 
      isCurrentUser: false, 
      isDiscovery: false,
      type: 'other'
    };
  });

  return (
    <div className="flex flex-wrap gap-2">
      {userLabels.map((user, idx) => (
        <TooltipProvider key={idx}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(
                "text-xs px-2 py-0.5 rounded cursor-help font-semibold transition-all",
                user.type === 'yours' && "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-sm",
                user.type === 'discovery' && "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-sm",
                user.type === 'other' && "bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 shadow-sm"
              )}>
                {user.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Source: {user.source}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
};

// Modal to display participant profile information
const ParticipantInfoModal = ({ open, onOpenChange, conversationId }: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
  conversationId: string;
}) => {
  const { user } = useCurrentUser();
  const [copiedPubkey, setCopiedPubkey] = useState<string | null>(null);
  
  // Parse all participants
  const allParticipants = useMemo(() => DMLib.Conversation.parseConversationId(conversationId).participantPubkeys, [conversationId]);
  
  // Fetch all participant profiles
  const authorsData = useAuthorsBatch(allParticipants);

  const handleCopyNpub = useCallback((pubkey: string) => {
    const npub = nip19.npubEncode(pubkey);
    navigator.clipboard.writeText(npub);
    setCopiedPubkey(pubkey);
    setTimeout(() => setCopiedPubkey(null), 2000);
  }, []);

  const getExternalLink = useCallback((pubkey: string) => `https://nostr.band/${nip19.npubEncode(pubkey)}`, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Participants</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {allParticipants.map((pubkey) => {
            const isCurrentUser = pubkey === user?.pubkey;
            const authorData = authorsData.data.get(pubkey);
            const metadata = authorData?.metadata;
            const displayName = getDisplayName(pubkey, metadata);
            const npub = nip19.npubEncode(pubkey);
            const bgColor = getPubkeyColor(pubkey);

            return (
              <div key={pubkey} className="flex gap-3 p-3 rounded-lg border bg-card">
                <Avatar className="h-12 w-12 flex-shrink-0">
                  <AvatarImage src={metadata?.picture} alt={displayName} />
                  <AvatarFallback className="text-white" style={{ backgroundColor: bgColor }}>
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm truncate">
                      {displayName}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(You)</span>
                      )}
                    </h3>
                  </div>
                  
                  {metadata?.nip05 && (
                    <p className="text-xs text-muted-foreground truncate mb-1">
                      ✓ {metadata.nip05}
                    </p>
                  )}
                  
                  {metadata?.about && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                      {metadata.about}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-2 mt-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">
                      {npub}
                    </code>
                    
                    <TooltipProvider>
                      <Tooltip delayDuration={500}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleCopyNpub(pubkey)}
                          >
                            {copiedPubkey === pubkey ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Copy npub</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    
                    <TooltipProvider>
                      <Tooltip delayDuration={500}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => window.open(getExternalLink(pubkey), '_blank')}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">View on nostr.band</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Modal to display relay information for a conversation
const RelayInfoModal = ({ open, onOpenChange, conversationId }: { open: boolean; onOpenChange: (open: boolean) => void; conversationId: string }) => {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { getConversationRelays, messagingState } = useNewDMContext();
  
  // This is reactive - updates when cache updates
  const relayInfo = useMemo(() => getConversationRelays(conversationId), [getConversationRelays, conversationId]);

  // Get all participant pubkeys and fetch their metadata
  const otherParticipants = useMemo(() => {
    const { participantPubkeys } = DMLib.Conversation.parseConversationId(conversationId);
    return participantPubkeys.filter(pk => pk !== user?.pubkey);
  }, [conversationId, user?.pubkey]);
  
  const authorsData = useAuthorsBatch(otherParticipants);
  
  // Get discovery relays for comparison
  const discoveryRelays = useMemo(() => new Set(config.discoveryRelays), [config.discoveryRelays]);

  // Count failed relays
  const failedCount = useMemo(() => {
    return relayInfo.filter(({ relay }) => {
      const info = messagingState?.relayInfo[relay];
      return info && !info.lastQuerySucceeded;
    }).length;
  }, [relayInfo, messagingState]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conversation Relay Information</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div className="text-sm text-muted-foreground">
            <p className="text-xs">
              Messages are fetched from your inbox relays and sent to recipients' inbox relays.
              {relayInfo.length === 0 && ' Loading relay information...'}
            </p>
          </div>

          {failedCount > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-red-500">{failedCount} relay{failedCount > 1 ? 's' : ''} failed to connect.</span> Messages may be missing or delayed. Try:
              </p>
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1 ml-2">
                <li>Check your internet connection</li>
                <li>Wait a few minutes and refresh</li>
                <li>Ask participants to update their relay lists</li>
                <li>Remove unreliable relays from your settings</li>
              </ul>
            </div>
          )}

          {relayInfo.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Relays Used in This Conversation</h3>
              <div className="space-y-2">
                {relayInfo.map(({ relay, users }) => {
                  const info = messagingState?.relayInfo[relay];
                  const isFailed = info && !info.lastQuerySucceeded;
                  
                  return (
                    <div key={relay} className={cn(
                      "flex flex-col gap-2 px-3 py-2 rounded",
                      isFailed ? "bg-red-500/5 border border-red-500/20" : "bg-muted"
                    )}>
                      <div className="flex items-center gap-3">
                        <div className="text-xs font-mono flex-1 min-w-0 truncate">
                          {relay}
                        </div>
                      <div className="flex-shrink-0">
                        <RelayUserLabels users={users} authorsMap={authorsData.data} relay={relay} discoveryRelays={discoveryRelays} />
                      </div>
                      </div>
                      {isFailed && info?.lastQueryError && (
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                          <p className="text-xs text-red-500/80">
                            Error: {info.lastQueryError}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ChatHeader = ({ conversationId, onBack }: { conversationId: string; onBack?: () => void }) => {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { getConversationRelays, messagingState } = useNewDMContext();
  const [showRelayModal, setShowRelayModal] = useState(false);
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  
  // Parse conversation participants and exclude current user from display
  const { participantPubkeys: allParticipants } = DMLib.Conversation.parseConversationId(conversationId);
  const conversationParticipants = allParticipants.filter(pk => pk !== user?.pubkey);

  // Check if this is a self-messaging conversation
  const isSelfMessaging = conversationParticipants.length === 0;

  // For 1-on-1 chats, fetch the single participant's profile (or self if messaging yourself)
  const displayPubkey = isSelfMessaging ? user?.pubkey : conversationParticipants[0];
  const singleParticipant = useAuthor(displayPubkey || '');
  const metadata = singleParticipant.data?.metadata;

  // Derive display values
  const isMultiPerson = conversationParticipants.length > 1;
  const baseName = getDisplayName(displayPubkey || '', metadata);
  const displayName = isMultiPerson 
    ? null // Will use ParticipantNames component
    : isSelfMessaging
      ? `${baseName} (You)`
      : baseName;
  const subtitle = isMultiPerson
    ? `${conversationParticipants.length} other participants`
    : isSelfMessaging
      ? 'Private notes to yourself'
      : metadata?.nip05;

  const devMode = config.devMode ?? false;

  // Check if conversation has failed relays
  const hasFailedRelays = useMemo(() => {
    const relayInfo = getConversationRelays(conversationId);
    return relayInfo.some(({ relay }) => {
      const info = messagingState?.relayInfo[relay];
      return info && !info.lastQuerySucceeded;
    });
  }, [conversationId, getConversationRelays, messagingState]);

  return (
    <div className="px-4 py-4 border-b flex items-center gap-3">
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

      <div className="flex-1 min-w-0">
        <button
          onClick={() => setShowParticipantModal(true)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-help hover:bg-accent"
        >
          <ChatGroupAvatar pubkeys={isSelfMessaging ? [user!.pubkey] : conversationParticipants} />

          <div className="text-left">
            <h2 className="font-semibold text-sm whitespace-nowrap">
              {isMultiPerson ? <ParticipantNames pubkeys={conversationParticipants} /> : displayName}
            </h2>
            {subtitle && (
              <p className="text-xs text-muted-foreground whitespace-nowrap">{subtitle}</p>
            )}
          </div>
        </button>
      </div>

      {devMode && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowRelayModal(true)}
                className={cn(hasFailedRelays && "text-red-500 hover:text-red-500")}
              >
                <Server className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {hasFailedRelays ? 'Some relays failed - click for details' : 'View relay information'}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <ParticipantInfoModal
        open={showParticipantModal}
        onOpenChange={setShowParticipantModal}
        conversationId={conversationId}
      />

      {devMode && (
        <RelayInfoModal
          open={showRelayModal}
          onOpenChange={setShowRelayModal}
          conversationId={conversationId}
        />
      )}
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

export const NewDMChatArea = ({ conversationId, onBack, className }: DMChatAreaProps) => {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { sendMessage, protocolMode, isLoading } = useNewDMContext();
  const { messages, hasMoreMessages, loadEarlierMessages } = useConversationMessages(conversationId || '');

  const devMode = config.devMode ?? false;

  // Check if this is a group chat (3+ participants including current user)
  const { participantPubkeys: allParticipants } = conversationId ? DMLib.Conversation.parseConversationId(conversationId) : { participantPubkeys: [] };
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
  // Use the last message's id/timestamp as dependency to catch both new messages and replacements
  const lastMessageKey = messages.length > 0 
    ? `${messages[messages.length - 1].id}-${messages[messages.length - 1].event.created_at}`
    : '';
  
  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM has updated before scrolling
    requestAnimationFrame(() => {
      if (scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    });
  }, [lastMessageKey]);

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
      <div className={cn("h-full bg-background", className)}>
        <EmptyState isLoading={isLoading} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className={cn("h-full flex items-center justify-center bg-background", className)}>
        <div className="text-center text-muted-foreground">
          <p className="text-sm">Please log in to view messages</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-full flex flex-col bg-background", className)}>
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
            {messages.map((message: Message) => (
              <MessageBubble
                key={message.giftWrapId || message.id}
                message={message}
                isFromCurrentUser={message.event.pubkey === user.pubkey}
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
    </div>
  );
};
