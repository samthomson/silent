import { useState, useCallback } from 'react';
import { DMConversationList } from '@/components/dm/DMConversationList';
import { DMChatArea } from '@/components/dm/DMChatArea';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

interface DMMessagingInterfaceProps {
  className?: string;
  onStatusClick?: () => void;
}

export const DMMessagingInterface = ({ className, onStatusClick }: DMMessagingInterfaceProps) => {
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
    <div className={cn("flex gap-4 overflow-hidden h-full", className)}>
      {/* Conversation List - Left Sidebar */}
      <div className={cn(
        "md:w-80 md:flex-shrink-0",
        isMobile && !showConversationList && "hidden",
        isMobile && showConversationList && "w-full"
      )}>
        <DMConversationList
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
        <DMChatArea
          conversationId={selectedConversationId}
          onBack={isMobile ? handleBack : undefined}
          className="h-full"
        />
      </div>
    </div>
  );
};

