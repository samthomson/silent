import { MessageSquare, Moon, Sun, Settings, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { LoginArea } from '@/components/auth/LoginArea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface DoduoHeaderProps {
  onStatusClick?: () => void;
}

export function DoduoHeader({ onStatusClick }: DoduoHeaderProps) {
  const { theme, setTheme } = useTheme();

  return (
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
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Settings className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? (
                  <>
                    <Sun className="mr-2 h-4 w-4" />
                    Light mode
                  </>
                ) : (
                  <>
                    <Moon className="mr-2 h-4 w-4" />
                    Dark mode
                  </>
                )}
              </DropdownMenuItem>
              {onStatusClick && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onStatusClick}>
                    <Info className="mr-2 h-4 w-4" />
                    Status & Info
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
