import { MessageSquare, Settings } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SettingsModal } from '@/components/SettingsModal';

export function AppSidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div className="w-16 bg-sidebar border-r border-sidebar-border flex flex-col items-center pt-4 pb-4 gap-4 flex-shrink-0">
        {/* App Icon - Top */}
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted hover:bg-accent transition-colors cursor-pointer">
          <MessageSquare className="w-5 h-5 text-foreground" strokeWidth={2} />
        </div>

        {/* Spacer to push other items to bottom */}
        <div className="flex-1" />

        {/* Settings - single entry point (Signal-style) */}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-10 h-10 text-muted-foreground hover:text-foreground"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab="profile" />
    </>
  );
}
