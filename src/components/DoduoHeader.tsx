import { MessageSquare, Moon, Sun, Settings, Info, Palette, Database } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

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
        <DialogContent className="max-w-[95vw] sm:max-w-2xl md:max-w-3xl p-0">
          <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your app preferences
            </DialogDescription>
          </DialogHeader>
          
          <Separator />

          <Tabs defaultValue="appearance" className="flex flex-col md:flex-row min-h-[300px] md:min-h-[400px]">
            <TabsList className="flex flex-row md:flex-col h-auto md:h-full w-full md:w-48 bg-transparent border-b md:border-b-0 md:border-r rounded-none p-2 gap-1 justify-start items-start">
              <TabsTrigger 
                value="appearance" 
                className="w-auto md:w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Palette className="h-4 w-4" />
                <span className="hidden sm:inline">Appearance</span>
              </TabsTrigger>
              <TabsTrigger 
                value="storage" 
                className="w-auto md:w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Database className="h-4 w-4" />
                <span className="hidden sm:inline">Storage</span>
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 px-4 md:px-6 py-4">
              <TabsContent value="appearance" className="mt-0 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-3">Theme</h3>
                  <Button
                    variant="outline"
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
                </div>
              </TabsContent>

              <TabsContent value="storage" className="mt-0 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-3">Data & Cache</h3>
                  {onStatusClick && (
                    <Button
                      variant="outline"
                      className="w-full justify-start h-auto py-3 px-4"
                      onClick={() => {
                        setSettingsOpen(false);
                        onStatusClick();
                      }}
                    >
                      <Info className="mr-3 h-5 w-5" />
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Status & Info</span>
                        <span className="text-xs text-muted-foreground">View messaging status and cache</span>
                      </div>
                    </Button>
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
