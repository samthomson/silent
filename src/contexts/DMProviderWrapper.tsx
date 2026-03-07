import { ReactNode } from 'react';
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

export const DMProviderWrapper = ({ children }: DMProviderWrapperProps) => {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config, updateConfig } = useAppContext();
  const { toast } = useToast();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { mutateAsync: uploadFile } = useUploadFile();
  const isMobile = useIsMobile();
  const { data: follows = [] } = useFollows();

  const providerProps: DMProviderDeps = {
    nostr,
    user: user ?? null,
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
      protocolMode: undefined,
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
