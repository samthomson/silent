import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Radio, Search, AlertTriangle, RefreshCw, MessageSquare, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useRelayLists, type RelayEntry } from '@/hooks/useRelayList';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useNewDMContext } from '@/contexts/NewDMContext';
import type { RelayInfo } from '@samthomson/nostr-messaging/core';

// Popular relay suggestions for each tab
const DISCOVERY_SUGGESTIONS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.ditto.pub',
  'wss://nostr.wine',
];

const NIP65_SUGGESTIONS = [
  'wss://relay.damus.io',
  'wss://purplepag.es',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
];

const DM_INBOX_SUGGESTIONS = [
  'wss://relay.0xchat.com',
  'wss://auth.nostr1.com',
  'wss://inbox.nostr.wine',
  'wss://relay.damus.io',
  'wss://nostr.land',
];


// Shared component for relay input with popular suggestions
interface RelayInputWithSuggestionsProps {
  suggestions: string[];
  onAdd: (url: string) => void;
  currentRelays: string[];
  disabled?: boolean;
  placeholder?: string;
  isLoading?: boolean;
}

function RelayInputWithSuggestions({ suggestions, onAdd, currentRelays, disabled, placeholder = "wss://relay.example.com", isLoading }: RelayInputWithSuggestionsProps) {
  const [newUrl, setNewUrl] = useState('');
  const [open, setOpen] = useState(false);
  
  const available = suggestions.filter(url => !currentRelays.includes(url));

  const handleAdd = (url?: string) => {
    const input = url || newUrl;
    onAdd(input);
    setNewUrl('');
    setOpen(false);
  };

  return (
    <div className="flex gap-2">
      <div className="flex-1 flex gap-1">
        <Input 
          placeholder={placeholder}
          value={newUrl} 
          onChange={e => setNewUrl(e.target.value)} 
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          disabled={disabled}
          className="font-mono text-xs"
        />
        {available.length > 0 && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                size="icon"
                disabled={disabled}
                className="flex-shrink-0"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-2">
              <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 mb-1">
                Popular Relays
              </div>
              <div className="space-y-1">
                {available.map(url => (
                  <button
                    key={url}
                    onClick={() => handleAdd(url)}
                    className="w-full flex items-center justify-between gap-2 px-2 py-2 text-xs font-mono rounded hover:bg-accent transition-colors group"
                  >
                    <span className="truncate">{url}</span>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground flex-shrink-0" />
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <Button 
        onClick={() => handleAdd()} 
        disabled={disabled || !newUrl.trim()}
      >
        {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function DiscoveryRelaysTab({ failedRelays }: { failedRelays: Array<[string, RelayInfo]> }) {
  const { config, updateConfig } = useAppContext();
  const [edited, setEdited] = useState<string[] | null>(null);
  
  const current = edited !== null ? edited : config.discoveryRelays;
  const hasChanges = edited !== null;

  const failedRelaySet = new Set(failedRelays.map(([relay]) => relay));
  const failedRelayErrors = new Map(failedRelays.map(([relay, info]) => [relay, info.lastQueryError || 'Unknown connection error']));

  const add = (url: string) => {
    const input = url.trim();
    if (!input) return;
    const normalized = input.startsWith('wss://') || input.startsWith('ws://') ? input : `wss://${input}`;
    if (current.includes(normalized)) return;
    setEdited([...current, normalized]);
  };

  const remove = (url: string) => setEdited(current.filter(r => r !== url));
  const save = () => { updateConfig(c => ({ ...c, discoveryRelays: edited! })); setEdited(null); };
  const cancel = () => setEdited(null);

  return (
    <TabsContent value="discovery" className="space-y-6 mt-4">
      <div>
        <h3 className="text-sm font-semibold mb-3">Discovery Relays</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Used to find your relay lists and as default relay pool.
        </p>
        {current.length === 0 ? (
          <div className="text-center py-6 px-4 border border-dashed rounded-lg text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No discovery relays</p>
          </div>
        ) : (
          <div className="space-y-2">
            {current.map(url => {
              const isFailed = failedRelaySet.has(url);
              return (
                <div 
                  key={url} 
                  className={`flex items-center gap-3 p-3 border rounded-lg ${isFailed ? 'border-red-500 bg-red-500/10' : ''}`}
                >
                  {isFailed && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono truncate">{url}</p>
                    {isFailed && (
                      <p className="text-xs text-red-500 mt-1">{failedRelayErrors.get(url)}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive flex-shrink-0" onClick={() => remove(url)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Relay</h3>
        <RelayInputWithSuggestions
          suggestions={DISCOVERY_SUGGESTIONS}
          onAdd={add}
          currentRelays={current}
        />
      </div>
      {hasChanges && (
        <div className="flex gap-2">
          <Button onClick={save} className="flex-1">Save</Button>
          <Button variant="outline" onClick={cancel} className="flex-1">Cancel</Button>
        </div>
      )}
    </TabsContent>
  );
}

function DMInboxTab({ failedRelays }: { failedRelays: Array<[string, RelayInfo]> }) {
  const { user } = useCurrentUser();
  const { data, isLoading, isFetching, refetch, publishDMInbox, isPublishingDM } = useRelayLists();
  const [edited, setEdited] = useState<string[] | null>(null);
  
  const current = edited !== null ? edited : (data?.dmInbox?.relays || []);

  const failedRelaySet = new Set(failedRelays.map(([relay]) => relay));
  const failedRelayErrors = new Map(failedRelays.map(([relay, info]) => [relay, info.lastQueryError || 'Unknown connection error']));

  // Reset edited state when data changes (after successful mutation)
  useEffect(() => {
    if (edited !== null && data?.dmInbox?.relays) {
      const currentRelays = data.dmInbox.relays;
      const editedRelays = edited;
      // If arrays match, reset edited state
      if (currentRelays.length === editedRelays.length && 
          currentRelays.every(r => editedRelays.includes(r))) {
        setEdited(null);
      }
    }
  }, [data?.dmInbox?.relays, edited]);

  const add = (url: string) => {
    const input = url.trim();
    if (!input) return;
    const normalized = input.startsWith('wss://') || input.startsWith('ws://') ? input : `wss://${input}`;
    if (current.includes(normalized)) return;
    const updated = [...current, normalized];
    setEdited(updated);
    publishDMInbox(updated);
  };

  const remove = (url: string) => {
    const updated = current.filter(r => r !== url);
    setEdited(updated);
    publishDMInbox(updated);
  };

  if (isLoading) return (
    <TabsContent value="dm-inbox" className="mt-4">
      <div className="flex items-center justify-center py-8">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading relay lists...</p>
        </div>
      </div>
    </TabsContent>
  );

  return (
    <TabsContent value="dm-inbox" className="space-y-6 mt-4">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">DM Inbox (kind 10050)</h3>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => refetch()} 
            disabled={isFetching} 
            className="h-7 px-2 text-xs"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Resync
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Where you receive DMs. Falls back to NIP-65 read → discovery.
        </p>
        {current.length === 0 ? (
          <div className="text-center py-6 px-4 border border-dashed rounded-lg text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No DM inbox relays</p>
            <p className="text-xs mt-1">Using fallback relays</p>
          </div>
        ) : (
          <div className="space-y-2">
            {current.map(url => {
              const isFailed = failedRelaySet.has(url);
              return (
                <div 
                  key={url} 
                  className={`flex items-center gap-3 p-3 border rounded-lg ${isFailed ? 'border-red-500 bg-red-500/10' : ''}`}
                >
                  {isFailed && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono truncate">{url}</p>
                    {isFailed && (
                      <p className="text-xs text-red-500 mt-1">{failedRelayErrors.get(url)}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => remove(url)} disabled={!user} className="h-7 w-7 p-0 flex-shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Relay</h3>
        <RelayInputWithSuggestions
          suggestions={DM_INBOX_SUGGESTIONS}
          onAdd={add}
          currentRelays={current}
          disabled={!user || isPublishingDM}
          isLoading={isPublishingDM}
        />
        {isPublishingDM && (
          <p className="text-xs text-muted-foreground mt-2">Publishing changes...</p>
        )}
      </div>
    </TabsContent>
  );
}

function NIP65Tab({ failedRelays }: { failedRelays: Array<[string, RelayInfo]> }) {
  const { user } = useCurrentUser();
  const { data, isLoading, isFetching, refetch, publishNIP65, isPublishingNIP65 } = useRelayLists();
  const [edited, setEdited] = useState<RelayEntry[] | null>(null);
  
  const current = edited !== null ? edited : (data?.nip65?.relays || []);

  const failedRelaySet = new Set(failedRelays.map(([relay]) => relay));
  const failedRelayErrors = new Map(failedRelays.map(([relay, info]) => [relay, info.lastQueryError || 'Unknown connection error']));

  // Reset edited state when data changes (after successful mutation)
  useEffect(() => {
    if (edited !== null && data?.nip65?.relays) {
      const currentRelays = data.nip65.relays;
      const editedRelays = edited;
      // If arrays match, reset edited state
      if (currentRelays.length === editedRelays.length && 
          currentRelays.every(r => editedRelays.some(e => e.url === r.url && e.read === r.read && e.write === r.write))) {
        setEdited(null);
      }
    }
  }, [data?.nip65?.relays, edited]);

  const add = (url: string) => {
    const input = url.trim();
    if (!input) return;
    const normalized = input.startsWith('wss://') || input.startsWith('ws://') ? input : `wss://${input}`;
    if (current.some(r => r.url === normalized)) return;
    const updated = [...current, { url: normalized, read: true, write: true }];
    setEdited(updated);
    publishNIP65(updated);
  };

  const remove = (url: string) => {
    const updated = current.filter(r => r.url !== url);
    setEdited(updated);
    publishNIP65(updated);
  };
  
  const toggleRead = (url: string) => {
    const updated = current.map(r => r.url === url ? { ...r, read: !r.read } : r);
    setEdited(updated);
    publishNIP65(updated);
  };
  
  const toggleWrite = (url: string) => {
    const updated = current.map(r => r.url === url ? { ...r, write: !r.write } : r);
    setEdited(updated);
    publishNIP65(updated);
  };

  if (!user) return (
    <TabsContent value="nip65" className="mt-4">
      <div className="text-center py-8 text-muted-foreground">
        <Radio className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p>Log in to manage NIP-65</p>
      </div>
    </TabsContent>
  );

  if (isLoading) return (
    <TabsContent value="nip65" className="mt-4">
      <div className="flex items-center justify-center py-8">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading relay lists...</p>
        </div>
      </div>
    </TabsContent>
  );

  return (
    <TabsContent value="nip65" className="space-y-6 mt-4">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">NIP-65 (kind 10002)</h3>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => refetch()} 
            disabled={isFetching} 
            className="h-7 px-2 text-xs"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Resync
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Read = inbox for DMs. Write = where you publish.
        </p>
        {current.length === 0 ? (
          <div className="text-center py-6 px-4 border border-dashed rounded-lg text-muted-foreground">
            <Radio className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No NIP-65 relay list</p>
          </div>
        ) : (
          <div className="space-y-2">
            {current.map(r => {
              const isFailed = failedRelaySet.has(r.url);
              return (
                <div 
                  key={r.url} 
                  className={`flex flex-col gap-2 p-3 border rounded-lg ${isFailed ? 'border-red-500 bg-red-500/10' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {isFailed && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                    <p className="flex-1 text-sm font-mono truncate">{r.url}</p>
                  </div>
                  {isFailed && (
                    <p className="text-xs text-red-500 ml-6">{failedRelayErrors.get(r.url)}</p>
                  )}
                  <div className="flex items-center gap-3 ml-6">
                    <div className="flex items-center gap-1.5">
                      <Switch id={`r-${r.url}`} checked={r.read} onCheckedChange={() => toggleRead(r.url)} disabled={isPublishingNIP65} className="scale-75" />
                      <Label htmlFor={`r-${r.url}`} className="text-xs cursor-pointer">Read</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Switch id={`w-${r.url}`} checked={r.write} onCheckedChange={() => toggleWrite(r.url)} disabled={isPublishingNIP65} className="scale-75" />
                      <Label htmlFor={`w-${r.url}`} className="text-xs cursor-pointer">Write</Label>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(r.url)} disabled={isPublishingNIP65}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Relay</h3>
        <RelayInputWithSuggestions
          suggestions={NIP65_SUGGESTIONS}
          onAdd={add}
          currentRelays={current.map(r => r.url)}
          disabled={isPublishingNIP65}
          isLoading={isPublishingNIP65}
        />
        {isPublishingNIP65 && (
          <p className="text-xs text-muted-foreground mt-2">Publishing changes...</p>
        )}
      </div>
    </TabsContent>
  );
}

export function RelayListManager() {
  const { messagingState } = useNewDMContext();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { data } = useRelayLists();

  // Compute failed relays for each category
  const failedRelays = useMemo(() => {
    if (!messagingState?.relayInfo || !user?.pubkey) {
      return { discovery: [], nip65: [], dmInbox: [] };
    }

    const userRelays = new Set(messagingState.participants[user.pubkey]?.derivedRelays || []);
    const discoveryRelays = new Set(config.discoveryRelays || []);
    const nip65Relays = new Set((data?.nip65?.relays || []).map(r => r.url));
    const dmInboxRelays = new Set(data?.dmInbox?.relays || []);

    const allFailed = Object.entries(messagingState.relayInfo)
      .filter(([relay, info]) => userRelays.has(relay) && !info.lastQuerySucceeded);

    return {
      discovery: allFailed.filter(([relay]) => discoveryRelays.has(relay)),
      nip65: allFailed.filter(([relay]) => nip65Relays.has(relay)),
      dmInbox: allFailed.filter(([relay]) => dmInboxRelays.has(relay)),
    };
  }, [messagingState, user, config.discoveryRelays, data]);

  return (
    <Tabs defaultValue="dm-inbox" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="discovery" className="px-2 sm:px-3">
          <Search className="h-4 w-4 mr-2 hidden sm:inline-block" />
          Discovery
          {failedRelays.discovery.length > 0 && <AlertTriangle className="h-3 w-3 ml-2 text-red-500" />}
        </TabsTrigger>
        <TabsTrigger value="nip65" className="px-2 sm:px-3">
          <Radio className="h-4 w-4 mr-2 hidden sm:inline-block" />
          Inbox/Outbox
          {failedRelays.nip65.length > 0 && <AlertTriangle className="h-3 w-3 ml-2 text-red-500" />}
        </TabsTrigger>
        <TabsTrigger value="dm-inbox" className="px-2 sm:px-3">
          <MessageSquare className="h-4 w-4 mr-2 hidden sm:inline-block" />
          DMs
          {failedRelays.dmInbox.length > 0 && <AlertTriangle className="h-3 w-3 ml-2 text-red-500" />}
        </TabsTrigger>
      </TabsList>

      <DiscoveryRelaysTab failedRelays={failedRelays.discovery} />
      <NIP65Tab failedRelays={failedRelays.nip65} />
      <DMInboxTab failedRelays={failedRelays.dmInbox} />

    </Tabs>
  );
}

