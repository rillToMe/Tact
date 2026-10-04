import { getCurrentWindow } from "@tauri-apps/api/window";

export function currentWindowLabel(): "search" | "settings" {
  try {
    const label = getCurrentWindow().label;
    return label === "settings" ? "settings" : "search";
  } catch {
    return "search";
  }
}
