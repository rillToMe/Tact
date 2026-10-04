import { useEffect, useState } from "react";
import { ipc, onSettingsChanged } from "../lib/ipc";
import { applyTheme } from "../lib/theme";
import type { SearchEngine } from "../types";

/** Engine icons are served as static files from `public/`. */
export const ENGINE_ICONS_BASE = "/icons-search-engine";

/**
 * The subset of settings the search window renders: the active engine, and the
 * theme.
 *
 * The search window does not need the whole settings object, so it subscribes to
 * just this. The subscription stays active while the window is hidden, so a
 * change made in Settings is already applied the next time it appears.
 */
export function useSearchChrome(): { engine: SearchEngine | null } {
  const [engine, setEngine] = useState<SearchEngine | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The engine list never changes at runtime, so fetch it once.
    const enginesPromise = ipc.listSearchEngines().catch((cause) => {
      console.error("could not load the search engine list", cause);
      return [] as SearchEngine[];
    });

    ipc
      .getSettings()
      .then(async (payload) => {
        if (cancelled) return;
        applyTheme(payload.settings.theme);

        const engines = await enginesPromise;
        if (cancelled) return;
        setEngine(engines.find((e) => e.id === payload.settings.searchEngine) ?? null);
      })
      .catch((cause) => {
        // Log rather than swallow: a failure here previously hid a real startup
        // race and only showed up as a wrong-looking window.
        console.error("could not load settings for the search window", cause);
      });

    const pending = onSettingsChanged(async (next) => {
      applyTheme(next.theme);
      const engines = await enginesPromise;
      if (cancelled) return;
      setEngine(engines.find((e) => e.id === next.searchEngine) ?? null);
    });

    return () => {
      cancelled = true;
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  return { engine };
}
