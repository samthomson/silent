import { useSeoMeta } from '@unhead/react';
import { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DMMessagingInterface } from '@/components/dm/DMMessagingInterface';
import { DoduoHeader } from '@/components/DoduoHeader';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { MessageSquare, Shield, Lock, Zap } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { Moon, Sun } from 'lucide-react';
import { useDMContext } from '@/contexts/DMContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DMStatusInfo } from '@/components/dm/DMStatusInfo';

const Index = () => {
  const { user } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const { clearCacheAndRefetch } = useDMContext();

  useSeoMeta({
    title: 'Doduo - Private Messaging on Nostr',
    description: 'End-to-end encrypted messaging powered by Nostr. Signal-like privacy with decentralized infrastructure.',
  });

  if (user) {
    return (
      <>
        {/* Status Modal */}
        <Dialog open={statusModalOpen} onOpenChange={setStatusModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Messaging Status</DialogTitle>
              <DialogDescription>
                View loading status, cache info, and connection details
              </DialogDescription>
            </DialogHeader>
            <DMStatusInfo clearCacheAndRefetch={clearCacheAndRefetch} />
          </DialogContent>
        </Dialog>

        <div className="h-screen flex flex-col bg-background">
          <DoduoHeader onStatusClick={() => setStatusModalOpen(true)} />
          <div className="flex-1 overflow-hidden">
            <DMMessagingInterface />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Theme Toggle */}
      <div className="absolute top-6 right-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="rounded-full"
        >
          {theme === 'dark' ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </Button>
      </div>

      {/* Hero Section */}
      <div className="container mx-auto px-4 pt-20 pb-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Logo & Title */}
          <div className="space-y-4">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-primary/80 shadow-2xl shadow-primary/25">
              <MessageSquare className="w-12 h-12 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <h1 className="text-6xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Doduo
            </h1>
            <p className="text-2xl text-muted-foreground font-medium">
              Private messaging, decentralized
            </p>
          </div>

          {/* Feature Cards */}
          <div className="grid md:grid-cols-3 gap-6 mt-16">
            <div className="group p-8 rounded-2xl bg-card border border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Shield className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">End-to-End Encrypted</h3>
              <p className="text-muted-foreground">
                Military-grade NIP-44 encryption ensures only you and your contacts can read messages
              </p>
            </div>

            <div className="group p-8 rounded-2xl bg-card border border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Lock className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Metadata Private</h3>
              <p className="text-muted-foreground">
                Gift-wrapped messages hide sender identity and timestamps from relays
              </p>
            </div>

            <div className="group p-8 rounded-2xl bg-card border border-border hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Zap className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Decentralized</h3>
              <p className="text-muted-foreground">
                No central servers. Your keys, your data, your freedom
              </p>
            </div>
          </div>

          {/* CTA Section */}
          <div className="mt-16 space-y-6">
            <div className="max-w-md mx-auto">
              <LoginArea className="w-full flex justify-center" />
            </div>
            <p className="text-sm text-muted-foreground">
              Powered by Nostr protocol • NIP-17 private messages
            </p>
          </div>

          {/* Footer */}
          <div className="mt-20 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Vibed with{' '}
              <a
                href="https://soapbox.pub/mkstack"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-medium"
              >
                MKStack
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
