import { useState } from 'react';
import { Plus, Trash2, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useRelayList, type RelayEntry } from '@/hooks/useRelayList';
import { usePublishRelayList } from '@/hooks/usePublishRelayList';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function RelayListManager() {
  const { user } = useCurrentUser();
  const { data: relays, isLoading } = useRelayList();
  const { mutate: publishRelays, isPending } = usePublishRelayList();
  
  const [editedRelays, setEditedRelays] = useState<RelayEntry[]>([]);
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const currentRelays = hasChanges ? editedRelays : (relays || []);

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
    setHasChanges(true);
    setNewRelayUrl('');
  };

  const handleRemoveRelay = (url: string) => {
    const updated = currentRelays.filter(r => r.url !== url);
    setEditedRelays(updated);
    setHasChanges(true);
  };

  const handleToggleRead = (url: string) => {
    const updated = currentRelays.map(r => 
      r.url === url ? { ...r, read: !r.read } : r
    );
    setEditedRelays(updated);
    setHasChanges(true);
  };

  const handleToggleWrite = (url: string) => {
    const updated = currentRelays.map(r => 
      r.url === url ? { ...r, write: !r.write } : r
    );
    setEditedRelays(updated);
    setHasChanges(true);
  };

  const handleSave = () => {
    const validRelays = editedRelays.filter(r => r.read || r.write);
    publishRelays(validRelays);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setEditedRelays([]);
    setHasChanges(false);
  };

  if (!user) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Radio className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p>Log in to manage your relay list</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3">Your Relays</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Manage where you publish content and receive messages. Read relays are your inbox for DMs. Write relays are where you publish content.
        </p>

        {currentRelays.length === 0 ? (
          <div className="text-center py-6 px-4 border border-dashed rounded-lg text-muted-foreground">
            <Radio className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No relays configured</p>
            <p className="text-xs mt-1">Add your first relay below</p>
          </div>
        ) : (
          <div className="space-y-2">
            {currentRelays.map((relay) => (
              <div
                key={relay.url}
                className="flex items-center gap-3 p-3 border rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate">{relay.url}</p>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`read-${relay.url}`} className="text-xs cursor-pointer">
                      Read
                    </Label>
                    <Switch
                      id={`read-${relay.url}`}
                      checked={relay.read}
                      onCheckedChange={() => handleToggleRead(relay.url)}
                      disabled={isPending}
                    />
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`write-${relay.url}`} className="text-xs cursor-pointer">
                      Write
                    </Label>
                    <Switch
                      id={`write-${relay.url}`}
                      checked={relay.write}
                      onCheckedChange={() => handleToggleWrite(relay.url)}
                      disabled={isPending}
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => handleRemoveRelay(relay.url)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-4 w-4" />
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
            disabled={isPending}
          />
          <Button
            onClick={handleAddRelay}
            disabled={!newRelayUrl.trim() || isPending}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1"
          >
            Save Changes
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isPending}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

