import { ReactNode } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useNetworkState } from '@/hooks/useNetworkState';
import { useToast } from '@/hooks/useToast';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useFollows } from '@/hooks/useFollows';
import { getDisplayName } from '@/lib/genUserName';
import {
  DMProvider,
  useDMContext,
  useConversationMessages,
  type DMProviderDeps,
  type MessageSearchResult,
  type ConversationSearchResult,
} from '@samthomson/nostr-messaging/core';
import type { MessagingState, Conversation, MessagingConfig } from '@samthomson/nostr-messaging/core';

// Re-export hooks and types for use in Silent
export { useDMContext, useConversationMessages };
export type { MessageSearchResult, ConversationSearchResult, MessagingState, Conversation };

interface DMProviderWrapperProps {
  children: ReactNode;
}

export const DMProviderWrapper = ({ children }: DMProviderWrapperProps) => {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { isOnline, wasOffline } = useNetworkState();
  const { toast } = useToast();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { mutateAsync: uploadFile } = useUploadFile();
  const isMobile = useIsMobile();
  const { data: follows = [] } = useFollows();

  const deps: DMProviderDeps = {
    nostr,
    user: user ?? null,
    discoveryRelays: config.discoveryRelays,
    relayMode: config.relayMode,
    isOnline,
    wasOffline,
    onNotify: (opts) => toast(opts),
    getDisplayName,
    fetchAuthorsBatch: useAuthorsBatch,
    publishEvent: async (event) => {
      await publishEvent(event);
    },
    uploadFile: async (file: File) => {
      const tags = await uploadFile(file);
      return tags[0][1]; // Return URL from first tag
    },
    isMobile,
    follows,
    appConfig: config as unknown as MessagingConfig & Record<string, unknown>,
  };

  return (
    <DMProvider deps={deps} config={{ ui: { showShorts: true } }}>
      {children}
    </DMProvider>
  );
};
