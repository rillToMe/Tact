import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppError,
  ChatEvent,
  ChatMessage,
  SearchEngine,
  Settings,
  SettingsPayload,
  ShortcutStatus,
} from "../types";

export function toAppError(error: unknown): AppError {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") {
      return {
        code: (typeof e.code === "string" ? e.code : "internal") as AppError["code"],
        message: e.message,
      };
    }
  }
  if (error instanceof Error) {
    return { code: "internal", message: error.message };
  }
  return { code: "internal", message: "Something went wrong." };
}

export const ipc = {
  async getSettings(): Promise<SettingsPayload> {
    return invoke("get_settings");
  },

  async updateSettings(settings: Settings): Promise<SettingsPayload> {
    return invoke("update_settings", { settings });
  },

  async listSearchEngines(): Promise<SearchEngine[]> {
    return invoke("list_search_engines");
  },

  async getShortcutStatus(): Promise<ShortcutStatus> {
    return invoke("get_shortcut_status");
  },

  async captureShortcut(capturing: boolean): Promise<ShortcutStatus> {
    return invoke("capture_shortcut", { capturing });
  },

  async submitSearch(query: string): Promise<string> {
    return invoke("submit_search", { query });
  },

  async hideSearchWindow(): Promise<void> {
    return invoke("hide_search_window");
  },

  /** Grows or shrinks the search window between search bar and AI panel. */
  async setSearchExpanded(expanded: boolean): Promise<void> {
    return invoke("set_search_expanded", { expanded });
  },

  /**
   * Stores the AI API key in the Windows Credential Manager.
   *
   * The key is written straight to the OS store and is never persisted in
   * `settings.json`, so it is absent from every settings payload.
   */
  async setAiApiKey(apiKey: string): Promise<void> {
    return invoke("set_ai_api_key", { apiKey });
  },

  async clearAiApiKey(): Promise<void> {
    return invoke("clear_ai_api_key");
  },

  /**
   * Streams a chat completion, calling `onEvent` for every token.
   *
   * Uses a channel rather than a global event so the stream is scoped to this
   * call: no listener is left behind if the window is hidden mid-reply.
   */
  async sendChatMessage(
    messages: ChatMessage[],
    onEvent: (event: ChatEvent) => void,
  ): Promise<void> {
    const onEventChannel = new Channel<ChatEvent>();
    onEventChannel.onmessage = onEvent;
    return invoke("send_chat_message", { request: { messages }, onEvent: onEventChannel });
  },

  async openSettingsWindow(): Promise<void> {
    return invoke("open_settings_window");
  },

  async hideSettingsWindow(): Promise<void> {
    return invoke("hide_settings_window");
  },

  async quitApp(): Promise<void> {
    return invoke("quit_app");
  },
};

export type Unlisten = () => void;

export function onSettingsChanged(
  handler: (payload: Settings) => void,
): Promise<Unlisten> {
  return listen<Settings>("settings://changed", (event) => {
    handler(event.payload);
  });
}

export function onSearchOpened(handler: () => void): Promise<Unlisten> {
  return listen("search://opened", () => {
    handler();
  });
}
