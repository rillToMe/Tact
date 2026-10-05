import { cn } from "../../lib/cn";

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  /** Highlights the button, for a toggle such as a rating or an open menu. */
  active?: boolean;
  children: React.ReactNode;
}

/**
 * One button in a message's action row.
 *
 * Shared by the user and assistant bars so the two are identical in size,
 * spacing and states - they sit in the same visual column, and any drift between
 * them is immediately visible.
 */
export function ActionButton({ label, onClick, active, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "focus-ring flex size-6 items-center justify-center rounded-chip",
        "transition-colors duration-150",
        active
          ? "bg-accent-soft text-accent"
          : "text-fg-subtle hover:bg-surface-hover hover:text-fg-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The reveal wrapper both action rows share.
 *
 * Hidden until the message is hovered or something inside it is focused, so the
 * transcript reads as a conversation rather than a control panel - and reachable
 * by keyboard, which a pure hover rule would not be.
 */
export function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        "opacity-0 transition-opacity duration-150",
        "group-hover/message:opacity-100 focus-within:opacity-100",
      )}
    >
      {children}
    </div>
  );
}
