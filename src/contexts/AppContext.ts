import { createContext } from "react";
import type { MessagingConfig } from "@samthomson/nostr-messaging/core";

export type Theme = "dark" | "light" | "system";

export interface AppConfig {
  theme: Theme;
  /** Discovery relays (also passed as messagingConfig.discoveryRelays for the package). */
  discoveryRelays: string[];
  messagingConfig: MessagingConfig;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
