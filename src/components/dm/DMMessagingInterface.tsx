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
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const isMobile = useIsMobile();

  // On mobile, show only one panel at a time
  const showConversationList = !isMobile || !selectedPubkey;
  const showChatArea = !isMobile || selectedPubkey;

  const handleSelectConversation = useCallback((pubkey: string) => {
    setSelectedPubkey(pubkey);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedPubkey(null);
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
          selectedPubkey={selectedPubkey}
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
          pubkey={selectedPubkey}
          onBack={isMobile ? handleBack : undefined}
          className="h-full"
        />
      </div>
    </div>
  );
};

