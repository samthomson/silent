import { useEffect, useRef, ReactNode } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRelayLists } from '@/hooks/useRelayList';

interface RelayResolverProps {
  children: ReactNode;
  activeRelaysRef: React.MutableRefObject<string[]>;
}

export function RelayResolver({ children, activeRelaysRef }: RelayResolverProps) {
  const { user } = useCurrentUser();
  const { data: relayLists, isLoading } = useRelayLists();
  const hasResolved = useRef(false);

  useEffect(() => {
    if (!user?.pubkey) {
      hasResolved.current = true;
      return;
    }

    if (isLoading) return;

    if (relayLists?.dmInbox?.relays && relayLists.dmInbox.relays.length > 0) {
      activeRelaysRef.current = relayLists.dmInbox.relays;
      console.log('[RelayResolver] Using kind 10050 relays:', relayLists.dmInbox.relays);
    } else if (relayLists?.nip65?.relays && relayLists.nip65.relays.length > 0) {
      activeRelaysRef.current = relayLists.nip65.relays.map(r => r.url);
      console.log('[RelayResolver] Using kind 10002 relays:', activeRelaysRef.current);
    } else {
      console.log('[RelayResolver] No relay lists found, keeping discovery relays:', activeRelaysRef.current);
    }

    if (!hasResolved.current) {
      hasResolved.current = true;
    }
  }, [user?.pubkey, relayLists, isLoading, activeRelaysRef]);

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

