import { MessageSquare, Settings, HelpCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { HelpDialog } from '@/components/HelpDialog';
import { SettingsModal } from '@/components/SettingsModal';

export function AppSidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey || '');
  const metadata = author.data?.metadata;

  const displayName = metadata?.name || genUserName(user?.pubkey || '');
  const avatarUrl = metadata?.picture;
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <>
      <div className="w-16 bg-sidebar border-r border-sidebar-border flex flex-col items-center py-4 gap-4 flex-shrink-0">
        {/* App Icon - Top */}
        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-muted hover:bg-accent transition-colors cursor-pointer">
          <MessageSquare className="w-6 h-6 text-foreground" strokeWidth={2} />
        </div>

        {/* Spacer to push other items to bottom */}
        <div className="flex-1" />

        {/* Help Button */}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-10 h-10 text-muted-foreground hover:text-foreground"
          onClick={() => setHelpOpen(true)}
          aria-label="Help"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>

        {/* Settings Button */}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-10 h-10 text-muted-foreground hover:text-foreground"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </Button>

        {/* User Avatar - Bottom */}
        <Avatar className="h-10 w-10 cursor-pointer opacity-40 hover:opacity-100 transition-opacity">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback className="bg-primary text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

