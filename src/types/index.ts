export type Theme = "system" | "light" | "dark";

export interface Settings {
  schemaVersion: number;
  globalShortcut: string;
  searchEngine: string;
  theme: Theme;
  launchAtLogin: boolean;
}

export interface SearchEngine {
  id: string;
  name: string;
  searchUrl: string;
  /** File name under `public/icons-search-engine/`. */
  icon: string;
}

export type ErrorCode =
  | "shortcutInvalid"
  | "shortcutInUse"
  | "settingsInvalid"
  | "openUrlFailed"
  | "windowUnavailable"
  | "emptyQuery"
  | "internal";

export interface AppError {
  code: ErrorCode;
  message: string;
}

export interface ShortcutStatus {
  accelerator: string;
  active: boolean;
  suspended: boolean;
  error: AppError | null;
}

export interface SettingsPayload {
  settings: Settings;
  shortcut: ShortcutStatus;
}
