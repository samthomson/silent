import { memo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { getDisplayName } from '@/lib/genUserName';
import { GroupAvatar } from '@/components/dm/GroupAvatar';
import { cn } from '@/lib/utils';
import type { ConversationSearchResult as ConversationSearchResultType } from '@/contexts/NewDMProviderWrapper';

interface ConversationSearchResultProps {
  result: ConversationSearchResultType;
  onClick: () => void;
  isSelected?: boolean;
}

const ConversationSearchResultComponent = ({ result, onClick, isSelected }: ConversationSearchResultProps) => {
  const { user } = useCurrentUser();
  const { participantPubkeys } = result;

  // Check if this is a self-messaging conversation
  const isSelfMessaging = participantPubkeys.length === 1 && participantPubkeys[0] === user?.pubkey;

  // Fetch profile data for participants
  const firstParticipant = useAuthor(participantPubkeys[0] || '');
  const secondParticipant = useAuthor(participantPubkeys[1] || '');
  
  const firstMetadata = firstParticipant.data?.metadata;

  const conversationDisplayName = (() => {
    // Self-messaging conversation
    if (isSelfMessaging) {
      const selfName = getDisplayName(user?.pubkey || '', firstMetadata);
      return `${selfName} (You)`;
    }

    // If only one other person, show their name (1-on-1)
    if (participantPubkeys.length === 1) {
      return getDisplayName(participantPubkeys[0], firstMetadata);
    }

    // Multiple people - show first 2 names + remaining count
    const firstName = getDisplayName(participantPubkeys[0], firstMetadata);
    const secondName = getDisplayName(participantPubkeys[1], secondParticipant.data?.metadata);

    if (participantPubkeys.length === 2) {
      return `${firstName}, ${secondName}`;
    } else {
      const remaining = participantPubkeys.length - 2;
      return `${firstName}, ${secondName}, +${remaining}`;
    }
  })();

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-colors hover:bg-accent block overflow-hidden",
        isSelected && "bg-accent"
      )}
    >
      <div className="flex items-start gap-3 max-w-full">
        <GroupAvatar pubkeys={participantPubkeys} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm truncate">{conversationDisplayName}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Conversation
          </p>
        </div>
      </div>
    </button>
  );
};

export const ConversationSearchResult = memo(ConversationSearchResultComponent);
ConversationSearchResult.displayName = 'ConversationSearchResult';

