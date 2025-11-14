import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';
import { useToast } from './useToast';

export interface RelayEntry {
  url: string;
  read: boolean;
  write: boolean;
}

export interface RelayListResult {
  nip65?: { relays: RelayEntry[]; eventId: string };
  dmInbox?: { relays: string[]; eventId: string };
}

export function useRelayLists() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['nostr', 'relay-list', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(10000)]);
      const relayGroup = nostr.group(config.discoveryRelays);
      
      const events = await relayGroup.query(
        [{ kinds: [10002, 10050], authors: [user.pubkey] }],
        { signal }
      );

      const result: RelayListResult = {};
      
      const nip65Event = events.find(e => e.kind === 10002);
      if (nip65Event) {
        const relays: RelayEntry[] = [];
        for (const tag of nip65Event.tags) {
          if (tag[0] !== 'r') continue;
          const url = tag[1];
          const marker = tag[2];
          if (!url) continue;

          switch (marker) {
            case 'read':
              relays.push({ url, read: true, write: false });
              break;
            case 'write':
              relays.push({ url, read: false, write: true });
              break;
            default:
              relays.push({ url, read: true, write: true });
          }
        }
        result.nip65 = { relays, eventId: nip65Event.id };
      }
      
      const dmEvent = events.find(e => e.kind === 10050);
      if (dmEvent) {
        const relays = dmEvent.tags
          .filter(tag => tag[0] === 'relay')
          .map(tag => tag[1])
          .filter(Boolean);
        result.dmInbox = { relays, eventId: dmEvent.id };
      }

      return Object.keys(result).length > 0 ? result : null;
    },
    enabled: !!user?.pubkey,
    staleTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnMount: 'always',
  });

  const publishNIP65 = useMutation({
    mutationFn: async (relays: RelayEntry[]) => {
      if (!user?.signer) throw new Error('No signer available');
      if (relays.length === 0) throw new Error('Cannot publish empty relay list');

      const validRelays = relays.filter(r => r.read || r.write);
      if (validRelays.length === 0) throw new Error('No valid relays (must have read or write enabled)');

      const tags = validRelays.flatMap(r => {
        if (r.read && r.write) return [['r', r.url]];
        if (r.read) return [['r', r.url, 'read']];
        if (r.write) return [['r', r.url, 'write']];
        return [];
      });

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
      toast({ title: 'Relay list updated', description: 'Your relay preferences have been saved.' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to update relay list',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const publishDMInbox = useMutation({
    mutationFn: async (relays: string[]) => {
      if (!user?.signer) throw new Error('No signer available');
      if (relays.length === 0) throw new Error('Cannot publish empty DM inbox relay list');

      const tags = relays.map(url => ['relay', url]);

      const event = await user.signer.signEvent({
        kind: 10050,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      await nostr.event(event, { signal: AbortSignal.timeout(5000) });
      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nostr', 'relay-list'] });
      toast({ title: 'DM inbox relays updated', description: 'Your DM inbox preferences have been saved.' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to update DM inbox relays',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  return {
    ...query,
    publishNIP65: publishNIP65.mutate,
    publishDMInbox: publishDMInbox.mutate,
    isPublishingNIP65: publishNIP65.isPending,
    isPublishingDM: publishDMInbox.isPending,
  };
}

