import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types";
import { cn } from "../../lib/cn";
import { useStickToBottom } from "../../hooks/useStickToBottom";
import { Markdown } from "./Markdown";
import { ThoughtLine } from "./ThoughtLine";
import { MessageActions, UserActions } from "./MessageActions";
import { ChevronIcon } from "../../components/icons";

interface AiConversationProps {
  messages: ChatMessage[];
  /** The reply currently arriving, or an empty string when idle. */
  streaming: string;
  /** The reasoning for the reply in flight, when the provider exposes it. */
  reasoning: string;
  /** Reasoning kept for finished assistant messages, keyed by message index. */
  reasoningByIndex: Record<number, string>;
  busy: boolean;
  error: string | null;
  onEdit: (index: number, content: string) => void;
  onRetry: (assistantIndex: number) => void;
}

/**
 * The conversation transcript.
 *
 * Replies are rendered as Markdown, which is also what the default system
 * prompt asks for. `react-markdown` builds a React element tree rather than
 * assigning HTML, so a reply cannot inject markup - see `Markdown.tsx`.
 */
export function AiConversation({
  messages,
  streaming,
  reasoning,
  reasoningByIndex,
  busy,
  error,
  onEdit,
  onRetry,
}: AiConversationProps) {
  // Follows the reply as it grows, but only while the user is already at the
  // bottom. See the hook: an unconditional scroll-to-bottom made the transcript
  // impossible to scroll, because streaming updates every frame and overwrote
  // every attempt to move up.
  const { scrollRef, pinned, jumpToBottom } = useStickToBottom<HTMLDivElement>();

  // Which user message is open for editing, if any. Editing is exclusive: two
  // open editors would let the user build a conversation from two places at
  // once, which the history cannot represent.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const empty = messages.length === 0 && !streaming && !busy && !error;

  return (
    // `relative` anchors the jump-to-bottom button to the transcript's corner
    // rather than to the panel, so it sits above the footer.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        // `select-text` matters here: the rest of the app is a launcher, but a
        // reply the user cannot copy is not much use.
        className="min-h-0 flex-1 select-text overflow-y-auto px-4 py-3"
      >
        {empty ? (
          <p className="text-[12.5px] leading-5 text-fg-subtle">
            Ask anything. Answers come from your own configured provider.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message, index) => {
              if (message.role === "user") {
                return (
                  <UserMessage
                    key={index}
                    content={message.content}
                    editing={editingIndex === index}
                    disabled={busy}
                    onStartEdit={() => setEditingIndex(index)}
                    onCancelEdit={() => setEditingIndex(null)}
                    onSubmit={(next) => {
                      setEditingIndex(null);
                      onEdit(index, next);
                    }}
                  />
                );
              }

              return (
                <div key={index} className="group/message flex flex-col gap-1.5">
                  {/* Reasoning for a finished turn stays available, collapsed,
                      so the answer can still be checked against the thinking. */}
                  {reasoningByIndex[index] && (
                    <ThoughtLine text={reasoningByIndex[index]} working={false} />
                  )}
                  <AssistantMessage content={message.content} />
                  <MessageActions
                    content={message.content}
                    onRetry={() => onRetry(index)}
                  />
                </div>
              );
            })}

            {/* The turn in flight: reasoning first, then the reply as it lands.
                The line shows while waiting for the first token, which is a useful
                "still working" signal even for a model that exposes no reasoning.
                Once the reply starts, it is only kept if there is a real trace to
                show - otherwise a provider without reasoning would get a
                "Thought for 0.4s" row describing nothing. */}
            {(busy || streaming) && (
              <div className="flex flex-col gap-1.5">
                {(reasoning || !streaming) && (
                  <ThoughtLine text={reasoning} working={!streaming} />
                )}
                {streaming && <AssistantMessage content={streaming} streaming />}
              </div>
            )}

            {error && (
              <p role="alert" className="text-[12.5px] leading-5 text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Only shown once the user has scrolled away from a reply that is still
          arriving, which is the one moment they need it. */}
      {!pinned && (
        <button
          type="button"
          onClick={jumpToBottom}
          aria-label="Jump to the latest"
          title="Jump to the latest"
          className="focus-ring absolute bottom-2 left-1/2 z-10 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-[var(--surface-popup)] text-fg-muted shadow-[var(--shadow-popup)] transition-colors duration-150 hover:text-fg"
        >
          <ChevronIcon size={14} />
        </button>
      )}
    </div>
  );
}

interface UserMessageProps {
  content: string;
  editing: boolean;
  disabled: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmit: (next: string) => void;
}

/**
 * How tall the edit box may grow before it scrolls instead.
 *
 * Roughly ten lines: enough for a long question to stay readable, short enough
 * that the conversation around it is not pushed off screen.
 */
const MAX_EDITOR_HEIGHT = 200;

/**
 * What the user typed, as a bubble.
 *
 * The bubble is what separates the user's own words from the answer: it is a
 * quotation of them, not part of the document being produced.
 *
 * The edit affordance sits below the bubble rather than floating on it, so the
 * bubble keeps the same shape whether or not it is hovered - a control that
 * shifts the text it belongs to is worse than one that is always in the same
 * place.
 */
function UserMessage({
  content,
  editing,
  disabled,
  onStartEdit,
  onCancelEdit,
  onSubmit,
}: UserMessageProps) {
  const [draft, setDraft] = useState(content);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset the draft whenever the message itself changes, so reopening the
  // editor after an edit shows the current text rather than a stale draft.
  const [seeded, setSeeded] = useState(content);
  if (seeded !== content) {
    setSeeded(content);
    setDraft(content);
  }

  /**
   * Grows the box to fit its content, up to a cap.
   *
   * The border has to be added back on. `box-sizing: border-box` makes `height`
   * include the border, but `scrollHeight` measures content plus padding and
   * excludes it - so setting `height = scrollHeight` leaves the box 2px short,
   * and that overflow is enough to show a scrollbar on a single line of text.
   */
  const autoGrow = useCallback(() => {
    const node = inputRef.current;
    if (!node) return;

    const styles = getComputedStyle(node);
    const border =
      parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);

    node.style.height = "auto";
    const wanted = node.scrollHeight + border;
    node.style.height = `${Math.min(wanted, MAX_EDITOR_HEIGHT)}px`;

    // Only allow a scrollbar once the cap is actually reached; below that the
    // box is sized exactly and a bar would be a 2px lie.
    node.style.overflowY = wanted > MAX_EDITOR_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    if (!editing) return;
    autoGrow();
    const node = inputRef.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
  }, [editing, autoGrow]);

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="flex w-full max-w-[85%] flex-col gap-1.5">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              autoGrow();
            }}
            onKeyDown={(event) => {
              // Escape abandons the edit, Enter sends. Shift+Enter is left to
              // insert a newline, matching the main input.
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCancelEdit();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (draft.trim() && !disabled) onSubmit(draft);
              }
            }}
            aria-label="Edit message"
            className={cn(
              // The box is focused the moment it opens, so a `focus:` accent
              // border would be a permanent bright ring rather than a focus cue
              // - it would read as decoration, not state. A quiet border and a
              // caret are enough: the user knows where they are because they
              // just opened it.
              "w-full resize-none rounded-control bg-surface-sunken",
              "border border-line px-2.5 py-1.5 text-[12.5px] leading-5 text-fg",
              "outline-none",
            )}
            rows={1}
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={onCancelEdit}
              className="focus-ring rounded-chip px-2 py-0.5 text-[11.5px] text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(draft)}
              disabled={!draft.trim() || disabled}
              className={cn(
                "focus-ring rounded-chip px-2 py-0.5 text-[11.5px] font-medium transition-colors duration-150",
                !draft.trim() || disabled
                  ? "cursor-not-allowed text-fg-subtle opacity-50"
                  : "bg-accent text-white hover:bg-accent/90",
              )}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/message flex flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-control bg-accent-soft px-2.5 py-1.5 text-[12.5px] leading-5 text-fg">
        {content}
      </div>

      <UserActions content={content} onEdit={onStartEdit} disabled={disabled} />
    </div>
  );
}

/**
 * The model's reply, set directly on the panel rather than in a bubble.
 *
 * A reply is the content of this view, not a message in a chat log: boxing it
 * would frame the document instead of showing it. It also costs width, which
 * code blocks and tables need - and those are exactly what the reply is usually
 * made of.
 */
function AssistantMessage({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="max-w-none">
      <Markdown>{content}</Markdown>
      {streaming && (
        // A blinking caret makes it obvious the reply is still arriving.
        <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse bg-accent align-baseline" />
      )}
    </div>
  );
}
