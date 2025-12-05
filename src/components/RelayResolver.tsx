import { useEffect, useRef, ReactNode } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRelayLists } from '@/hooks/useRelayList';
import { useAppContext } from '@/hooks/useAppContext';
import { extractInboxRelays, extractOutboxRelays } from '@/lib/relayUtils';

interface RelayResolverProps {
  children: ReactNode;
  inboxRelaysRef: React.MutableRefObject<string[]>;
  outboxRelaysRef: React.MutableRefObject<string[]>;
}

export function RelayResolver({ children, inboxRelaysRef, outboxRelaysRef }: RelayResolverProps) {
  const { user } = useCurrentUser();
  const { data: relayLists, isLoading } = useRelayLists();
  const { config } = useAppContext();
  const hasResolved = useRef(false);

  useEffect(() => {
    if (!user?.pubkey) {
      hasResolved.current = true;
      return;
    }

    if (isLoading) return;

    // Inbox relays: for reading DMs (10050 > 10002 read > discovery)
    const inboxRelays = extractInboxRelays(relayLists, config.discoveryRelays);
    inboxRelaysRef.current = inboxRelays;
    console.log('[RelayResolver] ✅ Inbox relays updated:', inboxRelays);
    
    // Outbox relays: for reading/writing profiles and other content (10002 write > discovery)
    const outboxRelays = extractOutboxRelays(relayLists, config.discoveryRelays);
    outboxRelaysRef.current = outboxRelays;
    console.log('[RelayResolver] ✅ Outbox relays updated:', outboxRelays);

    if (!hasResolved.current) {
      hasResolved.current = true;
    }
  }, [user?.pubkey, relayLists, isLoading, inboxRelaysRef, outboxRelaysRef, config.discoveryRelays]);

  if (user?.pubkey && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading relays...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

