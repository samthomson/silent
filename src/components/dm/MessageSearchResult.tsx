import { memo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useNewDMContext } from '@/contexts/NewDMContext';
import { getDisplayName } from '@/lib/genUserName';
import { formatConversationTime, getPubkeyColor } from '@samthomson/nostr-messaging/core';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { MessageSearchResult as MessageSearchResultType } from '@/contexts/NewDMContext';

interface MessageSearchResultProps {
  result: MessageSearchResultType;
  onClick: () => void;
  isSelected?: boolean;
}

const MessageSearchResultComponent = ({ result, onClick, isSelected }: MessageSearchResultProps) => {
  const { user } = useCurrentUser();
  const { messagingState } = useNewDMContext();
  const { message, conversationId } = result;

  // Get conversation metadata to show context
  const conversation = messagingState?.conversationMetadata[conversationId];
  
  // Get sender info
  const senderPubkey = message.senderPubkey || message.event.pubkey;
  const sender = useAuthor(senderPubkey);
  const senderMetadata = sender.data?.metadata;
  const senderName = getDisplayName(senderPubkey, senderMetadata);
  const senderAvatar = senderMetadata?.picture;
  const senderInitials = senderName.slice(0, 2).toUpperCase();
  const senderBgColor = getPubkeyColor(senderPubkey);

  // Get conversation context (who this message is with)
  const otherParticipants = conversation?.participantPubkeys.filter(pk => pk !== user?.pubkey) || [];
  const otherParticipant = useAuthor(otherParticipants[0] || ''); // Fetch first participant
  
  const conversationContext = (() => {
    if (!conversation) return 'Unknown conversation';
    
    // Self-messaging
    if (otherParticipants.length === 0) {
      return 'You (self-messaging)';
    }
    
    // 1-on-1
    if (otherParticipants.length === 1) {
      return `with ${getDisplayName(otherParticipants[0], otherParticipant.data?.metadata)}`;
    }
    
    // Group
    return `in group (${otherParticipants.length + 1} people)`;
  })();

  // Truncate message content for preview
  const messagePreview = message.event.content.length > 100
    ? message.event.content.substring(0, 100) + '...'
    : message.event.content;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-all duration-300 hover:bg-accent block overflow-hidden",
        isSelected && "bg-accent"
      )}
    >
      <div className="flex items-start gap-3 max-w-full">
        <Avatar className="h-10 w-10 flex-shrink-0">
          <AvatarImage src={senderAvatar} alt={senderName} />
          <AvatarFallback className="text-white" style={{ backgroundColor: senderBgColor }}>
            {senderInitials}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="font-medium text-sm truncate">{senderName}</span>
              <span className="text-xs text-muted-foreground truncate">{conversationContext}</span>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
              {formatConversationTime(message.event.created_at)}
            </span>
          </div>

          <p className="text-sm text-muted-foreground truncate">
            {messagePreview}
          </p>
        </div>
      </div>
    </button>
  );
};

export const MessageSearchResult = memo(MessageSearchResultComponent);
MessageSearchResult.displayName = 'MessageSearchResult';

