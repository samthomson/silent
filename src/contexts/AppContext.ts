import { createContext } from "react";
import type { RelayMode } from "@samthomson/nostr-messaging/core";

export type Theme = "dark" | "light" | "system";

export interface AppConfig {
  theme: Theme;
  /** Discovery relays (also passed as messagingConfig.discoveryRelays for the package). */
  discoveryRelays: string[];
  messagingConfig: {
    /** When false, DM sync and subscriptions are off and local message cache is cleared. Default true. */
    enabled?: boolean;
    relayMode: RelayMode;
    renderInlineMedia?: boolean;
    devMode?: boolean;
    soundPref?: { enabled: boolean; soundId: string };
  };
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
