import { ReactNode } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useNetworkState } from '@/hooks/useNetworkState';
import { useToast } from '@/hooks/useToast';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { getDisplayName } from '@/lib/genUserName';
import { 
  NewDMProvider, 
  useNewDMContext, 
  useConversationMessages, 
  type NewDMProviderDeps,
  type MessageSearchResult,
  type ConversationSearchResult,
} from '@samthomson/nostr-messaging/react';
import type { MessagingState, Conversation } from '@samthomson/nostr-messaging/core';

// Re-export hooks and types for use in Silent
export { useNewDMContext, useConversationMessages };
export type { MessageSearchResult, ConversationSearchResult, MessagingState, Conversation };

interface NewDMProviderWrapperProps {
  children: ReactNode;
}

export const NewDMProviderWrapper = ({ children }: NewDMProviderWrapperProps) => {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config, updateConfig } = useAppContext();
  const { isOnline, wasOffline } = useNetworkState();
  const { toast } = useToast();
  const authorsBatch = useAuthorsBatch;
  const { mutateAsync: publishEvent } = useNostrPublish();

  const deps: NewDMProviderDeps = {
    nostr,
    user,
    discoveryRelays: config.discoveryRelays,
    relayMode: config.relayMode,
    updateConfig,
    isOnline,
    wasOffline,
    toast,
    getDisplayName,
    fetchAuthorsBatch: authorsBatch,
    publishEvent,
  };

  return (
    <NewDMProvider deps={deps}>
      {children}
    </NewDMProvider>
  );
};
