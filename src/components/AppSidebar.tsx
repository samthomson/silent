import { MessageSquare, Settings, HelpCircle, User, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { HelpDialog } from '@/components/HelpDialog';
import { SettingsModal } from '@/components/SettingsModal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';

export function AppSidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { user } = useCurrentUser();
  const { currentUser, removeLogin } = useLoggedInAccounts();
  const author = useAuthor(user?.pubkey || '');
  const metadata = author.data?.metadata;

  const displayName = metadata?.name || 'Anon';
  const avatarUrl = metadata?.picture;
  const initials = metadata?.name ? displayName.slice(0, 2).toUpperCase() : '?';

  return (
    <>
      <div className="w-16 bg-sidebar border-r border-sidebar-border flex flex-col items-center pt-4 pb-4 gap-4 flex-shrink-0">
        {/* App Icon - Top */}
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted hover:bg-accent transition-colors cursor-pointer">
          <MessageSquare className="w-5 h-5 text-foreground" strokeWidth={2} />
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
              <Avatar className="h-10 w-10 cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="right" className="w-48">
            <DropdownMenuItem onClick={() => setSettingsOpen(true)} className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              <span>Edit Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => currentUser && removeLogin(currentUser.id)} 
              className="cursor-pointer text-red-500"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab="profile" />
    </>
  );
}

