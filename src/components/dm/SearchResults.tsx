import { useMemo, useState, useEffect } from 'react';
import { useDMContext } from '@/contexts/DMProviderWrapper';
import { ConversationSearchResult } from './ConversationSearchResult';
import { MessageSearchResult } from './MessageSearchResult';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SearchResultsProps {
  query: string;
  onSelectConversation: (conversationId: string, messageId?: string) => void;
  filterConversationId?: string | null;
  selectedPubkey?: string | null;
}

export const SearchResults = ({ query, onSelectConversation, filterConversationId, selectedPubkey }: SearchResultsProps) => {
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // Clear highlight after 2 seconds
  useEffect(() => {
    if (highlightedMessageId) {
      const timer = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightedMessageId]);
  const { searchMessages, searchConversations } = useDMContext();

  const messageResults = useMemo(() => {
    const results = searchMessages(query, filterConversationId || undefined);
    // Sort by newest first (highest timestamp first)
    return results.sort((a, b) => b.message.event.created_at - a.message.event.created_at);
  }, [query, filterConversationId, searchMessages]);
  
  const conversationResults = useMemo(() => {
    // If filtering by conversation, don't show conversation results
    if (filterConversationId) return [];
    return searchConversations(query);
  }, [query, filterConversationId, searchConversations]);

  const hasAnyResults = messageResults.length > 0 || conversationResults.length > 0;

  if (!query.trim()) {
    return null;
  }

  return (
    <ScrollArea className="h-full block">
      <div className="block w-full px-2 py-2">
        {!hasAnyResults && (
          <div className="flex items-center justify-center h-32 text-center text-muted-foreground px-4">
            <p className="text-sm">No results found for "{query}"</p>
          </div>
        )}

        {/* Conversations Section */}
        {conversationResults.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-2">
              Chats
            </h3>
            <div className="space-y-1">
              {conversationResults.slice(0, 10).map((result) => (
                <ConversationSearchResult
                  key={result.conversationId}
                  result={result}
                  onClick={() => onSelectConversation(result.conversationId)}
                  isSelected={selectedPubkey === result.conversationId}
                />
              ))}
            </div>
          </div>
        )}

        {/* Messages Section */}
        {messageResults.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-2">
              Messages
            </h3>
            <div className="space-y-1">
              {messageResults.slice(0, 50).map((result) => (
                <MessageSearchResult
                  key={result.message.id}
                  result={result}
                  onClick={() => {
                    setHighlightedMessageId(result.message.id);
                    onSelectConversation(result.conversationId, result.message.id);
                  }}
                  isSelected={highlightedMessageId === result.message.id}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};
