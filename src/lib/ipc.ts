import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppError,
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
