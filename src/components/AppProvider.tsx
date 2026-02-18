import { ReactNode, useEffect } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType, type Theme } from '@/contexts/AppContext';
import { RELAY_MODE } from '@samthomson/nostr-messaging/core';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
}

// Zod schema for AppConfig validation
const AppConfigSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  discoveryRelays: z.array(z.string().url()),
  relayMode: z.enum([RELAY_MODE.DISCOVERY, RELAY_MODE.HYBRID, RELAY_MODE.STRICT_OUTBOX]),
  devMode: z.boolean().optional(),
  renderInlineMedia: z.boolean().optional(),
}) satisfies z.ZodType<AppConfig>;

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
  } = props;

  // App configuration state with localStorage persistence
  const [rawConfig, setConfig] = useLocalStorage<Partial<AppConfig>>(
    storageKey,
    {},
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);
        return AppConfigSchema.partial().parse(parsed);
      }
    }
  );

  // Generic config updater with callback pattern
  const updateConfig = (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => {
    setConfig(updater);
  };

  const config = { ...defaultConfig, ...rawConfig };

  const appContextValue: AppContextType = {
    config,
    updateConfig,
  };

  // Apply theme effects to document
  useApplyTheme(config.theme);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Hook to apply theme changes to the document root and update theme-color meta tag
 */
function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = window.document.documentElement;
    let currentTheme: 'light' | 'dark';

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      currentTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';
      root.classList.add(currentTheme);
    } else {
      currentTheme = theme;
      root.classList.add(theme);
    }

    // Update theme-color meta tag for mobile browser chrome
    updateThemeColor(currentTheme);
  }, [theme]);

  // Handle system theme changes when theme is set to "system"
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      
      const systemTheme = mediaQuery.matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      updateThemeColor(systemTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);
}

/**
 * Update the theme-color meta tag based on the current theme
 */
function updateThemeColor(theme: 'light' | 'dark') {
  let themeColorMeta = document.querySelector('meta[name="theme-color"]');
  
  if (!themeColorMeta) {
    themeColorMeta = document.createElement('meta');
    themeColorMeta.setAttribute('name', 'theme-color');
    document.head.appendChild(themeColorMeta);
  }
  
  // Use purple brand color for both themes (or adjust if needed)
  // For dark mode, you could use a darker shade: '#6d28d9' or keep the same
  const color = theme === 'dark' ? '#6d28d9' : '#8b5cf6';
  themeColorMeta.setAttribute('content', color);
}