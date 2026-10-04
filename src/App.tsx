import { SearchWindow } from "./features/search/SearchWindow";
import { SettingsWindow } from "./features/settings/SettingsWindow";

interface AppProps {
  window: "search" | "settings";
}

/**
 * Two entries share one bundle; the window label decides which surface to
 * render.
 *
 * The outer padding is the room the floating panel's shadow needs inside the
 * transparent, frameless window. The window itself is sized to the panel plus
 * that padding, so the two must stay in sync with `tauri.conf.json`.
 */
export default function App({ window }: AppProps) {
  if (window === "settings") {
    return (
      <div className="flex h-full w-full justify-center p-3">
        <div className="h-full w-full max-w-[496px]">
          <SettingsWindow />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full justify-center p-3">
      <div className="h-full w-full max-w-[628px]">
        <SearchWindow />
      </div>
    </div>
  );
}
