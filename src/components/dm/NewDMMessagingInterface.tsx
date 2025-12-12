import { useState, useCallback } from 'react';
import { NewDMConversationList } from '@/components/dm/NewDMConversationList';
import { NewDMChatArea } from '@/components/dm/NewDMChatArea';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

interface DMMessagingInterfaceProps {
  className?: string;
  onStatusClick?: () => void;
}

export const NewDMMessagingInterface = ({ className, onStatusClick }: DMMessagingInterfaceProps) => {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  // On mobile, show only one panel at a time
  const showConversationList = !isMobile || !selectedConversationId;
  const showChatArea = !isMobile || selectedConversationId;

  const handleSelectConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedConversationId(null);
  }, []);

  return (
    <div className={cn("flex overflow-hidden h-full", className)}>
      {/* Conversation List - Left Sidebar */}
      <div className={cn(
        "md:w-[360px] md:flex-shrink-0",
        isMobile && !showConversationList && "hidden",
        isMobile && showConversationList && "w-full"
      )}>
        <NewDMConversationList
          selectedPubkey={selectedConversationId}
          onSelectConversation={handleSelectConversation}
          className="h-full"
          onStatusClick={onStatusClick}
        />
      </div>

      {/* Chat Area - Right Panel */}
      <div className={cn(
        "flex-1 md:min-w-0",
        isMobile && !showChatArea && "hidden",
        isMobile && showChatArea && "w-full"
      )}>
        <NewDMChatArea
          conversationId={selectedConversationId}
          onBack={isMobile ? handleBack : undefined}
          className="h-full"
        />
      </div>
    </div>
  );
};

