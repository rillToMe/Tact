import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, toAppError } from "../../lib/ipc";
import { useSearchOpened } from "../../hooks/useSettings";
import { ENGINE_ICONS_BASE, useSearchChrome } from "../../hooks/useSearchChrome";
import { SearchIcon, SlidersIcon } from "../../components/icons";
import { IconButton } from "../../components/ui";
import { cn } from "../../lib/cn";

export function SearchWindow() {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { engine } = useSearchChrome();

  const focusInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // Windows can hand focus back to the webview a moment after the window is
  // shown, which would otherwise leave the caret behind.
  useEffect(() => {
    const handler = () => focusInput();
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [focusInput]);

  // The window is reused for every search, so each activation starts clean.
  useSearchOpened(() => {
    setQuery("");
    setError(null);
    focusInput();
  });

  // Escape must dismiss the window no matter which element inside it has focus,
  // so it is handled at the window level rather than only on the input.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void ipc.hideSearchWindow();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const submit = useCallback(async () => {
    if (submitting || !query.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await ipc.submitSearch(query);
      setQuery("");
    } catch (error) {
      // The window stays open so the query can be corrected or retried.
      setError(toAppError(error).message);
      focusInput();
    } finally {
      setSubmitting(false);
    }
  }, [query, submitting, focusInput]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
        return;
      }

      if (event.key === "," && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void ipc.openSettingsWindow();
      }
    },
    [submit],
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-label="Web search"
      className={cn(
        "surface flex h-full w-full items-center gap-3 px-4",
        // No focus ring: the window only exists while it is focused, so a ring
        // would be a permanent decoration. State is carried by the icon and
        // border instead.
        error && "border-danger/50",
      )}
    >
      {engine ? (
        // A fixed-width box keeps the input from shifting when the engine
        // changes between a square glyph and a wide wordmark.
        <span className="flex h-[18px] w-[38px] shrink-0 items-center">
          <img
            src={`${ENGINE_ICONS_BASE}/${engine.icon}`}
            alt={engine.name}
            title={`Searching with ${engine.name}`}
            draggable={false}
            className="max-h-[18px] w-auto max-w-full object-contain object-left"
          />
        </span>
      ) : (
        // Before settings load, or if the list is unavailable, fall back to the
        // generic glyph rather than an empty gap.
        <SearchIcon size={17} className="shrink-0 text-fg-subtle" />
      )}

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search the web..."
        aria-label="Search query"
        aria-invalid={error ? true : undefined}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-full min-w-0 flex-1 bg-transparent text-[16px] leading-none tracking-[-0.012em] text-fg caret-accent placeholder:text-fg-subtle focus:outline-none"
      />

      {error ? (
        // Errors take over the trailing slot so the surface never grows and the
        // window never reflows while the user is typing.
        <p
          role="alert"
          title={error}
          className="max-w-[280px] shrink-0 truncate text-right text-[11.5px] leading-4 text-danger"
        >
          {error}
        </p>
      ) : (
        <IconButton
          label="Open settings"
          onClick={() => void ipc.openSettingsWindow()}
          tabIndex={-1}
        >
          <SlidersIcon size={15} />
        </IconButton>
      )}
    </form>
  );
}
