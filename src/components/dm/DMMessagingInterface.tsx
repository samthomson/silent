import { useState, useCallback, useRef } from 'react';
import { DMConversationList } from '@/components/dm/DMConversationList';
import { DMChatArea } from '@/components/dm/DMChatArea';
import { ConversationMediaPanel } from '@/components/dm/ConversationMediaPanel';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

interface DMMessagingInterfaceProps {
  className?: string;
  onStatusClick?: () => void;
}

export const DMMessagingInterface = ({ className, onStatusClick }: DMMessagingInterfaceProps) => {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>(undefined);
  const [showMediaPanel, setShowMediaPanel] = useState(false);
  const [filterConversationId, setFilterConversationId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // On mobile, show only one panel at a time
  const showConversationList = !isMobile || !selectedConversationId;
  const showChatArea = !isMobile || selectedConversationId;

  const handleSelectConversation = useCallback((conversationId: string, messageId?: string) => {
    setSelectedConversationId(conversationId);
    setScrollToMessageId(messageId);
    setShowMediaPanel(false); // Close media panel when switching conversations
  }, []);

  const handleBack = useCallback(() => {
    setSelectedConversationId(null);
    setShowMediaPanel(false);
  }, []);

  const handleToggleMediaPanel = useCallback(() => {
    setShowMediaPanel(prev => !prev);
  }, []);

  const handleSelectMessageFromMedia = useCallback((messageId: string) => {
    setScrollToMessageId(messageId);
    // Only close panel on mobile
    if (isMobile) {
      setShowMediaPanel(false);
    }
  }, [isMobile]);

  const handleSearchInConversation = useCallback(() => {
    // Set the filter to the current conversation
    setFilterConversationId(selectedConversationId);
    // Focus the search input in the conversation list
    searchInputRef.current?.focus();
    searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedConversationId]);

  const handleClearFilter = useCallback(() => {
    setFilterConversationId(null);
  }, []);

  return (
    <div className={cn("flex overflow-hidden h-full", className)}>
      {/* Conversation List - Left Sidebar */}
      <div className={cn(
        "md:w-[360px] md:flex-shrink-0",
        isMobile && !showConversationList && "hidden",
        isMobile && showConversationList && "w-full"
      )}>
        <DMConversationList
          selectedPubkey={selectedConversationId}
          onSelectConversation={handleSelectConversation}
          className="h-full"
          onStatusClick={onStatusClick}
          searchInputRef={searchInputRef}
          filterConversationId={filterConversationId}
          onClearFilter={handleClearFilter}
        />
      </div>

      {/* Chat Area - Center Panel */}
      <div className={cn(
        "flex-1 md:min-w-0",
        isMobile && !showChatArea && "hidden",
        isMobile && showChatArea && "w-full"
      )}>
        <DMChatArea
          conversationId={selectedConversationId}
          scrollToMessageId={scrollToMessageId}
          onBack={isMobile ? handleBack : undefined}
          onToggleMediaPanel={handleToggleMediaPanel}
          showMediaPanel={showMediaPanel}
          onSearchInConversation={handleSearchInConversation}
          className="h-full"
        />
      </div>

      {/* Media Panel - Desktop: Right Sidebar, Mobile: Dialog Modal */}
      {showMediaPanel && selectedConversationId && (
        <>
          {isMobile ? (
            <ConversationMediaPanel
              conversationId={selectedConversationId}
              onSelectMessage={handleSelectMessageFromMedia}
              open={showMediaPanel}
              onOpenChange={setShowMediaPanel}
            />
          ) : (
            <div className="w-[320px] flex-shrink-0">
              <ConversationMediaPanel
                conversationId={selectedConversationId}
                onSelectMessage={handleSelectMessageFromMedia}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

