import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, toAppError } from "../lib/ipc";
import type { ChatMessage } from "../types";

export interface AiChatState {
  /** The conversation so far, oldest first. */
  messages: ChatMessage[];
  /** The reply currently being streamed, or an empty string when idle. */
  streaming: string;
  /**
   * The model's reasoning for the reply in flight, when the provider exposes it.
   *
   * Only kept for the current turn: once the reply lands, the reasoning is
   * folded into the finished message rather than kept as live state.
   */
  reasoning: string;
  /** Reasoning kept for each finished assistant message, keyed by its index. */
  reasoningByIndex: Record<number, string>;
  busy: boolean;
  error: string | null;
  ask: (prompt: string) => Promise<void>;
  /** Re-sends a user message, dropping it and everything after it first. */
  editAndResend: (index: number, nextContent: string) => Promise<void>;
  /** Asks the same question again, dropping the reply it produced. */
  retry: (assistantIndex: number) => Promise<void>;
  reset: () => void;
  /** Clears only the error, keeping the conversation. */
  dismissError: () => void;
}

/**
 * Drives one AI conversation for the search window.
 *
 * The conversation lives here rather than in the window component so it
 * survives the window being hidden: the search window is reused, and hiding it
 * must not silently discard a reply the user is still reading.
 */
export function useAiChat(): AiChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [reasoningByIndex, setReasoningByIndex] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against two overlapping streams appending into the same reply if
  // Enter is pressed again before the previous request finished.
  const inFlight = useRef(false);

  // Streaming state is flushed once per animation frame rather than per token.
  //
  // Each flush re-renders the whole reply as Markdown, and the cost grows with
  // the reply: measured at ~0.24ms per token for the parse alone, before React
  // reconciliation. A fast local model can emit hundreds of tokens a second, so
  // rendering every one would spend more time re-parsing than the user could
  // perceive. Coalescing to a frame is imperceptible and bounds the work.
  const frame = useRef<number | null>(null);
  const pending = useRef<{ reply: string; thought: string } | null>(null);

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pending.current = null;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const next = pending.current;
      if (!next) return;
      setStreaming(next.reply);
      setReasoning(next.thought);
    });
  }, []);

  // A frame left pending when the hook unmounts would set state on a dead
  // component.
  useEffect(() => cancelFrame, [cancelFrame]);

  /**
   * Runs one turn: sends `history`, streams the reply, and commits it.
   *
   * Shared by the initial ask, edit-and-resend, and retry, which differ only in
   * what `history` contains. Keeping one implementation is what stops the three
   * paths from drifting - each of them has to handle the frame coalescing, the
   * reasoning bookkeeping, and the error rollback identically.
   */
  const run = useCallback(
    async (history: ChatMessage[], rollbackTo: ChatMessage[]) => {
      if (inFlight.current) return;

      inFlight.current = true;
      setBusy(true);
      setError(null);
      setStreaming("");
      setReasoning("");
      setMessages(history);

      // Accumulated locally because the state above is only for rendering:
      // reading it here would capture a stale value between chunks.
      let reply = "";
      let thought = "";

      try {
        await ipc.sendChatMessage(history, (event) => {
          if (event.type === "delta") {
            reply += event.text;
          } else if (event.type === "reasoning") {
            thought += event.text;
          } else {
            return;
          }
          pending.current = { reply, thought };
          scheduleFlush();
        });

        // Drop any frame still queued: the committed message below is the
        // authority, and a late flush would resurrect the streaming preview.
        cancelFrame();

        // Commit the finished reply into the conversation so the next question
        // carries the context of this one. The reasoning is stored alongside it
        // so the finished turn can still show what the model was thinking.
        if (reply) {
          setMessages([...history, { role: "assistant", content: reply }]);
          if (thought) {
            setReasoningByIndex((current) => ({
              ...current,
              [history.length]: thought,
            }));
          }
        }
        setStreaming("");
        setReasoning("");
      } catch (cause) {
        cancelFrame();
        setError(toAppError(cause).message);

        // Roll back so a retry does not send the same prompt twice. Without
        // this, pressing Enter again would append a second copy and the provider
        // would see the same question back to back.
        setMessages(rollbackTo);
        setStreaming("");
        setReasoning("");
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [scheduleFlush, cancelFrame],
  );

  const ask = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || inFlight.current) return Promise.resolve();

      const history: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
      return run(history, messages);
    },
    [messages, run],
  );

  /**
   * Replaces a user message and everything after it.
   *
   * Editing an earlier question invalidates the replies that followed it - they
   * answered the old wording. Keeping them would let the model see an answer
   * that no longer matches the question above it.
   */
  const editAndResend = useCallback(
    (index: number, nextContent: string) => {
      const trimmed = nextContent.trim();
      if (!trimmed || inFlight.current) return Promise.resolve();

      const history: ChatMessage[] = [
        ...messages.slice(0, index),
        { role: "user", content: trimmed },
      ];

      // The bookkeeping maps are keyed by position, so anything at or after the
      // edited message has to go too.
      setReasoningByIndex((current) => dropFrom(current, index));

      return run(history, messages);
    },
    [messages, run],
  );

  /**
   * Asks the last question again.
   *
   * The reply being retried is dropped first, so the model is not asked to
   * answer a question that already has an answer directly below it.
   */
  const retry = useCallback(
    (assistantIndex: number) => {
      if (inFlight.current) return Promise.resolve();

      // The question is the user message immediately before the reply.
      const questionIndex = assistantIndex - 1;
      if (questionIndex < 0 || messages[questionIndex]?.role !== "user") {
        return Promise.resolve();
      }

      const history = messages.slice(0, assistantIndex);
      setReasoningByIndex((current) => dropFrom(current, assistantIndex));

      return run(history, messages);
    },
    [messages, run],
  );

  const reset = useCallback(() => {
    cancelFrame();
    setMessages([]);
    setStreaming("");
    setReasoning("");
    setReasoningByIndex({});
    setError(null);
  }, [cancelFrame]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    messages,
    streaming,
    reasoning,
    reasoningByIndex,
    busy,
    error,
    ask,
    editAndResend,
    retry,
    reset,
    dismissError,
  };
}

/**
 * Drops every entry at or after `from`.
 *
 * This is what keeps the reasoning map aligned with the message list after an
 * edit or a retry. Without it a stale entry would attach an old thought trace to
 * a new reply, which reads as the model thinking about something it was never
 * asked.
 *
 * `Number(key)` matters: object keys are strings, so a lexical comparison would
 * put `"10"` below `"3"` and keep entries that should have gone.
 */
function dropFrom<T>(record: Record<number, T>, from: number): Record<number, T> {
  const next: Record<number, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const index = Number(key);
    if (index < from) next[index] = value;
  }
  return next;
}
