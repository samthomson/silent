import { useState, useMemo, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageSquarePlus, X, Check } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useNewDMContext } from '@/contexts/NewDMProviderWrapper';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useAuthorsBatch } from '@/hooks/useAuthorsBatch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getDisplayName } from '@/lib/genUserName';
import { Pure as DMLib } from '@samthomson/nostr-messaging/core';

interface NewConversationDialogProps {
  onStartConversation: (pubkey: string) => void;
}

const EMPTY_AUTHORS_MAP = new Map();

export function NewConversationDialog({ onStartConversation }: NewConversationDialogProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedPubkeys, setSelectedPubkeys] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { messagingState } = useNewDMContext();
  const { user } = useCurrentUser();
  
  const conversationsList = useMemo(() => {
    if (!messagingState?.conversationMetadata) return [];
    return Object.values(messagingState.conversationMetadata);
  }, [messagingState?.conversationMetadata]);
  const { data: follows = [], isLoading: isLoadingFollows } = useFollows();

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const allContacts = useMemo(() => {
    // Extract individual pubkeys from conversations (including group members)
    const knownConversationPubkeys = conversationsList
      .filter(c => c.isKnown)
      .flatMap(c => c.participantPubkeys);
    
    // Include current user explicitly (for self-messaging support)
    const allPubkeys = [
      user?.pubkey,
      ...follows,
      ...knownConversationPubkeys
    ].filter((pk): pk is string => !!pk);
    
    return Array.from(new Set(allPubkeys));
  }, [follows, conversationsList, user?.pubkey]);

  // Include selected pubkeys in metadata fetch (for manually added pubkeys)
  const pubkeysToFetch = useMemo(() => {
    // Only fetch when dialog is open to avoid unnecessary requests
    if (!dialogOpen) return [];
    return Array.from(new Set([...allContacts, ...selectedPubkeys]));
  }, [dialogOpen, allContacts, selectedPubkeys]);

  // Batch-fetch metadata in chunks (works efficiently for any list size)
  // Returns immediately so UI can render, metadata fills in progressively
  const { data: authorsMap = EMPTY_AUTHORS_MAP, isFetching: isFetchingMetadata } = useAuthorsBatch(pubkeysToFetch);
  
  // Show loading only for initial follows fetch, not metadata (UI renders immediately)
  const isLoading = isLoadingFollows;

  // Filter contacts based on search (now we can filter properly since we have metadata)
  const filteredContacts = useMemo(() => {
    if (!debouncedSearch.trim()) {
      return allContacts;
    }
    
    const searchLower = debouncedSearch.toLowerCase().trim();
    
    // Filter and rank contacts by match relevance
    const matches = allContacts
      .map(pubkey => {
        const author = authorsMap.get(pubkey);
        const metadata = author?.metadata;
        const displayName = getDisplayName(pubkey, metadata);
        const displayNameLower = displayName.toLowerCase();
        const userName = metadata?.name?.toLowerCase();
        
        // Check if matches
        const displayMatches = displayNameLower.includes(searchLower);
        const userNameMatches = userName?.includes(searchLower);
        
        if (!displayMatches && !userNameMatches) {
          return null;
        }
        
        // Calculate relevance score (lower = better)
        let score = 0;
        
        if (displayNameLower.startsWith(searchLower)) {
          score = 0; // Exact start match in display name (highest priority)
        } else if (userName?.startsWith(searchLower)) {
          score = 1; // Exact start match in username
        } else if (displayMatches) {
          score = 2; // Contains in display name
        } else if (userNameMatches) {
          score = 3; // Contains in username
        }
        
        return { pubkey, score };
      })
      .filter((match): match is { pubkey: string; score: number } => match !== null)
      .sort((a, b) => a.score - b.score)
      .map(match => match.pubkey);
    
    return matches;
  }, [allContacts, debouncedSearch, authorsMap]);

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

    if (!user?.pubkey) {
      toast({
        title: 'Not logged in',
        description: 'You must be logged in to start a conversation',
        variant: 'destructive',
      });
      return;
    }

    // Create conversation ID from all participants (including current user)
    // Empty string for subject (no subject for direct 1-on-1 or group chats)
    const conversationId = DMLib.Conversation.computeConversationId([user.pubkey, ...selectedPubkeys]);
    onStartConversation(conversationId);
    
    if (selectedPubkeys.length > 1) {
      toast({
        title: 'Group chat started',
        description: `Starting conversation with ${selectedPubkeys.length} people`,
      });
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
        // Keep the index position, but adjust if now out of bounds
        const newLength = allContacts.length;
        if (highlightedIndex >= newLength) {
          setHighlightedIndex(Math.max(0, newLength - 1));
        }
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
        <DialogHeader className="px-6 pt-6 pb-2 flex-shrink-0">
          <DialogTitle>New Conversation</DialogTitle>
        </DialogHeader>

        <div className="px-6">
          <p className="text-sm text-muted-foreground">
            Select one or more contacts to start messaging. Select from people you follow or have already messaged, or enter a pubkey.
          </p>
        </div>

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(e);
          }} 
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
        >
          {/* Autocomplete Dropdown */}
          <div className="px-6 pb-4 pt-5 flex-shrink-0">
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
                    const displayName = getDisplayName(pubkey, metadata);
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
                    placeholder={selectedContacts.length === 0 ? 'Search or paste pubkey...' : ''}
                    className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
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
                        const displayName = getDisplayName(pubkey, metadata);
                        const avatarUrl = metadata?.picture;
                        const initials = displayName.slice(0, 2).toUpperCase();
                        const isSelected = selectedPubkeys.includes(pubkey);
                        const isHighlighted = highlightedIndex === index;

                        // Show secondary text only if we have both display_name and name, or show truncated npub
                        const hasDisplayName = !!metadata?.display_name;
                        const userName = metadata?.name;
                        const showSecondaryText = hasDisplayName && userName && userName !== metadata.display_name;
                        const secondaryText = showSecondaryText 
                          ? `@${userName}` 
                          : displayName.startsWith('npub1') 
                            ? displayName 
                            : undefined;

                        return (
                          <div
                            key={pubkey}
                            data-contact-item
                            onClick={() => {
                              handleToggleContact(pubkey);
                              setSearchInput('');
                              setPopoverOpen(false);
                              // Keep the index position
                              setHighlightedIndex(index);
                            }}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            className={cn(
                              "flex items-center gap-2.5 px-3 h-14 cursor-pointer transition-colors",
                              isHighlighted ? "bg-accent" : "hover:bg-accent/50"
                            )}
                          >
                            <Avatar className="h-7 w-7 flex-shrink-0">
                              <AvatarImage src={avatarUrl} />
                              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0 py-1.5">
                              <div className="text-sm font-medium truncate leading-tight">{displayName}</div>
                              <div className="text-xs text-muted-foreground truncate leading-tight">
                                {secondaryText || '\u00A0'}
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
