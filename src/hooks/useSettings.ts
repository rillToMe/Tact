import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, onSearchOpened, onSettingsChanged, toAppError } from "../lib/ipc";
import { applyTheme } from "../lib/theme";
import type { Settings, SettingsPayload, ShortcutStatus } from "../types";

interface UseSettingsResult {
  settings: Settings | null;
  shortcut: ShortcutStatus | null;
  /**
   * Whether an AI API key is stored.
   *
   * Reported as a boolean because the key itself never leaves the OS store.
   */
  apiKeySet: boolean;
  loading: boolean;
  error: string | null;
  update: (settings: Settings) => Promise<SettingsPayload>;
}

/**
 * Loads settings from the Rust side and keeps them in sync across windows.
 *
 * The backend owns persistence; this hook only mirrors the current values for
 * rendering.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shortcut, setShortcut] = useState<ShortcutStatus | null>(null);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    ipc
      .getSettings()
      .then((payload) => {
        if (cancelled) return;
        setSettings(payload.settings);
        setShortcut(payload.shortcut);
        setApiKeySet(payload.apiKeySet);
        applyTheme(payload.settings.theme);
      })
      .catch((cause) => {
        if (!cancelled) setError(toAppError(cause).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Another window (or the settings window itself) changed something.
  useEffect(() => {
    const pending = onSettingsChanged((next) => {
      setSettings(next);
      applyTheme(next.theme);
    });

    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  const update = useCallback(async (next: Settings) => {
    const payload = await ipc.updateSettings(next);
    setSettings(payload.settings);
    setShortcut(payload.shortcut);
    setApiKeySet(payload.apiKeySet);
    applyTheme(payload.settings.theme);
    return payload;
  }, []);

  return { settings, shortcut, apiKeySet, loading, error, update };
}

/**
 * Runs `handler` every time the Rust side shows the search window.
 *
 * The handler is kept in a ref so callers can pass an inline closure without
 * resubscribing the event listener on every render.
 */
export function useSearchOpened(handler: () => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const pending = onSearchOpened(() => handlerRef.current());
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, []);
}
