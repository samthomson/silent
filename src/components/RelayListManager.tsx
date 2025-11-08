import { useState } from 'react';
import { Plus, Trash2, Radio, Search, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRelayList, type RelayEntry } from '@/hooks/useRelayList';
import { usePublishRelayList } from '@/hooks/usePublishRelayList';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useDMContext } from '@/contexts/DMContext';

export function RelayListManager() {
  const { user } = useCurrentUser();
  const { config, updateConfig } = useAppContext();
  const { data: relayListData, isLoading } = useRelayList();
  const relays = relayListData?.relays;
  const { mutate: publishRelays, isPending: isPublishingNIP65 } = usePublishRelayList();
  const { relayError, clearRelayError } = useDMContext();
  
  const [editedRelays, setEditedRelays] = useState<RelayEntry[]>([]);
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [hasNIP65Changes, setHasNIP65Changes] = useState(false);

  const [editedDiscoveryRelays, setEditedDiscoveryRelays] = useState<string[]>([]);
  const [newDiscoveryRelayUrl, setNewDiscoveryRelayUrl] = useState('');
  const [hasDiscoveryChanges, setHasDiscoveryChanges] = useState(false);

  const currentRelays = hasNIP65Changes ? editedRelays : (relays || []);
  const currentDiscoveryRelays = hasDiscoveryChanges ? editedDiscoveryRelays : config.discoveryRelays;

  const handleAddRelay = () => {
    const trimmedUrl = newRelayUrl.trim();
    
    if (!trimmedUrl) return;

    let normalizedUrl = trimmedUrl;
    if (!normalizedUrl.startsWith('wss://') && !normalizedUrl.startsWith('ws://')) {
      normalizedUrl = `wss://${normalizedUrl}`;
    }

    if (currentRelays.some(r => r.url === normalizedUrl)) {
      return;
    }

    const updated = [...currentRelays, { url: normalizedUrl, read: true, write: true }];
    setEditedRelays(updated);
    setHasNIP65Changes(true);
    setNewRelayUrl('');
  };

  const handleRemoveRelay = (url: string) => {
    const updated = currentRelays.filter(r => r.url !== url);
    setEditedRelays(updated);
    setHasNIP65Changes(true);
  };

  const handleToggleRead = (url: string) => {
    const updated = currentRelays.map(r => 
      r.url === url ? { ...r, read: !r.read } : r
    );
    setEditedRelays(updated);
    setHasNIP65Changes(true);
  };

  const handleToggleWrite = (url: string) => {
    const updated = currentRelays.map(r => 
      r.url === url ? { ...r, write: !r.write } : r
    );
    setEditedRelays(updated);
    setHasNIP65Changes(true);
  };

  const handleSaveNIP65 = () => {
    const validRelays = editedRelays.filter(r => r.read || r.write);
    publishRelays(validRelays);
    setHasNIP65Changes(false);
  };

  const handleCancelNIP65 = () => {
    setEditedRelays([]);
    setHasNIP65Changes(false);
  };

  const handleAddDiscoveryRelay = () => {
    const trimmedUrl = newDiscoveryRelayUrl.trim();
    
    if (!trimmedUrl) return;

    let normalizedUrl = trimmedUrl;
    if (!normalizedUrl.startsWith('wss://') && !normalizedUrl.startsWith('ws://')) {
      normalizedUrl = `wss://${normalizedUrl}`;
    }

    if (currentDiscoveryRelays.includes(normalizedUrl)) {
      return;
    }

    const updated = [...currentDiscoveryRelays, normalizedUrl];
    setEditedDiscoveryRelays(updated);
    setHasDiscoveryChanges(true);
    setNewDiscoveryRelayUrl('');
  };

  const handleRemoveDiscoveryRelay = (url: string) => {
    const updated = currentDiscoveryRelays.filter(r => r !== url);
    setEditedDiscoveryRelays(updated);
    setHasDiscoveryChanges(true);
  };

  const handleSaveDiscoveryRelays = () => {
    updateConfig((current) => ({ ...current, discoveryRelays: editedDiscoveryRelays }));
    setHasDiscoveryChanges(false);
  };

  const handleCancelDiscoveryRelays = () => {
    setEditedDiscoveryRelays([]);
    setHasDiscoveryChanges(false);
  };

  return (
    <Tabs defaultValue="discovery" className="w-full">
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
      
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="discovery">
          <Search className="h-4 w-4 mr-2" />
          Discovery Relays
        </TabsTrigger>
        <TabsTrigger value="nip65">
          <Radio className="h-4 w-4 mr-2" />
          NIP-65 Relay List
          {relayError && <AlertTriangle className="h-3 w-3 ml-2 text-destructive" />}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="discovery" className="space-y-6 mt-4">
        <div>
          <h3 className="text-sm font-semibold mb-3">Discovery Relays</h3>
          <p className="text-xs text-muted-foreground mb-4">
            These relays are used to find your NIP-65 relay list and serve as your default relay pool until NIP-65 is configured.
          </p>

          {currentDiscoveryRelays.length === 0 ? (
            <div className="text-center py-6 px-4 border border-dashed rounded-lg text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No discovery relays configured</p>
              <p className="text-xs mt-1">Add at least one relay below</p>
            </div>
          ) : (
            <div className="space-y-2">
              {currentDiscoveryRelays.map((url) => (
                <div
                  key={url}
                  className="flex items-center gap-3 p-3 border rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono truncate">{url}</p>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => handleRemoveDiscoveryRelay(url)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-3">Add Discovery Relay</h3>
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="wss://relay.example.com"
              value={newDiscoveryRelayUrl}
              onChange={(e) => setNewDiscoveryRelayUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddDiscoveryRelay();
                }
              }}
            />
            <Button
              onClick={handleAddDiscoveryRelay}
              disabled={!newDiscoveryRelayUrl.trim()}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>
        </div>

        {hasDiscoveryChanges && (
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSaveDiscoveryRelays}
              className="flex-1"
            >
              Save Changes
            </Button>
            <Button
              variant="outline"
              onClick={handleCancelDiscoveryRelays}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="nip65" className="space-y-6 mt-4">
        {!user ? (
          <div className="text-center py-8 text-muted-foreground">
            <Radio className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p>Log in to manage your NIP-65 relay list</p>
          </div>
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-semibold mb-3">NIP-65 Relay List</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Your published relay list (kind 10002). Read relays are your inbox for DMs. Write relays are where you publish content.
              </p>

              {currentRelays.length === 0 ? (
                <div className="text-center py-6 px-4 border border-dashed rounded-lg text-muted-foreground">
                  <Radio className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No NIP-65 relay list found</p>
                  <p className="text-xs mt-1">Add relays below and save to publish your relay list</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {currentRelays.map((relay) => (
                    <div
                      key={relay.url}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 border rounded-lg"
                    >
                      <div className="flex items-center justify-between gap-3 sm:flex-1 sm:min-w-0">
                        <p className="text-sm font-mono truncate flex-1 my-auto">{relay.url}</p>
                        
                        {/* Mobile: Trash icon on same line as URL */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive sm:hidden flex-shrink-0"
                          onClick={() => handleRemoveRelay(relay.url)}
                          disabled={isPublishingNIP65}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      
                      <div className="flex items-center gap-3 sm:gap-3">
                        <div className="flex items-center gap-1.5">
                          <Switch
                            id={`read-${relay.url}`}
                            checked={relay.read}
                            onCheckedChange={() => handleToggleRead(relay.url)}
                            disabled={isPublishingNIP65}
                            className="scale-75"
                          />
                          <Label htmlFor={`read-${relay.url}`} className="text-xs cursor-pointer">
                            Read
                          </Label>
                        </div>
                        
                        <div className="flex items-center gap-1.5">
                          <Switch
                            id={`write-${relay.url}`}
                            checked={relay.write}
                            onCheckedChange={() => handleToggleWrite(relay.url)}
                            disabled={isPublishingNIP65}
                            className="scale-75"
                          />
                          <Label htmlFor={`write-${relay.url}`} className="text-xs cursor-pointer">
                            Write
                          </Label>
                        </div>

                        {/* Desktop: Trash icon after toggles */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hidden sm:flex h-7 w-7 text-destructive flex-shrink-0 self-center"
                          onClick={() => handleRemoveRelay(relay.url)}
                          disabled={isPublishingNIP65}
                        >
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
                <Input
                  type="text"
                  placeholder="wss://relay.example.com"
                  value={newRelayUrl}
                  onChange={(e) => setNewRelayUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddRelay();
                    }
                  }}
                  disabled={isPublishingNIP65}
                />
                <Button
                  onClick={handleAddRelay}
                  disabled={!newRelayUrl.trim() || isPublishingNIP65}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            {hasNIP65Changes && (
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSaveNIP65}
                  disabled={isPublishingNIP65}
                  className="flex-1"
                >
                  Save & Publish
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancelNIP65}
                  disabled={isPublishingNIP65}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            )}
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}

