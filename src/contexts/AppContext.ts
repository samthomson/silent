import { createContext } from "react";

export type Theme = "dark" | "light" | "system";

export interface AppConfig {
  /** Current theme */
  theme: Theme;
  /** Discovery relays - used to find NIP-65 and as default relay pool */
  discoveryRelays: string[];
  /** Developer mode toggle */
  devMode?: boolean;
  /** Render images and media inline in messages */
  renderInlineMedia?: boolean;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
