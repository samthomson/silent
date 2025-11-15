import { useState } from 'react';
import { Plus, Trash2, Radio, Search, AlertTriangle, RefreshCw, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRelayLists, type RelayEntry } from '@/hooks/useRelayList';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useDMContext } from '@/contexts/DMContext';

function DiscoveryRelaysTab() {
  const { config, updateConfig } = useAppContext();
  const [edited, setEdited] = useState<string[] | null>(null);
  const [newUrl, setNewUrl] = useState('');
  
  const current = edited !== null ? edited : config.discoveryRelays;
  const hasChanges = edited !== null;

  const add = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    const normalized = trimmed.startsWith('wss://') || trimmed.startsWith('ws://') ? trimmed : `wss://${trimmed}`;
    if (current.includes(normalized)) return;
    setEdited([...current, normalized]);
    setNewUrl('');
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
            {current.map(url => (
              <div key={url} className="flex items-center gap-3 p-3 border rounded-lg">
                <p className="flex-1 text-sm font-mono truncate">{url}</p>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(url)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Relay</h3>
        <div className="flex gap-2">
          <Input placeholder="wss://relay.example.com" value={newUrl} onChange={e => setNewUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <Button onClick={add} disabled={!newUrl.trim()}><Plus className="h-4 w-4" /></Button>
        </div>
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

function DMInboxTab() {
  const { user } = useCurrentUser();
  const { data, isLoading, refetch, publishDMInbox, isPublishingDM } = useRelayLists();
  const [edited, setEdited] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  
  const current = edited.length > 0 ? edited : (data?.dmInbox?.relays || []);
  const hasChanges = edited.length > 0;

  const add = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    const normalized = trimmed.startsWith('wss://') || trimmed.startsWith('ws://') ? trimmed : `wss://${trimmed}`;
    if (current.includes(normalized)) return;
    setEdited([...current, normalized]);
    setNewUrl('');
  };

  const remove = (url: string) => setEdited(current.filter(r => r !== url));
  const save = () => { publishDMInbox(edited); setEdited([]); };
  const cancel = () => setEdited([]);

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
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading} className="h-7 px-2 text-xs">
            <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
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
            {current.map(url => (
              <div key={url} className="flex items-center gap-3 p-3 border rounded-lg">
                <p className="flex-1 text-xs font-mono truncate">{url}</p>
                <Button variant="ghost" size="sm" onClick={() => remove(url)} disabled={!user} className="h-7 w-7 p-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Relay</h3>
        <div className="flex gap-2">
          <Input placeholder="wss://relay.example.com" value={newUrl} onChange={e => setNewUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} disabled={!user} className="font-mono text-xs" />
          <Button onClick={add} disabled={!user || !newUrl.trim()}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>
      {hasChanges && (
        <div className="flex gap-2">
          <Button onClick={save} disabled={isPublishingDM || !user} className="flex-1">{isPublishingDM ? 'Publishing...' : 'Publish'}</Button>
          <Button variant="outline" onClick={cancel} disabled={isPublishingDM}>Cancel</Button>
        </div>
      )}
    </TabsContent>
  );
}

function NIP65Tab() {
  const { user } = useCurrentUser();
  const { data, isLoading, refetch, publishNIP65, isPublishingNIP65 } = useRelayLists();
  const { relayError, clearRelayError } = useDMContext();
  const [edited, setEdited] = useState<RelayEntry[]>([]);
  const [newUrl, setNewUrl] = useState('');
  
  const current = edited.length > 0 ? edited : (data?.nip65?.relays || []);
  const hasChanges = edited.length > 0;

  const add = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    const normalized = trimmed.startsWith('wss://') || trimmed.startsWith('ws://') ? trimmed : `wss://${trimmed}`;
    if (current.some(r => r.url === normalized)) return;
    setEdited([...current, { url: normalized, read: true, write: true }]);
    setNewUrl('');
  };

  const remove = (url: string) => setEdited(current.filter(r => r.url !== url));
  const toggleRead = (url: string) => setEdited(current.map(r => r.url === url ? { ...r, read: !r.read } : r));
  const toggleWrite = (url: string) => setEdited(current.map(r => r.url === url ? { ...r, write: !r.write } : r));
  const save = () => { publishNIP65(edited); setEdited([]); };
  const cancel = () => setEdited([]);

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
      {relayError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="font-semibold mb-2">{relayError.message}</p>
              <p className="text-sm mb-2">Failed to query {relayError.totalRelays} relay{relayError.totalRelays > 1 ? 's' : ''}:</p>
              <ul className="text-sm space-y-1 ml-4 mb-2">
                {relayError.failedRelays.map(url => <li key={url} className="font-mono text-xs list-disc">{url}</li>)}
              </ul>
            </div>
            <Button variant="ghost" size="sm" onClick={clearRelayError} className="flex-shrink-0">Dismiss</Button>
          </AlertDescription>
        </Alert>
      )}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">NIP-65 (kind 10002)</h3>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading} className="h-7 px-2 text-xs">
            <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
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
            {current.map(r => (
              <div key={r.url} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 border rounded-lg">
                <p className="flex-1 text-sm font-mono truncate">{r.url}</p>
                <div className="flex items-center gap-3">
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
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Relay</h3>
        <div className="flex gap-2">
          <Input placeholder="wss://relay.example.com" value={newUrl} onChange={e => setNewUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} disabled={isPublishingNIP65} />
          <Button onClick={add} disabled={!newUrl.trim() || isPublishingNIP65}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>
      {hasChanges && (
        <div className="flex gap-2">
          <Button onClick={save} disabled={isPublishingNIP65} className="flex-1">Save & Publish</Button>
          <Button variant="outline" onClick={cancel} disabled={isPublishingNIP65} className="flex-1">Cancel</Button>
        </div>
      )}
    </TabsContent>
  );
}

export function RelayListManager() {
  const { relayError, clearRelayError } = useDMContext();

  return (
    <Tabs defaultValue="dm-inbox" className="w-full">
      {relayError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{relayError.message}</span>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearRelayError}
              className="h-auto py-1 px-2"
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
      
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="discovery">
          <Search className="h-4 w-4 mr-2" />
          Discovery
        </TabsTrigger>
        <TabsTrigger value="nip65">
          <Radio className="h-4 w-4 mr-2" />
          Inbox/Outbox
        </TabsTrigger>
        <TabsTrigger value="dm-inbox">
          <MessageSquare className="h-4 w-4 mr-2" />
          DMs
          {relayError && <AlertTriangle className="h-3 w-3 ml-2 text-destructive" />}
        </TabsTrigger>
      </TabsList>

      <DiscoveryRelaysTab />
      <NIP65Tab />
      <DMInboxTab />

    </Tabs>
  );
}

