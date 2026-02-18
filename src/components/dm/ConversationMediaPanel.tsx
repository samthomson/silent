import { useState, useMemo } from 'react';
import { useConversationMessages } from '@/contexts/NewDMContext';
import { useConversationMedia } from '@/hooks/useConversationMedia';
import { EncryptedMediaDisplay } from '@/components/dm/EncryptedMediaDisplay';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExternalLink, FileText, Image as ImageIcon, Play } from 'lucide-react';
import { formatConversationTime, isDisplayableMediaType } from '@samthomson/nostr-messaging/core';
import { cn } from '@/lib/utils';
import type { FileMetadata } from '@samthomson/nostr-messaging/core';

interface ConversationMediaPanelProps {
  conversationId: string;
  onSelectMessage?: (messageId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Video thumbnail component for sidebar - no controls, just a play icon overlay
const VideoThumbnail = ({ fileMetadata }: { fileMetadata: FileMetadata }) => {
  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <EncryptedMediaDisplay 
        fileMetadata={fileMetadata} 
        showVideoControls={false}
        isSidebar={true}
        className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover [&_video]:pointer-events-none"
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg">
          <Play className="h-4 w-4 text-black ml-0.5 fill-black" />
        </div>
      </div>
    </div>
  );
};


export const ConversationMediaPanel = ({ conversationId, onSelectMessage, open, onOpenChange }: ConversationMediaPanelProps) => {
  const { messages } = useConversationMessages(conversationId);
  const { media, links, docs } = useConversationMedia(messages);
  
  // Check if all categories are empty
  const hasNoContent = media.length === 0 && links.length === 0 && docs.length === 0;
  
  // Find the default tab with content
  const defaultTab = media.length > 0 ? 'media' : links.length > 0 ? 'links' : 'docs';
  const [activeTab, setActiveTab] = useState<'media' | 'links' | 'docs'>(defaultTab);
  
  // Create a map of messages for quick lookup
  const messageMap = useMemo(() => {
    const map = new Map();
    messages.forEach(msg => map.set(msg.id, msg));
    return map;
  }, [messages]);

  const panelContent = hasNoContent ? (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center text-muted-foreground px-4">
        <p className="text-sm">No media, links, or documents found in this conversation</p>
      </div>
    </div>
  ) : (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col min-h-0">
      <TabsList className="w-full grid grid-cols-3 rounded-none border-b h-auto p-0 bg-transparent">
        <TabsTrigger 
          value="media" 
          disabled={media.length === 0}
          className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary py-3 bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ImageIcon className="h-4 w-4 mr-2" />
          Media ({media.length})
        </TabsTrigger>
        <TabsTrigger 
          value="links" 
          disabled={links.length === 0}
          className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary py-3 bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Links ({links.length})
        </TabsTrigger>
        <TabsTrigger 
          value="docs" 
          disabled={docs.length === 0}
          className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary py-3 bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FileText className="h-4 w-4 mr-2" />
          Docs ({docs.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="media" className="flex-1 m-0 overflow-hidden">
        <ScrollArea className="h-full">
          {media.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-center text-muted-foreground px-4">
              <p className="text-sm">No media in this conversation</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 p-3">
              {media.map((item, index) => {
                const message = messageMap.get(item.messageId);
                if (!message?.fileMetadata) {
                  // Plain URL in content - show as image
                  return (
                    <button
                      key={`${item.messageId}-${index}`}
                      onClick={() => onSelectMessage?.(item.messageId)}
                      className="aspect-square bg-primary/10 rounded-sm overflow-hidden hover:opacity-80 transition-opacity relative"
                    >
                      <div 
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          backgroundImage: `
                            linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
                            linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
                            linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
                            linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)
                          `,
                          backgroundSize: '8px 8px',
                          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                          backgroundColor: '#ffffff'
                        }}
                      />
                      <img 
                        src={item.url} 
                        alt="" 
                        className="w-full h-full object-cover relative z-10"
                        loading="lazy"
                      />
                    </button>
                  );
                }
                
                // Encrypted media - use proper component
                const fileMetadataArray = Array.isArray(message.fileMetadata) 
                  ? message.fileMetadata 
                  : [message.fileMetadata];
                const fileMetadata = fileMetadataArray.find(fm => fm.url === item.url);
                
                if (!fileMetadata) return null;
                
                const isDisplayable = isDisplayableMediaType(fileMetadata.mimeType, fileMetadata.url);
                const isVideo = fileMetadata.mimeType?.startsWith('video/');
                
                // For unsupported files (HEIC, unsupported videos, etc.), show as tile using EncryptedMediaDisplay
                if (!isDisplayable) {
                  return (
                    <button
                      key={`${item.messageId}-${index}`}
                      onClick={() => onSelectMessage?.(item.messageId)}
                      className="aspect-square rounded-sm overflow-hidden hover:opacity-80 transition-opacity relative"
                    >
                      <EncryptedMediaDisplay 
                        fileMetadata={fileMetadata}
                        isSidebar={true}
                        className="w-full h-full"
                      />
                    </button>
                  );
                }
                
                return (
                  <button
                    key={`${item.messageId}-${index}`}
                    onClick={() => onSelectMessage?.(item.messageId)}
                    className="aspect-square bg-primary/10 rounded-sm overflow-hidden hover:opacity-80 transition-opacity relative"
                  >
                    <div 
                      className="absolute inset-0 pointer-events-none z-0"
                      style={{
                        backgroundImage: `
                          linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
                          linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
                          linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)
                        `,
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                        backgroundColor: '#ffffff'
                      }}
                    />
                    <div className="w-full h-full relative z-10">
                      {isVideo ? (
                        <VideoThumbnail fileMetadata={fileMetadata} />
                      ) : (
                        <EncryptedMediaDisplay 
                          fileMetadata={fileMetadata}
                          isSidebar={true}
                          className="w-full h-full [&_img]:w-full [&_img]:h-full [&_img]:object-cover"
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </TabsContent>

        <TabsContent value="links" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            {links.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-center text-muted-foreground px-4">
                <p className="text-sm">No links in this conversation</p>
              </div>
            ) : (
              <div className="divide-y">
                {links.map((item, index) => (
                  <button
                    key={`${item.messageId}-${index}`}
                    onClick={() => onSelectMessage?.(item.messageId)}
                    className={cn(
                      "w-full px-4 py-3 text-left hover:bg-accent transition-colors flex items-start gap-3"
                    )}
                  >
                    <ExternalLink className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate text-primary hover:underline">{item.url}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatConversationTime(item.timestamp)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="docs" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            {docs.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-center text-muted-foreground px-4">
                <p className="text-sm">No documents in this conversation</p>
              </div>
            ) : (
              <div className="divide-y">
                {docs.map((item, index) => (
                  <button
                    key={`${item.messageId}-${index}`}
                    onClick={() => onSelectMessage?.(item.messageId)}
                    className={cn(
                      "w-full px-4 py-3 text-left hover:bg-accent transition-colors flex items-start gap-3"
                    )}
                  >
                    <FileText className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.filename || 'Document'}</p>
                      {item.mimeType && (
                        <p className="text-xs text-muted-foreground">{item.mimeType}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatConversationTime(item.timestamp)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
      </TabsContent>
    </Tabs>
  );

  // Modal view (for screens < xl breakpoint)
  if (open !== undefined) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl w-[95vw] h-[85vh] max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-4 border-b flex-shrink-0">
            <DialogTitle>Media & Files</DialogTitle>
          </DialogHeader>
          {panelContent}
        </DialogContent>
      </Dialog>
    );
  }

  // Desktop: Side panel
  return (
    <div className="h-full flex flex-col border-l bg-background">
      <div className="px-4 py-4 border-b h-[80px] flex items-center">
        <h3 className="font-semibold">Media & Files</h3>
      </div>
      {panelContent}
    </div>
  );
};

