import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { useConversationMessages, useNewDMContext } from '@/contexts/NewDMContext';
import type { Message } from '@samthomson/nostr-messaging/core';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { useAppContext } from '@/hooks/useAppContext';
import { MESSAGE_PROTOCOL, PROTOCOL_MODE, type MessageProtocol } from '@samthomson/nostr-messaging/core';
import { getDisplayName } from '@/lib/genUserName';
import { formatConversationTime, formatFullDateTime, getPubkeyColor, formatBytes, isMediaFile } from '@samthomson/nostr-messaging/core';
import { Pure as DMLib, type FileAttachment } from '@samthomson/nostr-messaging/core';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Send, Loader2, AlertTriangle, AlertCircle, FileJson, FileLock, Server, ExternalLink, Copy, Check, Pencil, Paperclip, X, Images, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NoteContent } from '@/components/NoteContent';
import { EncryptedMediaDisplay } from '@/components/dm/EncryptedMediaDisplay';
import { MediaLightbox } from '@/components/dm/MediaLightbox';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

interface DMChatAreaProps {
  conversationId: string | null;
  scrollToMessageId?: string;
  onBack?: () => void;
  onToggleMediaPanel?: () => void;
  showMediaPanel?: boolean;
  onSearchInConversation?: () => void;
  className?: string;
}

// Video thumbnail component that properly manages blob URL lifecycle
const VideoThumbnail = memo(({ file, onRemove }: { file: File; onRemove: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setThumbnailUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative w-20 h-20 rounded-lg overflow-hidden border bg-black group">
      {thumbnailUrl && (
        <video
          ref={videoRef}
          src={thumbnailUrl}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={() => {
            if (videoRef.current) {
              videoRef.current.currentTime = 0.1;
            }
          }}
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-5 h-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center opacity-80">
          <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});
VideoThumbnail.displayName = 'VideoThumbnail';

const RawEventModal = ({
  outerEvent,
  innerEvent,
  giftWrapEvent,
  fileMetadata,
  open,
  onOpenChange
}: {
  outerEvent: NostrEvent;
  innerEvent?: NostrEvent;
  giftWrapEvent?: NostrEvent;
  fileMetadata?: import('@/lib/dmTypes').FileMetadata[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  // NIP-17 has a seal (kind 13) wrapping the inner message
  const isNIP17 = outerEvent.kind === 13 && !!innerEvent;
  const isFileMessage = innerEvent?.kind === 15 || outerEvent.kind === 15;

  const extractDomain = (url: string) => {
    try { return new URL(url).hostname; } catch { return null; }
  };

  const extractDimensions = (url: string): string | null => {
    try {
      const urlObj = new URL(url);
      const width = urlObj.searchParams.get('width');
      const height = urlObj.searchParams.get('height');
      if (width && height) return `${width}x${height}`;
      return null;
    } catch { return null; }
  };

  // Normalize to array
  const fileMetadataArray = Array.isArray(fileMetadata) ? fileMetadata : (fileMetadata ? [fileMetadata] : []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Raw Nostr Event{isNIP17 ? 's' : ''}</DialogTitle>
        </DialogHeader>
        {isNIP17 ? (
          <Tabs defaultValue="inner" className="flex-1 flex flex-col min-h-0">
            <TabsList className="h-auto bg-transparent px- pt-0 pb-2 flex items-center gap-2 flex-wrap">
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
              {isFileMessage && (
                <>
                  <span className="text-muted-foreground">|</span>
                  <TabsTrigger value="media" className="px-3 py-1.5 rounded data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                    📎 Media Info
                  </TabsTrigger>
                </>
              )}
            </TabsList>
            {isFileMessage && (
              <TabsContent value="media" className="flex-1 mt-4 overflow-auto">
                <div className="bg-muted p-4 rounded-md space-y-4">
                  <h3 className="font-medium text-sm">File Information {fileMetadataArray.length > 1 && `(${fileMetadataArray.length} files)`}</h3>
                  {fileMetadataArray.map((fm, idx) => {
                    const dimensions = fm.dim || (fm.url ? extractDimensions(fm.url) : null);
                    return (
                      <div key={idx}>
                        {idx > 0 && <Separator className="my-4" />}
                        {fileMetadataArray.length > 1 && (
                          <div className="text-xs font-semibold text-muted-foreground mb-3">File {idx + 1}</div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="text-muted-foreground">Source Host:</div>
                          <div className="font-mono">{fm.url ? extractDomain(fm.url) : 'Unknown'}</div>

                          <div className="text-muted-foreground">File Type:</div>
                          <div>{fm.mimeType || 'Unknown'}</div>

                          <div className="text-muted-foreground">File Size:</div>
                          <div>{fm.size ? formatBytes(fm.size) : <span className="text-muted-foreground/70">Not provided by sender</span>}</div>

                          <div className="text-muted-foreground">Dimensions:</div>
                          <div>{dimensions || <span className="text-muted-foreground/70">Not provided</span>}</div>

                          <div className="text-muted-foreground">Encrypted:</div>
                          <div>{fm.encryptionAlgorithm ? `Yes (${fm.encryptionAlgorithm})` : 'No'}</div>

                          {fm.hash && (
                            <>
                              <div className="text-muted-foreground">Hash (x):</div>
                              <div className="font-mono text-xs break-all">{fm.hash}</div>
                            </>
                          )}
                        </div>

                        <div className="pt-2 border-t mt-2">
                          <div className="text-muted-foreground text-sm mb-1">Full URL:</div>
                          <div className="font-mono text-xs break-all bg-background p-2 rounded">
                            {fm.url || 'Not available'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            )}
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
  onMediaClick,
}: {
  message: Message;
  isFromCurrentUser: boolean;
  showSenderName?: boolean;
  devMode?: boolean;
  onMediaClick?: (fileMetadata: import('@/lib/dmTypes').FileMetadata, messageId: string) => void;
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
  const fileMetadata = message.fileMetadata;

  // Normalize to array for consistent handling
  const fileMetadataArray = Array.isArray(fileMetadata) ? fileMetadata : (fileMetadata ? [fileMetadata] : []);

  // Debug logging for multiple files
  if (isFileAttachment) {
    console.log('[MessageBubble] Kind 15 fileMetadata DEBUG:', {
      messageId: message.id,
      rawFileMetadata: fileMetadata,
      isArray: Array.isArray(fileMetadata),
      arrayLength: fileMetadataArray.length,
      files: fileMetadataArray.map(fm => ({ url: fm.url, mimeType: fm.mimeType })),
      eventTags: event.tags.filter(t => t[0] === 'imeta').map(t => t.slice(0, 3))
    });
  }

  // Check if it's an encrypted file attachment (use fileMetadata if available, otherwise parse tags)
  const hasEncryption = isFileAttachment && (
    fileMetadataArray.some(fm => fm.encryptionAlgorithm) ||
    event.tags.some(
      ([tagName]) => tagName === 'encryption-algorithm' || tagName === 'decryption-key'
    )
  );

  // Fetch sender profile for group chats
  const senderProfile = useAuthor(event.pubkey);
  const metadata = senderProfile.data?.metadata;
  const senderName = getDisplayName(event.pubkey, metadata);
  const senderColor = getPubkeyColor(event.pubkey);

  // The event is already the decrypted inner message (kind 4, 14, or 15)
  const messageEvent: NostrEvent = event;

  // Determine content rendering mode (mutually exclusive)
  const isDecryptionError = !!message.error;
  const hasFileMetadata = Array.isArray(fileMetadata) ? fileMetadata.length > 0 : !!fileMetadata;
  const isEncryptedMedia = !isDecryptionError && shouldRenderMedia && hasFileMetadata && isFileAttachment;
  const isRichContent = !isDecryptionError && !isEncryptedMedia && shouldRenderMedia;
  const isPlainText = !isDecryptionError && !isEncryptedMedia && !isRichContent;

  // For kind 15, content is just the user's caption (URLs are in imeta tags)
  const isAdditionalText = isEncryptedMedia && event.content.trim().length > 0;

  return (
    <div className={cn("flex", isFromCurrentUser ? "justify-end" : "justify-start")}>
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

        {isDecryptionError && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <p className="text-sm italic opacity-70 cursor-help">🔒 Failed to decrypt</p>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{message.error}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {isEncryptedMedia && (
          <div className="text-sm">
            {fileMetadataArray.map((fm, idx) => (
              <EncryptedMediaDisplay 
                key={idx} 
                fileMetadata={fm} 
                className="my-2" 
                onClick={() => onMediaClick?.(fm, event.id)}
              />
            ))}
            {isAdditionalText && (
              <div className="mt-2 whitespace-pre-wrap break-words">
                {event.content}
              </div>
            )}
          </div>
        )}

        {isRichContent && (
          <div className="text-sm">
            <NoteContent 
              event={messageEvent} 
              className="whitespace-pre-wrap break-words"
              onMediaClick={onMediaClick ? (url, messageId) => {
                // Create a FileMetadata object that matches what we put in mediaItems
                const fakeFileMetadata = {
                  url: url,
                  mimeType: /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url) ? 'image/unknown' : 'video/unknown',
                  name: url.split('/').pop() || 'media',
                } as import('@/lib/dmTypes').FileMetadata;
                onMediaClick(fakeFileMetadata, messageId);
              } : undefined}
            />
          </div>
        )}

        {isPlainText && (
          <p className="text-sm whitespace-pre-wrap break-words">{event.content}</p>
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
                    <p className="text-xs">Encrypted file</p>
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
          fileMetadata={fileMetadata}
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

  // For 2 people: split circle vertically with gap
  if (pubkeys.length === 2) {
    return (
      <div className="relative h-8 w-8 rounded-full overflow-hidden flex-shrink-0 bg-background">
        {pubkeys.slice(0, 2).map((pubkey, index) => {
          const author = authors[index];
          const metadata = author?.data?.metadata;
          const avatarUrl = metadata?.picture;
          const bgColor = getPubkeyColor(pubkey);

          return (
            <div
              key={pubkey}
              className="absolute inset-0"
              style={{ 
                left: index === 0 ? 0 : 'calc(50% + 0.75px)',
                width: 'calc(50% - 0.75px)'
              }}
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

  // For 3+ people: split into 4 quarters with gaps
  return (
    <div className="relative h-8 w-8 rounded-full overflow-hidden flex-shrink-0 bg-background">
      {pubkeys.slice(0, 4).map((pubkey, index) => {
        const author = authors[index];
        const metadata = author?.data?.metadata;
        const avatarUrl = metadata?.picture;
        const bgColor = getPubkeyColor(pubkey);

        const positions = [
          { top: 0, left: 0 }, // top-left
          { top: 0, left: 'calc(50% + 0.75px)' }, // top-right
          { top: 'calc(50% + 0.75px)', left: 0 }, // bottom-left
          { top: 'calc(50% + 0.75px)', left: 'calc(50% + 0.75px)' }, // bottom-right
        ];

        return (
          <div
            key={pubkey}
            className="absolute"
            style={{
              ...positions[index],
              width: 'calc(50% - 0.75px)',
              height: 'calc(50% - 0.75px)'
            }}
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
  const allParticipants = useMemo(() => DMLib.Conversation.parseConversationId(conversationId), [conversationId]);

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
  const rawRelayInfo = useMemo(() => getConversationRelays(conversationId), [getConversationRelays, conversationId]);

  // Get discovery relays for comparison
  const discoveryRelays = useMemo(() => new Set(config.discoveryRelays), [config.discoveryRelays]);

  // Sort relays logically:
  // 1. By number of users (most shared first)
  // 2. Within same count, discovery relays before individual relays
  // 3. Within same count and discovery status, current user's relays before others
  // 4. Finally, alphabetically by relay URL
  const relayInfo = useMemo(() => {
    return [...rawRelayInfo].sort((a, b) => {
      // Primary: Sort by number of users (descending - most shared first)
      if (b.users.length !== a.users.length) {
        return b.users.length - a.users.length;
      }

      // Secondary: Discovery relays come before non-discovery
      const aIsDiscovery = discoveryRelays.has(a.relay);
      const bIsDiscovery = discoveryRelays.has(b.relay);
      if (aIsDiscovery !== bIsDiscovery) {
        return aIsDiscovery ? -1 : 1;
      }

      // Tertiary: Current user's relays come before others
      const aHasCurrentUser = a.users.some(u => u.isCurrentUser);
      const bHasCurrentUser = b.users.some(u => u.isCurrentUser);
      if (aHasCurrentUser !== bHasCurrentUser) {
        return aHasCurrentUser ? -1 : 1;
      }

      // Final: Alphabetically by relay URL
      return a.relay.localeCompare(b.relay);
    });
  }, [rawRelayInfo, discoveryRelays]);

  // Get all participant pubkeys and fetch their metadata
  const otherParticipants = useMemo(() => {
    const participantPubkeys = DMLib.Conversation.parseConversationId(conversationId);
    return participantPubkeys.filter(pk => pk !== user?.pubkey);
  }, [conversationId, user?.pubkey]);

  const authorsData = useAuthorsBatch(otherParticipants);

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
                <li>Ask participants to update their relay lists</li>
                <li>Remove unreliable relays from your settings</li>
                <li>Ensure your internet connection</li>
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
                      <div className="flex items-start gap-3">
                        <div className="text-xs font-mono flex-1 min-w-0 break-all">
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

// Subject editing component for NIP-17 conversations
const SubjectEditor = ({
  subject,
  pendingSubject,
  setPendingSubject,
  hasNIP17,
}: {
  subject: string;
  pendingSubject: string | null;
  setPendingSubject: (subject: string | null) => void;
  hasNIP17: boolean;
}) => {
  const [isEditingSubject, setIsEditingSubject] = useState(false);
  const [editedSubject, setEditedSubject] = useState('');

  const handleEditSubject = () => {
    setEditedSubject(subject);
    setIsEditingSubject(true);
  };

  const handleSaveSubject = () => {
    const trimmedSubject = editedSubject.trim();
    setPendingSubject(trimmedSubject);
    setIsEditingSubject(false);
  };

  const handleCancelEditSubject = () => {
    setIsEditingSubject(false);
    setEditedSubject('');
  };

  if (isEditingSubject) {
    return (
      <div className="flex items-center gap-1 px-3 pb-1 h-[20px]">
        <input
          type="text"
          value={editedSubject}
          onChange={(e) => setEditedSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveSubject();
            if (e.key === 'Escape') handleCancelEditSubject();
          }}
          placeholder="Enter subject..."
          className="text-xs px-0 py-0 border-0 border-b rounded-none bg-transparent flex-1 min-w-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:border-primary"
          autoFocus
        />
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={handleSaveSubject}>
          <Check className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={handleCancelEditSubject}>
          ×
        </Button>
      </div>
    );
  }

  return (
    <>
      {(subject || pendingSubject !== null) && (
        <div className="flex items-center gap-1 px-3 pb-1 group h-[20px]">
          <p className={cn(
            "text-xs font-medium whitespace-nowrap",
            pendingSubject !== null ? "text-amber-500 italic" : "text-primary/80"
          )}>
            {pendingSubject !== null ? pendingSubject : subject}
          </p>
          {pendingSubject !== null && (
            <span className="text-xs text-amber-500/70">(pending)</span>
          )}
          <button
            onClick={handleEditSubject}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      )}
      {!subject && pendingSubject === null && hasNIP17 && (
        <button
          onClick={handleEditSubject}
          className="px-3 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <Pencil className="h-3 w-3" />
          Add subject
        </button>
      )}
    </>
  );
};

const ChatHeader = ({
  conversationId,
  onBack,
  pendingSubject,
  setPendingSubject,
  onToggleMediaPanel,
  showMediaPanel,
  onSearchInConversation
}: {
  conversationId: string;
  onBack?: () => void;
  pendingSubject: string | null;
  setPendingSubject: (subject: string | null) => void;
  onToggleMediaPanel?: () => void;
  showMediaPanel?: boolean;
  onSearchInConversation?: () => void;
}) => {
  const { user } = useCurrentUser();
  const { getConversationRelays, messagingState } = useNewDMContext();
  const [showRelayModal, setShowRelayModal] = useState(false);
  const [showParticipantModal, setShowParticipantModal] = useState(false);

  // Parse conversation participants
  const allParticipants = DMLib.Conversation.parseConversationId(conversationId);
  const conversationParticipants = allParticipants.filter(pk => pk !== user?.pubkey);

  // Get conversation metadata for subject
  const conversation = messagingState?.conversationMetadata[conversationId];
  const subject = conversation?.subject || '';

  // Track previous subject to detect changes from incoming messages
  const prevSubjectRef = useRef(subject);

  // Check if this is a self-messaging conversation
  const isSelfMessaging = conversationParticipants.length === 0;
  
  // Check if this is a group chat (3+ participants including current user)
  const isGroupChat = allParticipants.length >= 3;

  // For 1-on-1 chats, fetch the single participant's profile (or self if messaging yourself)
  const displayPubkey = isSelfMessaging ? user?.pubkey : conversationParticipants[0];
  const singleParticipant = useAuthor(displayPubkey || '');
  const metadata = singleParticipant.data?.metadata;

  // Derive display values
  const isMultiPerson = conversationParticipants.length > 1;
  // For header, show full npub if no metadata (plenty of space here)
  const baseName = metadata?.display_name || metadata?.name || (displayPubkey ? nip19.npubEncode(displayPubkey) : '');
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

  // Check if conversation has failed relays
  const hasFailedRelays = useMemo(() => {
    const relayInfo = getConversationRelays(conversationId);
    return relayInfo.some(({ relay }) => {
      const info = messagingState?.relayInfo[relay];
      return info && !info.lastQuerySucceeded;
    });
  }, [conversationId, getConversationRelays, messagingState]);

  // Clear pending subject if the actual subject changes (from incoming messages)
  useEffect(() => {
    // If subject changed from what it was before (not just different from pending)
    if (subject !== prevSubjectRef.current && pendingSubject !== null) {
      // Someone else changed the subject, clear our pending change
      setPendingSubject(null);
    }
    // Update the ref to track current subject
    prevSubjectRef.current = subject;
  }, [subject, pendingSubject, setPendingSubject]);

  return (
    <div className="px-4 py-4 border-b flex items-center gap-3 h-[80px]">
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

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <button
          onClick={() => setShowParticipantModal(true)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-help hover:bg-accent"
        >
          <ChatGroupAvatar pubkeys={isSelfMessaging ? [user!.pubkey] : isGroupChat ? allParticipants : conversationParticipants} />

          <div className="text-left flex-1">
            <h2 className="font-semibold text-sm whitespace-nowrap">
              {isMultiPerson ? <ParticipantNames pubkeys={conversationParticipants} /> : displayName}
            </h2>
            {subtitle && !subject && pendingSubject === null && (
              <p className="text-xs text-muted-foreground whitespace-nowrap">{subtitle}</p>
            )}
          </div>
        </button>

        {/* Subject editing for NIP-17 conversations */}
        <SubjectEditor
          subject={subject}
          pendingSubject={pendingSubject}
          setPendingSubject={setPendingSubject}
          hasNIP17={conversation?.hasNIP17 || false}
        />
      </div>

      <div className="flex items-center gap-1">
        {onSearchInConversation && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onSearchInConversation}
                >
                  <Search className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Search in conversation</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {onToggleMediaPanel && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleMediaPanel}
                  className={cn(showMediaPanel && "bg-accent")}
                >
                  <Images className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Media & Files</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

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
      </div>

      <ParticipantInfoModal
        open={showParticipantModal}
        onOpenChange={setShowParticipantModal}
        conversationId={conversationId}
      />

      <RelayInfoModal
        open={showRelayModal}
        onOpenChange={setShowRelayModal}
        conversationId={conversationId}
      />
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

export const NewDMChatArea = ({ conversationId, scrollToMessageId, onBack, onToggleMediaPanel, showMediaPanel, onSearchInConversation, className }: DMChatAreaProps) => {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { sendMessage, protocolMode, isLoading, markConversationAsRead } = useNewDMContext();
  const { messages, hasMoreMessages, loadEarlierMessages } = useConversationMessages(conversationId || '');

  const devMode = config.devMode ?? false;

  // Check if this is a group chat (3+ participants including current user)
  const allParticipants = conversationId ? DMLib.Conversation.parseConversationId(conversationId) : [];
  const isGroupChat = allParticipants.length >= 3;

  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pendingSubject, setPendingSubject] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [mediaItems, setMediaItems] = useState<Array<{
    fileMetadata: import('@/lib/dmTypes').FileMetadata;
    messageId: string;
    timestamp: number;
    displayUrl: string;
  }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  // Handle media click for lightbox
  const handleMediaClick = useCallback((fileMetadata: import('@/lib/dmTypes').FileMetadata) => {
    // For inline media, match by URL (message ID might not match due to message updates/duplicates)
    const index = mediaItems.findIndex(item => 
      item.fileMetadata.url === fileMetadata.url
    );
    
    if (index >= 0) {
      setLightboxIndex(index);
      setLightboxOpen(true);
    }
  }, [mediaItems]);

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

  useEffect(() => {
    if (selectedProtocol === MESSAGE_PROTOCOL.NIP04 && pendingFiles.length > 0) {
      setPendingFiles([]);
      toast({
        title: 'Files cleared',
        description: 'NIP-04 does not support file attachments. Please switch to NIP-17.',
        variant: 'destructive',
      });
    }
  }, [selectedProtocol, pendingFiles.length, toast]);

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

  // Scroll to specific message when coming from search or media panel
  useEffect(() => {
    if (!scrollToMessageId || !conversationId) return;

    const scrollAndHighlight = async () => {
      // Check if message is already loaded
      let messageElement = document.getElementById(`message-${scrollToMessageId}`);
      
      // If not found, load earlier messages until we find it
      if (!messageElement) {
        let attempts = 0;
        const maxAttempts = 20;
        
        while (hasMoreMessages && attempts < maxAttempts) {
          await loadEarlierMessages();
          attempts++;
          
          // Wait for DOM to update
          await new Promise(resolve => setTimeout(resolve, 150));
          
          messageElement = document.getElementById(`message-${scrollToMessageId}`);
          if (messageElement) break;
        }
      }

      // If we found the message, scroll to it
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Wait for scroll animation to complete (800ms), then highlight
        setTimeout(() => {
          setHighlightedMessageId(scrollToMessageId);
          
          // Remove highlight after 2 seconds
          setTimeout(() => {
            setHighlightedMessageId(null);
          }, 2000);
        }, 800);
      }
    };

    scrollAndHighlight();
  }, [scrollToMessageId, conversationId, hasMoreMessages, loadEarlierMessages]);

  // Mark conversation as read when opened
  useEffect(() => {
    if (conversationId) {
      const timeoutId = setTimeout(() => {
        markConversationAsRead(conversationId);
      }, 750);
      return () => clearTimeout(timeoutId);
    }
  }, [conversationId, markConversationAsRead]);

  // Collect all media items for lightbox
  useEffect(() => {
    const items: Array<{
      fileMetadata: import('@/lib/dmTypes').FileMetadata;
      messageId: string;
      timestamp: number;
      displayUrl: string;
    }> = [];

    messages.forEach((message) => {
      const addedUrls = new Set<string>(); // Track URLs to avoid duplicates

      // Handle encrypted file attachments (kind 15) first
      if (message.fileMetadata && message.fileMetadata.length > 0) {
        message.fileMetadata.forEach((fm) => {
          // Only include displayable media (images/videos)
          if (fm.mimeType?.startsWith('image/') || fm.mimeType?.startsWith('video/')) {
            items.push({
              fileMetadata: fm,
              messageId: message.id,
              timestamp: message.event.created_at,
              displayUrl: fm.url || '' // MediaLightbox will handle decryption
            });
            // Track this URL to avoid adding it again from content
            if (fm.url) {
              addedUrls.add(fm.url);
            }
          }
        });
      }

      // Handle inline media URLs from text content (only if not already added as encrypted file)
      const text = message.event.content;
      const urlRegex = /https?:\/\/[^\s]+/g;
      let match: RegExpExecArray | null;
      
      while ((match = urlRegex.exec(text)) !== null) {
        const url = match[0];
        
        // Skip if this URL was already added as an encrypted file
        if (addedUrls.has(url)) {
          continue;
        }
        
        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
        const isVideo = /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i.test(url);
        
        if (isImage || isVideo) {
          // Create a fake fileMetadata object for inline media
          const fakeFileMetadata = {
            url: url,
            mimeType: isImage ? 'image/unknown' : 'video/unknown',
            name: url.split('/').pop() || 'media',
          } as import('@/lib/dmTypes').FileMetadata;

          items.push({
            fileMetadata: fakeFileMetadata,
            messageId: message.id,
            timestamp: message.event.created_at,
            displayUrl: url
          });
        }
      }
    });

    setMediaItems(items);
  }, [messages]);


  const handleScrollToMessage = useCallback((messageId: string) => {
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const messageRect = messageElement.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop + messageRect.top - containerRect.top - 100;
        scrollContainer.scrollTo({ top: scrollTop, behavior: 'smooth' });
        
        // Highlight the message briefly
        setHighlightedMessageId(messageId);
        setTimeout(() => setHighlightedMessageId(null), 2000);
      }
    }
  }, []);

  const handleSend = useCallback(async () => {
    if ((!messageText.trim() && pendingFiles.length === 0) || !conversationId || !user) return;

    if (selectedProtocol === MESSAGE_PROTOCOL.NIP04 && pendingFiles.length > 0) {
      toast({
        title: 'File attachments not supported',
        description: 'NIP-04 does not support file attachments. Please switch to NIP-17.',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      const attachments: FileAttachment[] = [];

      if (pendingFiles.length > 0 && selectedProtocol === MESSAGE_PROTOCOL.NIP17) {
        for (const file of pendingFiles) {
          try {
            if (!isMediaFile(file)) {
              toast({
                title: 'Invalid file type',
                description: `${file.name} is not a supported media file. Only images, videos, and audio files are supported.`,
                variant: 'destructive',
              });
              continue;
            }

            const result = await uploadFile({ file, encrypt: true });
            console.log('[NewDMChatArea] Upload result:', { result, type: typeof result, hasUrl: typeof result !== 'string' && 'url' in result });
            if (typeof result !== 'string' && 'url' in result) {
              attachments.push(result);
            } else {
              console.error('[NewDMChatArea] Upload returned unexpected format:', result);
              toast({
                title: 'Upload failed',
                description: `Upload returned unexpected format for ${file.name}`,
                variant: 'destructive',
              });
            }
          } catch (error) {
            console.error('[NewDMChatArea] Failed to upload file:', error);
            toast({
              title: 'Upload failed',
              description: `Failed to upload ${file.name}. Please try again.`,
              variant: 'destructive',
            });
          }
        }
      }

      // Prevent sending empty message if files were selected but none succeeded
      if (pendingFiles.length > 0 && attachments.length === 0 && !messageText.trim()) {
        toast({
          title: 'Cannot send message',
          description: 'No files were successfully uploaded. Please check the file types and try again.',
          variant: 'destructive',
        });
        setIsSending(false);
        return;
      }

      console.log('[NewDMChatArea] Sending message with attachments:', { attachmentsCount: attachments.length, attachments });

      await sendMessage({
        recipientPubkey: conversationId,
        content: messageText.trim(),
        protocol: selectedProtocol,
        attachments,
        subject: pendingSubject !== null ? pendingSubject : undefined,
      });
      setMessageText('');
      setPendingFiles([]);
      setPendingSubject(null);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  }, [messageText, conversationId, user, sendMessage, selectedProtocol, pendingSubject, pendingFiles, uploadFile, toast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const mediaFiles = files.filter(isMediaFile);

    if (mediaFiles.length !== files.length) {
      toast({
        title: 'Invalid file type',
        description: 'Only images, videos, and audio files are supported',
        variant: 'destructive',
      });
    }

    if (mediaFiles.length > 0) {
      setPendingFiles(prev => [...prev, ...mediaFiles]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [toast]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (selectedProtocol === MESSAGE_PROTOCOL.NIP04) {
      toast({
        title: 'File attachments not supported',
        description: 'NIP-04 does not support file attachments. Please switch to NIP-17.',
        variant: 'destructive',
      });
      return;
    }

    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length > 0) {
      e.preventDefault();
      try {
        const filePromises = imageItems.map(item => {
          const file = item.getAsFile();
          return file ? Promise.resolve(file) : Promise.reject(new Error('Failed to get file'));
        });

        const files = await Promise.all(filePromises);
        setPendingFiles(prev => [...prev, ...files]);
      } catch {
        toast({
          title: 'Paste failed',
          description: 'Failed to paste image. Please try again.',
          variant: 'destructive',
        });
      }
    }
  }, [selectedProtocol, toast]);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

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
      <ChatHeader
        conversationId={conversationId}
        onBack={onBack}
        pendingSubject={pendingSubject}
        setPendingSubject={setPendingSubject}
        onToggleMediaPanel={onToggleMediaPanel}
        showMediaPanel={showMediaPanel}
        onSearchInConversation={onSearchInConversation}
      />

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
            {messages.map((message: Message) => {
              const isHighlighted = highlightedMessageId === message.id;
              return (
                <div
                  key={message.giftWrapId || message.id}
                  id={`message-${message.id}`}
                  className="mb-3"
                >
                  <div
                    className={cn(
                      "p-1.5 rounded-lg transition-all duration-300",
                      isHighlighted && "bg-primary/35"
                    )}
                  >
                    <MessageBubble
                      message={message}
                      isFromCurrentUser={message.event.pubkey === user.pubkey}
                      showSenderName={isGroupChat}
                      devMode={devMode}
                      onMediaClick={handleMediaClick}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t">
        {/* File previews */}
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingFiles.map((file, index) => {
              const fileUrl = URL.createObjectURL(file);
              const isImage = file.type.startsWith('image/');
              const isVideo = file.type.startsWith('video/');

              return (
                <div key={index} className="relative group">
                  {isImage ? (
                    <div
                      className="relative w-20 h-20 rounded-lg overflow-hidden border"
                      style={{
                        backgroundImage: `
                          linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
                          linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
                          linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)
                        `,
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                        backgroundColor: '#ffffff',
                      }}
                    >
                      <img
                        src={fileUrl}
                        alt={file.name}
                        className="w-full h-full object-cover"
                        onLoad={() => URL.revokeObjectURL(fileUrl)}
                      />
                      <button
                        onClick={() => removePendingFile(index)}
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : isVideo ? (
                    <VideoThumbnail file={file} onRemove={() => removePendingFile(index)} />
                  ) : (
                    <div className="relative w-20 h-20 rounded-lg border bg-muted flex items-center justify-center">
                      <Paperclip className="h-6 w-6 text-muted-foreground" />
                      <button
                        onClick={() => removePendingFile(index)}
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1 flex flex-col gap-2">
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              className="min-h-[80px] resize-none"
              disabled={isSending || isUploading}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSending || isUploading || selectedProtocol === MESSAGE_PROTOCOL.NIP04}
                      className="h-[44px] w-[44px]"
                    >
                      <Paperclip className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  {selectedProtocol === MESSAGE_PROTOCOL.NIP04 && (
                    <TooltipContent>
                      <p className="text-xs">File attachments require NIP-17</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
              <Button
                onClick={handleSend}
                disabled={(!messageText.trim() && pendingFiles.length === 0) || isSending || isUploading}
                size="icon"
                className="h-[44px] w-[44px]"
              >
                {isSending || isUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
            <Select
              value={selectedProtocol}
              onValueChange={(value) => setSelectedProtocol(value as MessageProtocol)}
              disabled={!allowSelection || isSending || isUploading}
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

      <MediaLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        mediaItems={mediaItems}
        currentIndex={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onScrollToMessage={handleScrollToMessage}
      />
    </div>
  );
};
