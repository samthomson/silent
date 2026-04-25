import { ReactNode } from 'react';
import { nip19 } from 'nostr-tools';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useFollows } from '@/hooks/useFollows';
import { getDisplayName } from '@/lib/genUserName';
import {
  DMProvider,
  DEFAULT_NEW_MESSAGE_SOUNDS,
  type DMProviderDeps,
} from '@samthomson/nostr-messaging/core';

interface DMProviderWrapperProps {
  children: ReactNode;
}

// Debug-only identity override for DM sync/query.
// Set to an npub to simulate that user's relay/message footprint.
// derek: npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424
const DEBUG_USE_AS_NPUB = '';

export const DMProviderWrapper = ({ children }: DMProviderWrapperProps) => {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config, updateConfig } = useAppContext();
  const { toast } = useToast();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { mutateAsync: uploadFile } = useUploadFile();
  const isMobile = useIsMobile();
  const { data: follows = [] } = useFollows();

  const effectiveUser = DEBUG_USE_AS_NPUB
    ? { pubkey: (nip19.decode(DEBUG_USE_AS_NPUB) as unknown as { type: 'npub'; data: string }).data, signer: user?.signer ?? {} }
    : (user ?? null);

  const providerProps: DMProviderDeps = {
    nostr,
    user: effectiveUser,
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
    follows,
    messagingConfig: {
      discoveryRelays: config.discoveryRelays,
      relayMode: config.messagingConfig.relayMode,
      protocolMode: config.messagingConfig.protocolMode,
      ...(config.messagingConfig.enabled === false ? { enabled: false } : {}),
      renderInlineMedia: config.messagingConfig.renderInlineMedia,
      devMode: config.messagingConfig.devMode,
      appName: 'Silent',
      appDescription: 'Private messaging on Nostr',
      soundPref: {
        options: DEFAULT_NEW_MESSAGE_SOUNDS,
        value: config.messagingConfig.soundPref ?? { enabled: false, soundId: '' },
        onChange: (pref: { enabled: boolean; soundId: string }) => updateConfig((c) => ({
          ...c,
          messagingConfig: { ...c.messagingConfig!, soundPref: pref },
        })),
      },
    },
    ui: { showShorts: true, isMobile },
  };

  return <DMProvider {...providerProps}>{children}</DMProvider>;
}
