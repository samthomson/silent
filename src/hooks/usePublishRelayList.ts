import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { useToast } from './useToast';
import type { RelayEntry } from './useRelayList';

export function usePublishRelayList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (relays: RelayEntry[]) => {
      if (!user?.signer) {
        throw new Error('No signer available');
      }

      const tags: string[][] = [];

      for (const relay of relays) {
        if (relay.read && relay.write) {
          tags.push(['r', relay.url]);
        } else if (relay.read) {
          tags.push(['r', relay.url, 'read']);
        } else if (relay.write) {
          tags.push(['r', relay.url, 'write']);
        }
      }

      const event = await user.signer.signEvent({
        kind: 10002,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      await nostr.event(event, { signal: AbortSignal.timeout(5000) });

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nostr', 'relay-list'] });
      toast({
        title: 'Relay list updated',
        description: 'Your relay preferences have been saved.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to update relay list',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}

