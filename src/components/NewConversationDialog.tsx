import { useState, useMemo } from 'react';
import { nip19 } from 'nostr-tools';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageSquarePlus, X, Check } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useDMContext } from '@/contexts/DMContext';
import { useFollows } from '@/hooks/useFollows';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface NewConversationDialogProps {
  onStartConversation: (pubkey: string) => void;
}

function ContactRow({ 
  pubkey, 
  isSelected, 
  onToggle,
  metadata
}: { 
  pubkey: string; 
  isSelected: boolean;
  onToggle: () => void;
  metadata?: { name?: string; picture?: string };
}) {
  const displayName = metadata?.name || genUserName(pubkey);
  const avatarUrl = metadata?.picture;
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
        isSelected 
          ? "bg-primary/10 border-2 border-primary" 
          : "hover:bg-accent border-2 border-transparent"
      )}
    >
      <Avatar className="h-10 w-10 flex-shrink-0">
        <AvatarImage src={avatarUrl} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{displayName}</div>
        <div className="text-xs text-muted-foreground truncate">
          @{displayName.toLowerCase().replace(/\s+/g, '')}
        </div>
      </div>
      {isSelected && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
          <Check className="w-4 h-4 text-primary-foreground" />
        </div>
      )}
    </button>
  );
}

export function NewConversationDialog({ onStartConversation }: NewConversationDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [selectedPubkeys, setSelectedPubkeys] = useState<string[]>([]);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const { toast } = useToast();
  const { conversations } = useDMContext();
  const { data: follows = [], isLoading: isLoadingFollows } = useFollows();

  // Combine follows with previous conversations for a comprehensive contact list
  // Deduplicate by pubkey, prioritizing follows (first in array)
  const allContacts = useMemo(() => {
    const previousConversationPubkeys = conversations.map(c => c.pubkey);
    const uniquePubkeys = new Set<string>();
    
    // Add follows first
    follows.forEach(pubkey => uniquePubkeys.add(pubkey));
    
    // Then add previous conversations that aren't already in follows
    previousConversationPubkeys.forEach(pubkey => uniquePubkeys.add(pubkey));
    
    return Array.from(uniquePubkeys);
  }, [follows, conversations]);

  // Batch-fetch metadata for all contacts in one query (much more efficient!)
  const { data: authorsMap = new Map(), isLoading: isLoadingMetadata } = useAuthorsBatch(allContacts);
  
  // Combined loading state
  const isLoading = isLoadingFollows || isLoadingMetadata;

  // Filter contacts based on search (now we can filter properly since we have metadata)
  const filteredContacts = useMemo(() => {
    if (!searchInput.trim()) {
      return allContacts;
    }
    
    const searchLower = searchInput.toLowerCase().trim();
    
    // Filter contacts that match search term in display name
    return allContacts.filter(pubkey => {
      const author = authorsMap.get(pubkey);
      const displayName = author?.metadata?.name || genUserName(pubkey);
      return displayName.toLowerCase().includes(searchLower);
    });
  }, [allContacts, searchInput, authorsMap]);

  const handleToggleContact = (pubkey: string) => {
    setSelectedPubkeys(prev => 
      prev.includes(pubkey) 
        ? prev.filter(p => p !== pubkey)
        : [...prev, pubkey]
    );
  };

  const handleAddManual = () => {
    if (!manualInput.trim()) return;

    try {
      let pubkey: string;

      // Check if input is already a hex pubkey (64 characters)
      if (/^[0-9a-f]{64}$/i.test(manualInput)) {
        pubkey = manualInput.toLowerCase();
      } else if (manualInput.startsWith('npub1')) {
        const decoded = nip19.decode(manualInput);
        if (decoded.type !== 'npub') {
          throw new Error('Invalid npub format');
        }
        pubkey = decoded.data;
      } else if (manualInput.startsWith('nprofile1')) {
        const decoded = nip19.decode(manualInput);
        if (decoded.type !== 'nprofile') {
          throw new Error('Invalid nprofile format');
        }
        pubkey = decoded.data.pubkey;
      } else {
        throw new Error('Please enter a valid npub, nprofile, or hex pubkey');
      }

      if (!selectedPubkeys.includes(pubkey)) {
        setSelectedPubkeys([...selectedPubkeys, pubkey]);
        setManualInput('');
        setShowManualEntry(false);
      }
    } catch (error) {
      toast({
        title: 'Invalid input',
        description: error instanceof Error ? error.message : 'Please enter a valid Nostr identifier',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedPubkeys.length === 0) {
      toast({
        title: 'No contacts selected',
        description: 'Please select at least one contact to start a conversation',
        variant: 'destructive',
      });
      return;
    }

    // For group chats with multiple recipients
    if (selectedPubkeys.length > 1) {
      const groupId = `group:${[...selectedPubkeys].sort().join(',')}`;
      onStartConversation(groupId);
      
      toast({
        title: 'Group chat started',
        description: `Starting conversation with ${selectedPubkeys.length} people`,
      });
    } else {
      // Single recipient
      onStartConversation(selectedPubkeys[0]);
    }

    setOpen(false);
    setSelectedPubkeys([]);
    setSearchInput('');
    setManualInput('');
    setShowManualEntry(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSelectedPubkeys([]);
      setSearchInput('');
      setManualInput('');
      setShowManualEntry(false);
    }
  };

  const visibleContacts = useMemo(() => {
    return filteredContacts.map(pubkey => {
      const author = authorsMap.get(pubkey);
      const metadata = author?.metadata;
      
      return (
        <ContactRow
          key={pubkey}
          pubkey={pubkey}
          isSelected={selectedPubkeys.includes(pubkey)}
          onToggle={() => handleToggleContact(pubkey)}
          metadata={metadata}
        />
      );
    });
  }, [filteredContacts, selectedPubkeys, authorsMap]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
          <DialogTitle>New Conversation</DialogTitle>
          <DialogDescription>
            Select one or more contacts to start messaging. Showing people you follow.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Search Input */}
          <div className="px-6 pb-4 flex-shrink-0">
            <Input
              placeholder="Search by name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Contact List */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6">
            <div className="space-y-2 pb-4">
              {isLoading ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">Loading contacts...</p>
                </div>
              ) : visibleContacts.length > 0 ? (
                visibleContacts
              ) : (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground mb-4">
                    {searchInput ? 'No contacts found' : 'No contacts available'}
                  </p>
                  {!showManualEntry && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowManualEntry(true)}
                    >
                      Enter pubkey manually
                    </Button>
                  )}
                </div>
              )}

              {/* Manual Entry Section */}
              {showManualEntry && (
                <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Enter Public Key</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowManualEntry(false);
                        setManualInput('');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="npub1... or hex"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      className="font-mono text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddManual();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      onClick={handleAddManual}
                      size="sm"
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}

              {/* Show manual entry button at bottom if we have contacts */}
              {visibleContacts.length > 0 && !showManualEntry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowManualEntry(true)}
                  className="w-full mt-2"
                >
                  Enter pubkey manually
                </Button>
              )}
            </div>
          </div>

          {/* Footer with selected count and action buttons */}
          <div className="border-t px-6 py-4 bg-muted/30 flex-shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {selectedPubkeys.length === 0 
                  ? 'No contacts selected' 
                  : `${selectedPubkeys.length} ${selectedPubkeys.length === 1 ? 'contact' : 'contacts'} selected`
                }
              </p>
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={selectedPubkeys.length === 0}
                >
                  Start Chat
                </Button>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
