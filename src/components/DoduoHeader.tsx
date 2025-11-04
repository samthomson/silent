import { MessageSquare, Moon, Sun, Settings, Palette, Database, ChevronRight, ArrowLeft, X, Code } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { LoginArea } from '@/components/auth/LoginArea';
import { HelpDialog } from '@/components/HelpDialog';
import { DMStatusInfo } from '@/components/dm/DMStatusInfo';
import { useDMContext } from '@/contexts/DMContext';
import { useAppContext } from '@/hooks/useAppContext';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AppearanceContent() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
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
    </div>
  );
}

function StorageContent() {
  const { clearCacheAndRefetch } = useDMContext();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-3">Data & Cache</h3>
        <DMStatusInfo clearCacheAndRefetch={clearCacheAndRefetch} />
      </div>
    </div>
  );
}

function AdvancedContent() {
  const { config, updateConfig } = useAppContext();
  const devMode = config.devMode ?? false;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-3">Developer Options</h3>
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-start">
            <Label htmlFor="dev-mode" className="font-medium cursor-pointer">
              Developer Mode
            </Label>
            <span className="text-xs text-muted-foreground">
              Enable developer tools and debug features
            </span>
          </div>
          <Switch
            id="dev-mode"
            checked={devMode}
            onCheckedChange={(checked) => {
              updateConfig((current) => ({ ...current, devMode: checked }));
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [mobileCategory, setMobileCategory] = useState<string | null>(null);

  return (
    <Dialog 
      open={open} 
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) setMobileCategory(null);
      }}
    >
      <DialogContent className="max-w-[95vw] w-full sm:max-w-2xl md:max-w-[700px] p-0 max-h-[90vh] flex flex-col [&>button]:hidden md:[&>button]:block">
        {/* Mobile: Single-line header with arrow, title, and close */}
        <DialogHeader className="md:hidden flex flex-row items-center justify-between px-4 sm:px-6 pt-4 sm:pt-6">
          {mobileCategory ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -ml-2"
              onClick={() => setMobileCategory(null)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <div className="w-8 h-8" />
          )}
          <DialogTitle className="flex-1 text-center">{mobileCategory || 'Settings'}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mr-2"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* Desktop: Always show title */}
        <DialogHeader className="hidden md:block px-6 pt-6">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        
        <Separator />

        {/* Mobile: Category list or selected category content */}
        <ScrollArea className="md:hidden flex-1 overflow-auto">
          {!mobileCategory ? (
            // Category List
            <div className="px-4 py-4 space-y-2">
              <Button
                variant="ghost"
                className="w-full justify-between h-auto py-4 px-4"
                onClick={() => setMobileCategory('Appearance')}
              >
                <div className="flex items-center gap-3">
                  <Palette className="h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Appearance</span>
                    <span className="text-xs text-muted-foreground">Theme and display</span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Button>

              <Button
                variant="ghost"
                className="w-full justify-between h-auto py-4 px-4"
                onClick={() => setMobileCategory('Storage')}
              >
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Storage</span>
                    <span className="text-xs text-muted-foreground">Data and cache</span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Button>

              <Button
                variant="ghost"
                className="w-full justify-between h-auto py-4 px-4"
                onClick={() => setMobileCategory('Advanced')}
              >
                <div className="flex items-center gap-3">
                  <Code className="h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Advanced</span>
                    <span className="text-xs text-muted-foreground">Developer options</span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Button>
            </div>
          ) : mobileCategory === 'Appearance' ? (
            <div className="px-4 py-4">
              <AppearanceContent />
            </div>
          ) : mobileCategory === 'Storage' ? (
            <div className="px-4 py-4">
              <StorageContent />
            </div>
          ) : mobileCategory === 'Advanced' ? (
            <div className="px-4 py-4">
              <AdvancedContent />
            </div>
          ) : null}
        </ScrollArea>

        {/* Desktop: Tabbed layout */}
        <Tabs defaultValue="appearance" className="hidden md:flex flex-1 min-h-0">
          <div className="w-48 border-r pt-4 flex-shrink-0">
            <TabsList className="flex flex-col w-full bg-transparent border-0 rounded-none px-2 pb-2 gap-1 items-start">
              <TabsTrigger 
                value="appearance" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Palette className="h-4 w-4" />
                Appearance
              </TabsTrigger>
              <TabsTrigger 
                value="storage" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Database className="h-4 w-4" />
                Storage
              </TabsTrigger>
              <TabsTrigger 
                value="advanced" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Code className="h-4 w-4" />
                Advanced
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 min-w-0">
            <div className="px-6 pb-4">
              <TabsContent value="appearance" className="mt-0">
                <AppearanceContent />
              </TabsContent>

              <TabsContent value="storage" className="mt-0">
                <StorageContent />
              </TabsContent>

              <TabsContent value="advanced" className="mt-0">
                <AdvancedContent />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function DoduoHeader() {
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

      <SettingsModal 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen}
      />
    </>
  );
}
