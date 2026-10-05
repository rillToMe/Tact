import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, toAppError } from "../../lib/ipc";
import { useSearchOpened } from "../../hooks/useSettings";
import { useAiChat } from "../../hooks/useAiChat";
import { ENGINE_ICONS_BASE, useSearchChrome } from "../../hooks/useSearchChrome";
import { formatAccelerator, modeKeyMatches } from "../../lib/shortcut";
import { SearchIcon, SlidersIcon, SparkleIcon } from "../../components/icons";
import { IconButton, Kbd } from "../../components/ui";
import { cn } from "../../lib/cn";
import { AiConversation } from "./AiConversation";

export function SearchWindow() {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { engine, ai } = useSearchChrome();
  const chat = useAiChat();

  const aiAvailable = ai?.enabled ?? false;

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
  //
  // The mode is reset here, and that is load-bearing rather than cosmetic:
  // `show_search` on the Rust side shrinks the window back to the search bar
  // before emitting this event. Leaving `aiMode` true would keep the panel
  // collapsed while React rendered a full conversation into it, clipping the
  // reply. The conversation itself is kept, so pressing the mode key again
  // brings it straight back.
  useSearchOpened(() => {
    setQuery("");
    setError(null);
    setAiMode(false);
    focusInput();
  });

  // The panel grows only while a conversation is actually on screen. Resizing
  // on toggle alone would show a large empty panel when the user changed their
  // mind and switched back.
  const showConversation = aiMode && aiAvailable;

  useEffect(() => {
    void ipc.setSearchExpanded(showConversation).catch((cause) => {
      console.error("could not resize the search window", cause);
    });
  }, [showConversation]);

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

    if (showConversation) {
      if (chat.busy) return;
      // The prompt is cleared immediately so the input is ready for the next
      // question while the reply streams in.
      setQuery("");
      await chat.ask(query);
      focusInput();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await ipc.submitSearch(query);
      setQuery("");
    } catch (cause) {
      // The window stays open so the query can be corrected or retried.
      setError(toAppError(cause).message);
      focusInput();
    } finally {
      setSubmitting(false);
    }
  }, [query, submitting, showConversation, chat, focusInput]);

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
        return;
      }

      // The configured mode key switches modes, but only while the input is
      // empty. Otherwise a letter bound as the mode key would make that letter
      // impossible to type, and the user could never correct a typo.
      if (
        aiAvailable &&
        !query &&
        ai?.modeKey &&
        modeKeyMatches(ai.modeKey, event.nativeEvent)
      ) {
        event.preventDefault();
        setAiMode((current) => !current);
        // Clear the search error on the way in and the chat error on the way
        // out, so a failure from the other mode is never shown here. The
        // conversation itself is kept: switching modes is not a reason to
        // discard a reply the user may still want.
        setError(null);
        chat.dismissError();
      }
    },
    [submit, aiAvailable, query, ai, chat],
  );

  const errorMessage = showConversation ? chat.error : error;

  return (
    <div
      className={cn(
        "surface flex h-full w-full flex-col overflow-hidden",
        // The search bar is a fixed height so the panel grows downward from it
        // rather than squashing it.
        !showConversation && "justify-center",
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        aria-label={showConversation ? "Ask AI" : "Web search"}
        className={cn(
          "flex h-16 w-full shrink-0 items-center gap-3 px-4",
          // No focus ring: the window only exists while it is focused, so a ring
          // would be a permanent decoration. State is carried by the icon and
          // border instead.
          errorMessage && "border-b border-danger/40",
        )}
      >
        {showConversation ? (
          <SparkleIcon size={17} className="shrink-0 text-accent" />
        ) : engine ? (
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
          placeholder={showConversation ? "Ask AI..." : "Search the web..."}
          aria-label={showConversation ? "AI prompt" : "Search query"}
          aria-invalid={errorMessage ? true : undefined}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] leading-none tracking-[-0.012em] text-fg caret-accent placeholder:text-fg-subtle focus:outline-none"
        />

        {/* The mode chip. Hidden once a conversation is on screen, where the
            sparkle icon and placeholder already say which mode is active, and
            the trailing slot is better used by the settings button. */}
        {aiAvailable && !showConversation && !errorMessage && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setAiMode(true);
              setError(null);
              focusInput();
            }}
            title={`Switch to AI mode (${formatAccelerator(ai?.modeKey ?? "Tab")})`}
            className={cn(
              "focus-ring flex shrink-0 items-center gap-1.5 rounded-chip py-0.5 pl-1.5 pr-1",
              "text-[11px] font-medium text-fg-subtle transition-colors duration-150",
              "hover:bg-surface-hover hover:text-fg-muted",
            )}
          >
            Quick AI
            <Kbd>{formatAccelerator(ai?.modeKey ?? "Tab")}</Kbd>
          </button>
        )}

        {errorMessage && !showConversation ? (
          // Errors take over the trailing slot so the surface never grows and the
          // window never reflows while the user is typing.
          <p
            role="alert"
            title={errorMessage}
            className="max-w-[280px] shrink-0 truncate text-right text-[11.5px] leading-4 text-danger"
          >
            {errorMessage}
          </p>
        ) : (
          !showConversation && (
            <IconButton
              label="Open settings"
              onClick={() => void ipc.openSettingsWindow()}
              tabIndex={-1}
            >
              <SlidersIcon size={15} />
            </IconButton>
          )
        )}
      </form>

      {showConversation && (
        <>
          <AiConversation
            messages={chat.messages}
            streaming={chat.streaming}
            reasoning={chat.reasoning}
            reasoningByIndex={chat.reasoningByIndex}
            busy={chat.busy}
            error={chat.error}
            onEdit={chat.editAndResend}
            onRetry={chat.retry}
          />

          <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-4">
            <button
              type="button"
              onClick={() => {
                setAiMode(false);
              }}
              className="focus-ring rounded-chip px-1.5 py-0.5 text-[11px] text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg-muted"
            >
              Back to search
            </button>

            <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
              {/* The most common AI failure is a missing key or URL, and the
                  fix lives in Settings - so the way there is kept visible
                  rather than leaving the error as a dead end. */}
              <button
                type="button"
                onClick={() => void ipc.openSettingsWindow()}
                className="focus-ring rounded-chip px-1.5 py-0.5 transition-colors duration-150 hover:bg-surface-hover hover:text-fg-muted"
              >
                Settings
              </button>
              {chat.messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => chat.reset()}
                  disabled={chat.busy}
                  className={cn(
                    "focus-ring rounded-chip px-1.5 py-0.5 transition-colors duration-150",
                    "hover:bg-surface-hover hover:text-fg-muted",
                    chat.busy && "cursor-not-allowed opacity-50",
                  )}
                >
                  Clear
                </button>
              )}
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd> to close
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
