import type { ChatMessage } from "../../types";
import { useStickToBottom } from "../../hooks/useStickToBottom";
import { Markdown } from "./Markdown";
import { ThoughtLine } from "./ThoughtLine";
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
}: AiConversationProps) {
  // Follows the reply as it grows, but only while the user is already at the
  // bottom. See the hook: an unconditional scroll-to-bottom made the transcript
  // impossible to scroll, because streaming updates every frame and overwrote
  // every attempt to move up.
  const { scrollRef, pinned, jumpToBottom } = useStickToBottom<HTMLDivElement>();

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
            {messages.map((message, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                {/* Reasoning for a finished turn stays available, collapsed, so
                    the answer can still be checked against the thinking. */}
                {message.role === "assistant" && reasoningByIndex[index] && (
                  <ThoughtLine text={reasoningByIndex[index]} working={false} />
                )}
                {message.role === "user" ? (
                  <UserMessage content={message.content} />
                ) : (
                  <AssistantMessage content={message.content} />
                )}
              </div>
            ))}

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

/**
 * What the user typed, as a bubble.
 *
 * The bubble is what separates the user's own words from the answer: it is a
 * quotation of them, not part of the document being produced.
 */
function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-control bg-accent-soft px-2.5 py-1.5 text-[12.5px] leading-5 text-fg">
        {content}
      </div>
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
