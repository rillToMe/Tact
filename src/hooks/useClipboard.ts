import { useCallback, useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Writes text to the system clipboard and reports a short-lived success state.
 *
 * Uses the Tauri clipboard plugin rather than `navigator.clipboard`, which needs
 * a secure context and a granted permission. The webview is served from
 * `http://tauri.localhost`, and whether Chromium treats that as secure is not
 * something worth depending on when a first-party plugin does the job directly.
 *
 * `copied` resets on its own so the button can show a confirmation without the
 * caller tracking a timer.
 */
export function useClipboard(resetAfterMs = 1600) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      if (!text) return;
      try {
        await writeText(text);
        setError(null);
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetAfterMs);
      } catch (cause) {
        // A failed copy is not worth interrupting the conversation for, so it is
        // reported inline on the button rather than as a banner.
        setCopied(false);
        setError("Could not copy");
        console.error("clipboard write failed", cause);
      }
    },
    [resetAfterMs],
  );

  return { copy, copied, error };
}
