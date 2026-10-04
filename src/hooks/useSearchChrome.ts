import { useEffect, useState } from "react";
import { ipc, onSettingsChanged } from "../lib/ipc";
import { applyTheme } from "../lib/theme";
import type { AiSettings, SearchEngine } from "../types";

/** Engine icons are served as static files from `public/`. */
export const ENGINE_ICONS_BASE = "/icons-search-engine";

interface SearchChrome {
  engine: SearchEngine | null;
  /**
   * AI configuration, or `null` before it loads.
   *
   * Only the fields the search window needs are exposed: it renders the mode
   * chip and decides whether the mode key does anything. The API key is not
   * part of this and never reaches the frontend.
   */
  ai: Pick<AiSettings, "enabled" | "modeKey"> | null;
}

/**
 * The subset of settings the search window renders: the active engine, the
 * theme, and whether AI mode is available.
 *
 * The search window does not need the whole settings object, so it subscribes to
 * just this. The subscription stays active while the window is hidden, so a
 * change made in Settings is already applied the next time it appears.
 */
export function useSearchChrome(): SearchChrome {
  const [engine, setEngine] = useState<SearchEngine | null>(null);
  const [ai, setAi] = useState<SearchChrome["ai"]>(null);

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
        setAi({
          enabled: payload.settings.ai.enabled,
          modeKey: payload.settings.ai.modeKey,
        });

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
      setAi({ enabled: next.ai.enabled, modeKey: next.ai.modeKey });
      const engines = await enginesPromise;
      if (cancelled) return;
      setEngine(engines.find((e) => e.id === next.searchEngine) ?? null);
    });

    return () => {
      cancelled = true;
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  return { engine, ai };
}
