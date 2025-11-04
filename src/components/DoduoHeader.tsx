import { MessageSquare, Moon, Sun, Settings, Info } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { LoginArea } from '@/components/auth/LoginArea';
import { HelpDialog } from '@/components/HelpDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DoduoHeaderProps {
  onStatusClick?: () => void;
}

export function DoduoHeader({ onStatusClick }: DoduoHeaderProps) {
  const { theme, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/20">
              <MessageSquare className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Doduo
              </h1>
              <p className="text-xs text-muted-foreground">Private messaging</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <LoginArea className="max-w-48" />

            <HelpDialog />

            <Button 
              variant="ghost" 
              size="icon" 
              className="rounded-full"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Settings Modal */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your app preferences
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-2 py-4">
            <Button
              variant="ghost"
              className="w-full justify-start h-auto py-3 px-4"
              onClick={() => {
                setTheme(theme === 'dark' ? 'light' : 'dark');
              }}
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="mr-3 h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Light mode</span>
                    <span className="text-xs text-muted-foreground">Switch to light theme</span>
                  </div>
                </>
              ) : (
                <>
                  <Moon className="mr-3 h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Dark mode</span>
                    <span className="text-xs text-muted-foreground">Switch to dark theme</span>
                  </div>
                </>
              )}
            </Button>

            {onStatusClick && (
              <Button
                variant="ghost"
                className="w-full justify-start h-auto py-3 px-4"
                onClick={() => {
                  setSettingsOpen(false);
                  onStatusClick();
                }}
              >
                <Info className="mr-3 h-5 w-5" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">Status & Info</span>
                  <span className="text-xs text-muted-foreground">View messaging status</span>
                </div>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
