import { useState, useMemo, useRef, useEffect } from 'react';
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
import { MessageSquarePlus, X, Check } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useDMContext } from '@/contexts/DMContext';
import { useFollows } from '@/hooks/useFollows';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface NewConversationDialogProps {
  onStartConversation: (pubkey: string) => void;
}


export function NewConversationDialog({ onStartConversation }: NewConversationDialogProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [selectedPubkeys, setSelectedPubkeys] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { conversations } = useDMContext();
  const { data: follows = [], isLoading: isLoadingFollows } = useFollows();

  const allContacts = useMemo(() => {
    const knownConversationPubkeys = conversations
      .filter(c => c.isKnown)
      .map(c => c.pubkey);
    
    return Array.from(new Set([...follows, ...knownConversationPubkeys]));
  }, [follows, conversations]);

  // Batch-fetch metadata in chunks (works efficiently for any list size)
  // Returns immediately so UI can render, metadata fills in progressively
  const { data: authorsMap = new Map(), isFetching: isFetchingMetadata } = useAuthorsBatch(allContacts);
  
  // Show loading only for initial follows fetch, not metadata (UI renders immediately)
  const isLoading = isLoadingFollows;

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

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-contact-item]');
      const highlightedItem = items[highlightedIndex];
      if (highlightedItem) {
        highlightedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [highlightedIndex]);

  const handleToggleContact = (pubkey: string) => {
    setSelectedPubkeys(prev => 
      prev.includes(pubkey) 
        ? prev.filter(p => p !== pubkey)
        : [...prev, pubkey]
    );
  };

  const handleAddManual = (input: string) => {
    if (!input.trim()) return;

    try {
      let pubkey: string;

      // Check if input is already a hex pubkey (64 characters)
      if (/^[0-9a-f]{64}$/i.test(input)) {
        pubkey = input.toLowerCase();
      } else if (input.startsWith('npub1')) {
        const decoded = nip19.decode(input);
        if (decoded.type !== 'npub') {
          throw new Error('Invalid npub format');
        }
        pubkey = decoded.data;
      } else if (input.startsWith('nprofile1')) {
        const decoded = nip19.decode(input);
        if (decoded.type !== 'nprofile') {
          throw new Error('Invalid nprofile format');
        }
        pubkey = decoded.data.pubkey;
      } else {
        return; // Not a pubkey, just return (will show in search)
      }

      if (!selectedPubkeys.includes(pubkey)) {
        setSelectedPubkeys([...selectedPubkeys, pubkey]);
        setSearchInput('');
        setPopoverOpen(false);
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

    // Try to add manual input if it looks like a pubkey
    if (searchInput.trim()) {
      handleAddManual(searchInput.trim());
    }

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

    setDialogOpen(false);
    setSelectedPubkeys([]);
    setSearchInput('');
    setPopoverOpen(false);
  };

  const handleDialogOpenChange = (isOpen: boolean) => {
    setDialogOpen(isOpen);
    if (!isOpen) {
      setSelectedPubkeys([]);
      setSearchInput('');
      setPopoverOpen(false);
    } else {
      // Ensure popover is closed when dialog opens
      setPopoverOpen(false);
    }
  };

  const selectedContacts = useMemo(() => {
    return selectedPubkeys.map(pubkey => {
      const author = authorsMap.get(pubkey);
      const metadata = author?.metadata;
      return { pubkey, metadata };
    });
  }, [selectedPubkeys, authorsMap]);

  const handleRemoveSelected = (pubkey: string) => {
    setSelectedPubkeys(prev => prev.filter(p => p !== pubkey));
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const currentFiltered = filteredContacts;
    
    if (e.key === 'Backspace' && searchInput === '' && selectedPubkeys.length > 0) {
      e.preventDefault();
      setSelectedPubkeys(prev => prev.slice(0, -1));
      setHighlightedIndex(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setPopoverOpen(true);
      setHighlightedIndex(prev => {
        if (currentFiltered.length === 0) return -1;
        return prev < currentFiltered.length - 1 ? prev + 1 : 0;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setPopoverOpen(true);
      setHighlightedIndex(prev => {
        if (currentFiltered.length === 0) return -1;
        return prev > 0 ? prev - 1 : currentFiltered.length - 1;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (highlightedIndex >= 0 && highlightedIndex < currentFiltered.length) {
        // Select highlighted contact
        const pubkey = currentFiltered[highlightedIndex];
        handleToggleContact(pubkey);
        setSearchInput('');
        setHighlightedIndex(-1);
      } else if (searchInput.trim()) {
        // Try to add as pubkey
        const trimmed = searchInput.trim();
        if (/^[0-9a-f]{64}$/i.test(trimmed) || trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')) {
          handleAddManual(trimmed);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setPopoverOpen(false);
      setHighlightedIndex(-1);
    }
  };


  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 overflow-hidden top-[25%] translate-y-[-25%]">
        <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
          <DialogTitle>New Conversation</DialogTitle>
          <DialogDescription>
            Select one or more contacts to start messaging. <br/>Select from people you follow or have already messaged, or enter a pubkey.
          </DialogDescription>
        </DialogHeader>

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(e);
          }} 
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
        >
          {/* Autocomplete Dropdown */}
          <div className="px-6 pb-4 flex-shrink-0">
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen} modal={false}>
              <PopoverTrigger asChild>
                <div
                  role="combobox"
                  aria-expanded={popoverOpen}
                  className="w-full min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 flex items-center gap-2 flex-wrap cursor-text"
                  onClick={() => {
                    // Focus input when container is clicked
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                >
                  {selectedContacts.map(({ pubkey, metadata }) => {
                    const displayName = metadata?.name || genUserName(pubkey);
                    const avatarUrl = metadata?.picture;
                    return (
                      <Badge
                        key={pubkey}
                        variant="secondary"
                        className="flex items-center gap-1.5 pr-1 h-6 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSelected(pubkey);
                        }}
                      >
                        <Avatar className="h-4 w-4">
                          <AvatarImage src={avatarUrl} />
                          <AvatarFallback className="text-[10px]">
                            {displayName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{displayName}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSelected(pubkey);
                          }}
                          className="ml-1 rounded-full hover:bg-muted p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value);
                      setPopoverOpen(true);
                      setHighlightedIndex(-1);
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder={selectedContacts.length === 0 
                      ? 'Search contacts or paste pubkey...'
                      : selectedContacts.length === 1
                      ? 'Search for more...'
                      : 'Search for more or paste pubkey...'}
                    className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    autoComplete="off"
                  />
                </div>
              </PopoverTrigger>
              <PopoverContent 
                className="w-[--radix-popover-trigger-width] p-0 overflow-hidden" 
                align="start" 
                side="bottom" 
                sideOffset={4}
                onOpenAutoFocus={(e) => {
                  e.preventDefault();
                  inputRef.current?.focus();
                }}
              >
                <div 
                  ref={listRef}
                  className="max-h-[300px] overflow-y-auto overscroll-contain"
                  style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
                  onWheel={(e) => e.stopPropagation()}
                >
                  {isLoading ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      Loading contacts...
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <div className="py-6 text-center">
                      {searchInput ? (
                        <>
                          <p className="text-sm text-muted-foreground mb-2">
                            No contacts found
                          </p>
                          {(/^[0-9a-f]{64}$/i.test(searchInput.trim()) || 
                            searchInput.trim().startsWith('npub1') || 
                            searchInput.trim().startsWith('nprofile1')) && (
                            <p className="text-xs text-muted-foreground">
                              Press Enter to add this pubkey
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Start typing to search or paste a pubkey
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="py-1">
                      {filteredContacts.map((pubkey, index) => {
                        const author = authorsMap.get(pubkey);
                        const metadata = author?.metadata;
                        const displayName = metadata?.name || genUserName(pubkey);
                        const avatarUrl = metadata?.picture;
                        const initials = displayName.slice(0, 2).toUpperCase();
                        const isSelected = selectedPubkeys.includes(pubkey);
                        const isHighlighted = highlightedIndex === index;

                        return (
                          <div
                            key={pubkey}
                            data-contact-item
                            onClick={() => {
                              handleToggleContact(pubkey);
                              setSearchInput('');
                              setHighlightedIndex(-1);
                            }}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                              isHighlighted ? "bg-accent" : "hover:bg-accent/50"
                            )}
                          >
                            <Avatar className="h-8 w-8 flex-shrink-0">
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
                              <Check className="h-4 w-4 text-primary flex-shrink-0" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {isFetchingMetadata && filteredContacts.length > 0 && (
                    <div className="py-2 text-center border-t">
                      <p className="text-xs text-muted-foreground">
                        Loading profile information...
                      </p>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
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
                  onClick={() => handleDialogOpenChange(false)}
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
