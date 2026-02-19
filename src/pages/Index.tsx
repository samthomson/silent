import { useSeoMeta } from '@unhead/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DMMessagingInterface } from '@samthomson/nostr-messaging/ui';
import { AppSidebar } from '@/components/AppSidebar';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { APP_NAME } from '@/lib/constants';
import { useDMContext } from '@/contexts/DMProviderWrapper';

const BASE_TITLE = `${APP_NAME} - DMs on Nostr`;

const Index = () => {
  const { user } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const { unreadTotal } = useDMContext();

  const title = user && unreadTotal > 0 ? `(${unreadTotal}) ${BASE_TITLE}` : BASE_TITLE;
  useSeoMeta({ title });

  if (user) {
    return (
      <div className="h-screen flex bg-background">
        <AppSidebar />
        <div className="flex-1 overflow-hidden">
          <DMMessagingInterface />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="absolute top-5 right-5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-10">
          <header className="space-y-6">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              {APP_NAME}
            </h1>
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-lg font-medium text-foreground">
                  Nostr DMs with NIP-17 + outbox model
                </p>
                <p className="text-muted-foreground/80">
                  (backwards compatible with NIP-44)
                </p>
              </div>
              <ul className="text-muted-foreground space-y-2 max-w-xs mx-auto text-left">
                <li>• Encrypted text and media</li>
                <li>• Fully searchable chat history</li>
                <li>• Shorts from your contacts</li>
                <li>• Works with older clients (non-outbox model + NIP-44)</li>
                <li>• Your keys, no central server - relays just relay</li>
              </ul>
            </div>
          </header>

          <div className="flex flex-col items-center gap-4">
            <LoginArea className="w-full flex flex-col sm:flex-row gap-3 sm:justify-center" />
          </div>
        </div>
      </main>

      <footer className="py-6 text-center border-t border-border">
        <p className="text-xs text-muted-foreground">
          Vibed with{' '}
          <a
            href="https://soapbox.pub/mkstack"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            MKStack
          </a>
        </p>
      </footer>
    </div>
  );
};

export default Index;