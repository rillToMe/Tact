import { useEffect, useState } from "react";
import { ipc, onSettingsChanged } from "../lib/ipc";
import { applyTheme } from "../lib/theme";
import type { SearchEngine } from "../types";

/** Engine icons are served as static files from `public/`. */
export const ENGINE_ICONS_BASE = "/icons-search-engine";

/**
 * The subset of settings the search window renders.
 *
 * The search window does not need the whole settings object, so it subscribes
 * to just this. The subscription stays active while the window is hidden, so a
 * change made in Settings is already applied the next time it appears.
 */
export function useSearchChrome(): { engine: SearchEngine | null } {
  const [engine, setEngine] = useState<SearchEngine | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The engine list is static; fetch it once and match by id on updates.
    const enginesPromise = ipc.listSearchEngines().catch(() => [] as SearchEngine[]);

    ipc
      .getSettings()
      .then(async (payload) => {
        if (cancelled) return;
        applyTheme(payload.settings.theme);

        const engines = await enginesPromise;
        if (cancelled) return;
        setEngine(engines.find((e) => e.id === payload.settings.searchEngine) ?? null);
      })
      .catch(() => {
        // The pre-mount system preference is already painted; nothing to do.
      });

    const pending = onSettingsChanged(async (next) => {
      applyTheme(next.theme);
      const engines = await enginesPromise;
      setEngine(engines.find((e) => e.id === next.searchEngine) ?? null);
    });

    return () => {
      cancelled = true;
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  return { engine };
}
