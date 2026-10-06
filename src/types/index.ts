export type Theme = "system" | "light" | "dark";

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  /**
   * `KeyboardEvent.code` of the key that switches the search bar into AI mode.
   *
   * Unlike the global shortcut this is handled inside the window, so a bare key
   * such as `Tab` is valid and is the default.
   */
  modeKey: string;
}

export interface Settings {
  schemaVersion: number;
  globalShortcut: string;
  searchEngine: string;
  theme: Theme;
  launchAtLogin: boolean;
  ai: AiSettings;
}

export interface SearchEngine {
  id: string;
  name: string;
  searchUrl: string;
  /** File name under `public/icons-search-engine/`. */
  icon: string;
}

/**
 * A `!bang` shortcut that sends the query straight to one site.
 *
 * Separate from `SearchEngine`: an engine is the default chosen in Settings,
 * while a bang is typed per query and is never a default.
 */
export interface Bang {
  /** What is typed after `!`, without the `!`. */
  keyword: string;
  name: string;
  searchUrl: string;
  icon: string;
}

export type ErrorCode =
  | "shortcutInvalid"
  | "shortcutInUse"
  | "settingsInvalid"
  | "openUrlFailed"
  | "windowUnavailable"
  | "emptyQuery"
  | "internal"
  | "aiNotConfigured"
  | "aiKeyMissing"
  | "aiKeyUnavailable"
  | "aiRequestFailed"
  | "startupUnavailable";

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
  /**
   * Whether an API key is stored in the Windows Credential Manager.
   *
   * The key itself never crosses the IPC boundary, so this boolean is the only
   * way the UI can report that one is saved.
   */
  apiKeySet: boolean;
}

/** One turn of an AI conversation, as sent to the provider. */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** A piece of a streamed reply, tagged so the handler can switch on `type`. */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "done"; reason: string | null };
