import { useMemo } from 'react';
import type { Message } from '@samthomson/nostr-messaging/core';
import { isImageUrl, isVideoUrl, isAudioUrl, isDocUrl } from '@samthomson/nostr-messaging/core';

export interface MediaItem {
  messageId: string;
  url: string;
  mimeType?: string;
  timestamp: number;
}

export interface LinkItem {
  messageId: string;
  url: string;
  timestamp: number;
}

export interface DocItem {
  messageId: string;
  url: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  timestamp: number;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

export function useConversationMedia(messages: Message[]) {
  const { media, links, docs } = useMemo(() => {
    const mediaItems: MediaItem[] = [];
    const linkItems: LinkItem[] = [];
    const docItems: DocItem[] = [];

    for (const message of messages) {
      const event = message.event;
      
      // Check for file attachments (kind 15)
      if (event.kind === 15 && message.fileMetadata) {
        const fileMetadataArray = Array.isArray(message.fileMetadata) 
          ? message.fileMetadata 
          : [message.fileMetadata];
        
        for (const fm of fileMetadataArray) {
          if (!fm.url) continue;
          
          const mimeType = fm.mimeType || '';
          
          // Categorize by MIME type
          if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
            mediaItems.push({
              messageId: message.id,
              url: fm.url,
              mimeType: fm.mimeType,
              timestamp: event.created_at,
            });
          } else {
            docItems.push({
              messageId: message.id,
              url: fm.url,
              filename: fm.url.split('/').pop(),
              mimeType: fm.mimeType,
              size: fm.size,
              timestamp: event.created_at,
            });
          }
        }
      }
      
      // Extract URLs from message content
      const urls = event.content.match(URL_REGEX) || [];
      
      for (const url of urls) {
        if (isImageUrl(url) || isVideoUrl(url) || isAudioUrl(url)) {
          mediaItems.push({
            messageId: message.id,
            url,
            timestamp: event.created_at,
          });
        } else if (isDocUrl(url)) {
          docItems.push({
            messageId: message.id,
            url,
            filename: url.split('/').pop()?.split('?')[0],
            timestamp: event.created_at,
          });
        } else {
          linkItems.push({
            messageId: message.id,
            url,
            timestamp: event.created_at,
          });
        }
      }
    }

    // Sort by timestamp (newest first)
    mediaItems.sort((a, b) => b.timestamp - a.timestamp);
    linkItems.sort((a, b) => b.timestamp - a.timestamp);
    docItems.sort((a, b) => b.timestamp - a.timestamp);

    return { media: mediaItems, links: linkItems, docs: docItems };
  }, [messages]);

  return { media, links, docs };
}

