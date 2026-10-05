import { cn } from "../../lib/cn";
import { useClipboard } from "../../hooks/useClipboard";
import { ActionButton, ActionRow } from "./ActionButton";
import { CheckCircleIcon, CopyIcon, PencilIcon, RefreshIcon } from "../../components/icons";

interface MessageActionsProps {
  /** The reply this bar acts on. */
  content: string;
  onRetry: () => void;
}

/**
 * The action row under an assistant reply.
 *
 * Only two actions, deliberately. Copy and retry are what a reply actually
 * invites: take it somewhere, or ask again. Rating buttons were dropped because
 * nothing consumed the rating - a control that stores a preference nowhere is
 * worse than no control, since it implies the answer is being learned from.
 */
export function MessageActions({ content, onRetry }: MessageActionsProps) {
  const { copy, copied, error } = useClipboard();

  return (
    <ActionRow>
      <ActionButton
        label={copied ? "Copied" : (error ?? "Copy reply")}
        onClick={() => void copy(content)}
        active={copied}
      >
        {copied ? <CheckCircleIcon size={14} /> : <CopyIcon size={14} />}
      </ActionButton>

      <ActionButton label="Ask again" onClick={onRetry}>
        <RefreshIcon size={14} />
      </ActionButton>
    </ActionRow>
  );
}

interface UserActionsProps {
  content: string;
  /** Opens this message for editing. */
  onEdit: () => void;
  disabled: boolean;
}

/**
 * The action row under a user message.
 *
 * Editing lives here rather than on the reply: the reply is derived from the
 * question, so the question is the thing worth changing. It is disabled while a
 * reply is streaming, because the edit would rebuild the history underneath a
 * request that is already in flight.
 */
export function UserActions({ content, onEdit, disabled }: UserActionsProps) {
  const { copy, copied, error } = useClipboard();

  return (
    <ActionRow>
      <ActionButton
        label={copied ? "Copied" : (error ?? "Copy question")}
        onClick={() => void copy(content)}
        active={copied}
      >
        {copied ? <CheckCircleIcon size={14} /> : <CopyIcon size={14} />}
      </ActionButton>

      <button
        type="button"
        onClick={onEdit}
        disabled={disabled}
        aria-label="Edit message"
        title={disabled ? "Wait for the reply to finish" : "Edit message"}
        className={cn(
          "focus-ring flex size-6 items-center justify-center rounded-chip",
          "transition-colors duration-150",
          disabled
            ? "cursor-not-allowed text-fg-subtle opacity-40"
            : "text-fg-subtle hover:bg-surface-hover hover:text-fg-muted",
        )}
      >
        <PencilIcon size={14} />
      </button>
    </ActionRow>
  );
}
