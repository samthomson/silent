import { MessageSquare, Moon, Sun, Palette, Database, Code, X, ArrowLeft, ChevronRight, Radio, AlertTriangle, User, Wifi, LogOut } from 'lucide-react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { DMStatusInfo } from '@/components/dm/DMStatusInfo';
import { useNewDMContext } from '@/contexts/NewDMContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import * as DMLib from '@samthomson/nostr-messaging/core';
import { RELAY_MODE, type RelayMode } from '@samthomson/nostr-messaging/core';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { RelayListManager } from '@/components/RelayListManager';
import { EditProfileForm } from '@/components/EditProfileForm';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: string;
}

function ProfileContent() {
  return (
    <div className="space-y-4">
      <EditProfileForm />
    </div>
  );
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
  const { clearCacheAndRefetch } = useNewDMContext();

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

function RelayModeContent() {
  const { config, updateConfig } = useAppContext();
  const relayMode = config.relayMode;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-3">Connection Mode</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Choose how the app discovers and connects to relays for direct messages
        </p>
        <div className="space-y-2">
          <button
            onClick={() => updateConfig((current) => ({ ...current, relayMode: RELAY_MODE.DISCOVERY }))}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              relayMode === RELAY_MODE.DISCOVERY
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-start gap-3">
              <Radio className={`h-5 w-5 mt-0.5 ${relayMode === RELAY_MODE.DISCOVERY ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <div className="font-medium">Discovery Only</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Use only the discovery relays from the Relay List tab. Fastest but may miss messages.
                </div>
              </div>
            </div>
          </button>

          <button
            onClick={() => updateConfig((current) => ({ ...current, relayMode: RELAY_MODE.HYBRID }))}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              relayMode === RELAY_MODE.HYBRID
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-start gap-3">
              <Radio className={`h-5 w-5 mt-0.5 ${relayMode === RELAY_MODE.HYBRID ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <div className="font-medium">Hybrid (Recommended)</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Combine discovery relays with user-specific inbox relays. Best balance of speed and reliability.
                </div>
              </div>
            </div>
          </button>

          <button
            onClick={() => updateConfig((current) => ({ ...current, relayMode: RELAY_MODE.STRICT_OUTBOX }))}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              relayMode === RELAY_MODE.STRICT_OUTBOX
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-start gap-3">
              <Radio className={`h-5 w-5 mt-0.5 ${relayMode === RELAY_MODE.STRICT_OUTBOX ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <div className="font-medium">Strict Outbox</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Use only each user&apos;s published inbox relays (NIP-65/NIP-17). Most private but may be slower.
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function RelayListContent() {
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

export function SettingsModal({ open, onOpenChange, defaultTab = 'appearance' }: SettingsModalProps) {
  const [mobileCategory, setMobileCategory] = useState<string | null>(null);
  const { messagingState, reloadAfterSettingsChange } = useNewDMContext();
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const { currentUser, removeLogin } = useLoggedInAccounts();
  const { toast } = useToast();
  
  // Track initial settings when modal opens
  const [initialSettings, setInitialSettings] = useState<{ discoveryRelays: string[]; relayMode: RelayMode } | null>(null);
  const [showReloadConfirm, setShowReloadConfirm] = useState(false);
  
  // Capture initial settings when modal opens
  useEffect(() => {
    if (open) {
      setInitialSettings({ 
        discoveryRelays: [...config.discoveryRelays],
        relayMode: config.relayMode,
      });
      setShowReloadConfirm(false);
    }
  }, [open, config.discoveryRelays, config.relayMode]);
  
  const failedRelayCount = useMemo(() => {
    if (!user || !messagingState) return 0;
    const userRelays = new Set(messagingState.participants[user.pubkey]?.derivedRelays || []);
    return Object.entries(messagingState.relayInfo || {})
      .filter(([relay, info]) => userRelays.has(relay) && !info.lastQuerySucceeded)
      .length;
  }, [messagingState, user]);
  
  // Check if settings changed
  const settingsChanged = useCallback(() => {
    if (!initialSettings) return false;
    const initialFingerprint = DMLib.Pure.Settings.computeFingerprint(initialSettings);
    const currentFingerprint = DMLib.Pure.Settings.computeFingerprint({ 
      discoveryRelays: config.discoveryRelays,
      relayMode: config.relayMode,
    });
    return initialFingerprint !== currentFingerprint;
  }, [initialSettings, config.discoveryRelays, config.relayMode]);
  
  // Handle close - check if settings changed
  const handleClose = useCallback(() => {
    if (settingsChanged()) {
      setShowReloadConfirm(true);
    } else {
      onOpenChange(false);
    }
  }, [settingsChanged, onOpenChange]);
  
  // Handle confirm reload
  const handleConfirmReload = useCallback(async () => {
    setShowReloadConfirm(false);
    onOpenChange(false);
    
    toast({
      title: 'Reloading messages',
      description: 'Updating relay configuration...',
    });
    
    try {
      await reloadAfterSettingsChange();
      toast({
        title: 'Messages reloaded',
        description: 'Messages updated successfully.',
      });
    } catch (error) {
      console.error('[Settings] Reload failed:', error);
      toast({
        title: 'Reload failed',
        description: 'Failed to reload messages.',
        variant: 'destructive',
      });
    }
  }, [reloadAfterSettingsChange, onOpenChange, toast]);
  
  // Handle cancel reload - revert settings
  const handleCancelReload = useCallback(() => {
    setShowReloadConfirm(false);
    
    if (!initialSettings) return;
    
    updateConfig((prev) => ({
      ...prev,
      discoveryRelays: [...initialSettings.discoveryRelays],
      relayMode: initialSettings.relayMode,
    }));
    
    toast({
      title: 'Settings reverted',
      description: 'Discovery relay changes were not applied.',
    });
  }, [initialSettings, updateConfig, toast]);

  return (
    <>
    <Dialog 
      open={open} 
      onOpenChange={(isOpen) => {
          if (!isOpen) {
            handleClose();
          } else {
        onOpenChange(isOpen);
          }
        if (!isOpen) setMobileCategory(null);
      }}
    >
      <DialogContent className="max-w-[95vw] w-full sm:max-w-2xl md:max-w-[700px] h-[90vh] md:h-[85vh] md:min-h-[600px] p-0 flex flex-col [&>button]:hidden md:[&>button]:block" aria-describedby={undefined}>
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
        <div className="md:hidden flex-1 min-h-0 flex flex-col overflow-hidden">
          {!mobileCategory ? (
            <>
              <div className="flex-1 min-h-0 overflow-auto">
                <div className="px-4 py-4 space-y-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-between h-auto py-4 px-4"
                    onClick={() => setMobileCategory('Profile')}
                  >
                    <div className="flex items-center gap-3">
                      <User className="h-5 w-5" />
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Profile</span>
                        <span className="text-xs text-muted-foreground">Edit your profile</span>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </Button>

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
                    onClick={() => setMobileCategory('Relay Mode')}
                  >
                    <div className="flex items-center gap-3">
                      <Wifi className="h-5 w-5" />
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Relay Mode</span>
                        <span className="text-xs text-muted-foreground">Connection strategy</span>
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
                          {failedRelayCount > 0 && <AlertTriangle className="h-4 w-4 text-red-500" />}
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
              </div>
              {user && (
                <div className="border-t border-sidebar-border px-4">
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 h-auto py-4 px-4 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => currentUser && removeLogin(currentUser.id)}
                  >
                    <LogOut className="h-5 w-5" />
                    Log out
                  </Button>
                </div>
              )}
            </>
          ) : mobileCategory === 'Profile' ? (
            <div className="px-4 py-4">
              <ProfileContent />
            </div>
          ) : mobileCategory === 'Appearance' ? (
            <div className="px-4 py-4">
              <AppearanceContent />
            </div>
          ) : mobileCategory === 'Messages' ? (
            <div className="px-4 py-4">
              <MessagesContent />
            </div>
          ) : mobileCategory === 'Relay Mode' ? (
            <div className="px-4 py-4">
              <RelayModeContent />
            </div>
          ) : mobileCategory === 'Relays' ? (
            <div className="px-4 py-4">
              <RelayListContent />
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
        </div>

        {/* Desktop: Tabbed layout */}
        <Tabs defaultValue={defaultTab} className="hidden md:flex flex-1 min-h-0 overflow-hidden">
          <div className="w-48 border-r flex-shrink-0 flex flex-col min-h-0">
            <TabsList className="flex flex-col w-full bg-transparent border-0 rounded-none px-2 pt-4 pb-2 gap-1 items-start justify-start flex-1 min-h-0 overflow-auto">
              <TabsTrigger 
                value="profile" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <User className="h-4 w-4" />
                Profile
              </TabsTrigger>
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
                value="relay-mode" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Wifi className="h-4 w-4" />
                Relay Mode
              </TabsTrigger>
              <TabsTrigger 
                value="relays" 
                className="w-full justify-start gap-3 data-[state=active]:bg-accent"
              >
                <Radio className="h-4 w-4" />
                Relays
                {failedRelayCount > 0 && <AlertTriangle className="h-3 w-3 ml-1 text-red-500" />}
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
            {user && (
              <div className="px-2 pb-4 pt-2 mt-auto border-t border-sidebar-border">
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 rounded-sm px-3 py-1.5 text-sm font-medium text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => currentUser && removeLogin(currentUser.id)}
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
            <div className="px-6 pt-4 pb-4 flex-1 min-h-0 overflow-auto">
              <TabsContent value="profile" className="mt-0 animate-in fade-in-0 duration-200">
                <ProfileContent />
              </TabsContent>

              <TabsContent value="appearance" className="mt-0 animate-in fade-in-0 duration-200">
                <AppearanceContent />
              </TabsContent>

              <TabsContent value="messages" className="mt-0 animate-in fade-in-0 duration-200">
                <MessagesContent />
              </TabsContent>

              <TabsContent value="relay-mode" className="mt-0 animate-in fade-in-0 duration-200">
                <RelayModeContent />
              </TabsContent>

              <TabsContent value="relays" className="mt-0 animate-in fade-in-0 duration-200">
                <RelayListContent />
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
    
    {/* Reload Confirmation Dialog */}
    <Dialog open={showReloadConfirm} onOpenChange={setShowReloadConfirm}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reload Messages?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your relay configuration has changed. Messages must be reloaded from the new relays.
          </p>
          <p className="text-sm text-muted-foreground">
            This may take a few seconds depending on your message history.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleCancelReload}>
              Cancel
            </Button>
            <Button onClick={handleConfirmReload}>
              Reload Messages
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
  );
}

