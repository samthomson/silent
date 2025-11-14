import { MessageSquare, Moon, Sun, Palette, Database, Code, X, ArrowLeft, ChevronRight, Radio, AlertTriangle } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
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
import { RelayListManager } from '@/components/RelayListManager';

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

function MessagesContent() {
  const { config, updateConfig } = useAppContext();

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold mb-3">Display</h3>
      <div className="flex items-center justify-between">
        <div className="flex flex-col items-start">
          <Label htmlFor="inline-media" className="font-medium cursor-pointer">
            Render Inline Media
          </Label>
          <span className="text-xs text-muted-foreground">
            Show images and videos directly in messages
          </span>
        </div>
        <Switch
          id="inline-media"
          checked={config.renderInlineMedia ?? true}
          onCheckedChange={(checked) => {
            updateConfig((current) => ({ ...current, renderInlineMedia: checked }));
          }}
        />
      </div>
    </div>
  );
}

function RelaysContent() {
  return (
    <div className="space-y-4">
      <RelayListManager />
    </div>
  );
}

function AdvancedContent() {
  const { config, updateConfig } = useAppContext();
  const devMode = config.devMode ?? false;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold mb-3">Developer Options</h3>
      <div className="flex items-center justify-between">
        <div className="flex flex-col items-start">
          <Label htmlFor="dev-mode" className="font-medium cursor-pointer">
            Developer Mode
          </Label>
          <span className="text-xs text-muted-foreground">
            See what&apos;s going on under the hood.
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
  );
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [mobileCategory, setMobileCategory] = useState<string | null>(null);
  const { relayError } = useDMContext();
  const [activeTab, setActiveTab] = useState('appearance');
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);

  const measureHeight = useCallback(() => {
    if (contentRef.current) {
      const height = contentRef.current.scrollHeight;
      setContentHeight(height);
    }
  }, []);

  // Measure height when dialog opens (initial measurement)
  useEffect(() => {
    if (open && contentHeight === undefined) {
      const timer = setTimeout(measureHeight, 50);
      return () => clearTimeout(timer);
    }
  }, [open, contentHeight, measureHeight]);

  // Measure height when tab changes
  useEffect(() => {
    if (contentHeight !== undefined) {
      const timer = setTimeout(measureHeight, 0);
      return () => clearTimeout(timer);
    }
  }, [activeTab, contentHeight, measureHeight]);

  return (
    <Dialog 
      open={open} 
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) setMobileCategory(null);
      }}
    >
      <DialogContent className="max-w-[95vw] w-full sm:max-w-2xl md:max-w-[700px] p-0 max-h-[90vh] flex flex-col [&>button]:hidden md:[&>button]:block" aria-describedby={undefined}>
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
                onClick={() => setMobileCategory('Messages')}
              >
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Messages</span>
                    <span className="text-xs text-muted-foreground">Message display settings</span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Button>

              <Button
                variant="ghost"
                className="w-full justify-between h-auto py-4 px-4"
                onClick={() => setMobileCategory('Relays')}
              >
                <div className="flex items-center gap-3">
                  <Radio className="h-5 w-5" />
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Relays</span>
                      {relayError && <AlertTriangle className="h-4 w-4 text-destructive" />}
                    </div>
                    <span className="text-xs text-muted-foreground">Manage your relay list</span>
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
          ) : mobileCategory === 'Messages' ? (
            <div className="px-4 py-4">
              <MessagesContent />
            </div>
          ) : mobileCategory === 'Relays' ? (
            <div className="px-4 py-4">
              <RelaysContent />
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
        <Tabs defaultValue="appearance" onValueChange={setActiveTab} className="hidden md:flex flex-1 min-h-0">
          <div className="w-48 border-r flex-shrink-0 self-stretch">
            <TabsList className="flex flex-col w-full h-full bg-transparent border-0 rounded-none px-2 pt-0 pb-4 gap-1 items-start justify-start">
              <TabsTrigger 
                value="appearance" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Palette className="h-4 w-4" />
                Appearance
              </TabsTrigger>
              <TabsTrigger 
                value="messages" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <MessageSquare className="h-4 w-4" />
                Messages
              </TabsTrigger>
              <TabsTrigger 
                value="relays" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Radio className="h-4 w-4" />
                Relays
                {relayError && <AlertTriangle className="h-3 w-3 ml-1 text-destructive" />}
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

          <div 
            className="flex-1 min-w-0 overflow-hidden transition-all duration-700 ease-in-out"
            style={{ height: contentHeight ? `${contentHeight}px` : 'auto' }}
          >
            <div ref={contentRef} className="px-6 pt-0 pb-4 h-full overflow-auto">
              <TabsContent value="appearance" className="mt-0 animate-in fade-in-0 duration-200">
                <AppearanceContent />
              </TabsContent>

              <TabsContent value="messages" className="mt-0 animate-in fade-in-0 duration-200">
                <MessagesContent />
              </TabsContent>

              <TabsContent value="relays" className="mt-0 animate-in fade-in-0 duration-200">
                <RelaysContent />
              </TabsContent>

              <TabsContent value="storage" className="mt-0 animate-in fade-in-0 duration-200">
                <StorageContent />
              </TabsContent>

              <TabsContent value="advanced" className="mt-0 animate-in fade-in-0 duration-200">
                <AdvancedContent />
              </TabsContent>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

