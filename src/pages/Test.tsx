import { Navigate } from "react-router-dom";
import { DMMessagingInterface } from '@samthomson/nostr-messaging/ui';
import { useDMContext } from "@/contexts/DMProviderWrapper";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AppSidebar } from "@/components/AppSidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";

export function Test() {
  const { user } = useCurrentUser();
  const { messagingState, isLoading, timing, phase } = useDMContext();
  const [relayDetailsOpen, setRelayDetailsOpen] = useState(false);

  // Build relay-to-users mapping and calculate failed count
  const { relayData, failedRelayCount } = useMemo(() => {
    if (!messagingState) return { relayData: [], failedRelayCount: 0 };

    const relayMap = new Map<string, string[]>();
    
    for (const [pubkey, participant] of Object.entries(messagingState.participants)) {
      for (const relay of participant.derivedRelays) {
        if (!relayMap.has(relay)) {
          relayMap.set(relay, []);
        }
        relayMap.get(relay)!.push(pubkey);
      }
    }

    // Convert to array and sort by user count
    const data = Array.from(relayMap.entries())
      .map(([relay, users]) => ({ relay, users, count: users.length }))
      .sort((a, b) => b.count - a.count);

    // Count failed relays: relays that have health info AND failed
    const failed = data.filter(({ relay }) => {
      const health = messagingState.relayInfo[relay];
      return health && !health.lastQuerySucceeded;
    }).length;

    return { relayData: data, failedRelayCount: failed };
  }, [messagingState]);

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-screen flex bg-background">
      <AppSidebar />
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Debug Info Panel */}
        <Card className="m-4 mb-0 bg-muted/50 shrink-0">
        <CardContent className="py-3 px-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status:</span>{' '}
              <span className="font-mono">
                {isLoading
                  ? `⏳ ${phase === 'cache' ? 'Cache' : phase === 'initial_query' ? 'Querying...' : phase === 'gap_filling' ? 'Gap-filling...' : 'Loading...'}`
                  : '✅ Ready'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Conversations:</span>{' '}
              <span className="font-mono">{messagingState ? Object.keys(messagingState.conversationMetadata).length : 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Messages:</span>{' '}
              <span className="font-mono">{messagingState ? Object.values(messagingState.conversationMessages).reduce((sum, msgs) => sum + msgs.length, 0) : 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Participants:</span>{' '}
              <span className="font-mono">{messagingState ? Object.keys(messagingState.participants).length : 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Queried Relays:</span>{' '}
              <span className="font-mono">{messagingState?.syncState.queriedRelays.length || 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Failed Relays:</span>{' '}
              <span className="font-mono text-red-500">{failedRelayCount}</span>
            </div>
          </div>

          {/* Timing Info */}
          {timing && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-xs font-medium text-muted-foreground mb-2">Load Times:</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Total:</span>{' '}
                  <span className="font-mono font-bold">{timing.total ? `${(timing.total / 1000).toFixed(2)}s` : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Load Cache:</span>{' '}
                  <span className="font-mono">{timing.loadCache ? `${timing.loadCache}ms` : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">A. Fetch My Relays:</span>{' '}
                  <span className="font-mono">{timing.fetchMyRelays ? `${timing.fetchMyRelays}ms` : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">B.2 Refresh Parts:</span>{' '}
                  <span className="font-mono">{timing.refreshParticipants ? `${timing.refreshParticipants}ms` : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">C. Query Msgs:</span>{' '}
                  <span className="font-mono">{timing.queryMessages ? `${(timing.queryMessages / 1000).toFixed(2)}s` : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">E+F. Fetch Parts:</span>{' '}
                  <span className="font-mono">{timing.fetchAndMergeParticipants ? `${(timing.fetchAndMergeParticipants / 1000).toFixed(2)}s` : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">I. Query New Relays:</span>{' '}
                  <span className="font-mono">{timing.queryNewRelays ? `${(timing.queryNewRelays / 1000).toFixed(2)}s` : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">J+K. Build State:</span>{' '}
                  <span className="font-mono">{timing.buildAndSave ? `${timing.buildAndSave}ms` : '-'}</span>
                </div>
                {messagingState?.syncState.lastCacheTime && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Cache Age:</span>{' '}
                    <span className="font-mono">{Math.round((Date.now() - messagingState.syncState.lastCacheTime) / 1000)}s ago</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expandable Relay Details */}
          {messagingState && relayData.length > 0 && (
            <Collapsible open={relayDetailsOpen} onOpenChange={setRelayDetailsOpen} className="mt-4">
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline">
                <ChevronDown className={`h-4 w-4 transition-transform ${relayDetailsOpen ? 'rotate-180' : ''}`} />
                View Relay Details ({relayData.length} relays)
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {relayData.map(({ relay, users, count }) => {
                    const health = messagingState.relayInfo[relay];
                    // If relay has health info, we queried it
                    const icon = !health ? '⚪' : health.lastQuerySucceeded ? '✅' : '❌';
                    const failed = health && !health.lastQuerySucceeded;
                    
                    return (
                      <div key={relay} className="border rounded p-3 bg-background text-xs">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="font-mono text-xs break-all flex-1">
                            {icon} {relay}
                            {failed && health.lastQueryError && (
                              <div className="text-red-500 text-[10px] mt-1">
                                Error: {health.lastQueryError.substring(0, 100)}
                              </div>
                            )}
                          </div>
                          <div className="text-muted-foreground whitespace-nowrap">
                            {count} user{count !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <details className="text-muted-foreground">
                          <summary className="cursor-pointer hover:text-foreground">
                            Show participants ({users.length})
                          </summary>
                          <div className="mt-2 pl-4 space-y-1">
                            {users.map(pubkey => (
                              <div key={pubkey} className="font-mono text-xs break-all">
                                {pubkey}
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  ✅ = Successfully connected • ❌ = Connection failed • ⚪ = Not queried (participant's relay but not needed)
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
      {/* Messaging Interface */}
      <div className="flex-1 overflow-hidden m-4 mt-4">
        <DMMessagingInterface />
      </div>
      </div>
    </div>
  );
}

export default Test;

