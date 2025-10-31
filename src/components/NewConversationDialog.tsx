import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { MessageSquarePlus } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

interface NewConversationDialogProps {
  onStartConversation: (pubkey: string) => void;
}

export function NewConversationDialog({ onStartConversation }: NewConversationDialogProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    try {
      let pubkey: string;

      // Check if input is already a hex pubkey (64 characters)
      if (/^[0-9a-f]{64}$/i.test(input)) {
        pubkey = input.toLowerCase();
      } else if (input.startsWith('npub1')) {
        // Decode npub
        const decoded = nip19.decode(input);
        if (decoded.type !== 'npub') {
          throw new Error('Invalid npub format');
        }
        pubkey = decoded.data;
      } else if (input.startsWith('nprofile1')) {
        // Decode nprofile
        const decoded = nip19.decode(input);
        if (decoded.type !== 'nprofile') {
          throw new Error('Invalid nprofile format');
        }
        pubkey = decoded.data.pubkey;
      } else {
        throw new Error('Please enter a valid npub, nprofile, or hex pubkey');
      }

      onStartConversation(pubkey);
      setOpen(false);
      setInput('');
    } catch (error) {
      toast({
        title: 'Invalid input',
        description: error instanceof Error ? error.message : 'Please enter a valid Nostr identifier',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Conversation</DialogTitle>
          <DialogDescription>
            Enter a Nostr public key to start a private conversation
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pubkey">Public Key</Label>
            <Input
              id="pubkey"
              placeholder="npub1... or hex pubkey"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Accepts npub, nprofile, or hex format
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Start Chat</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
