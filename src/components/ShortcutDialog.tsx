import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { acceleratorFromKeyboardEvent, formatAccelerator, modifiersHeld } from "../lib/shortcut";
import { Kbd } from "./ui";

interface ShortcutDialogProps {
  open: boolean;
  /** Accelerator currently stored, shown as the starting point. */
  value: string;
  onCancel: () => void;
  onAccept: (accelerator: string) => void;
}

/**
 * Modal recorder for the global shortcut.
 *
 * Recording happens in its own focused dialog rather than inside the settings
 * row: the combination being captured needs room to be shown as large key caps,
 * and the surrounding UI must not react to the keys being pressed.
 *
 * The global shortcut itself is released by the caller for the duration, so the
 * combination currently in use can be re-recorded.
 */
export function ShortcutDialog({ open, value, onCancel, onAccept }: ShortcutDialogProps) {
  // Caps for the combination currently being held, or the stored one at rest.
  const [held, setHeld] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Swallow everything so nothing behind the dialog reacts.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        onCancel();
        return;
      }

      if (event.key === "Enter" && held.length === 0) {
        // Enter with nothing held is the "keep current" affordance.
        onCancel();
        return;
      }

      const modifiers = modifiersHeld(event);
      const accelerator = acceleratorFromKeyboardEvent(event);

      if (!accelerator) {
        // Modifiers only so far: show them and wait for the final key.
        setHeld(modifiers);
        setProblem(null);
        return;
      }

      if (modifiers.length === 0) {
        setProblem("Add a modifier — Alt, Ctrl, Shift, or Super.");
        return;
      }

      setHeld(formatAccelerator(accelerator).split(" + "));
      setProblem(null);
      // Let the accepted caps paint before the dialog closes.
      window.setTimeout(() => onAccept(accelerator), 140);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, held.length, onCancel, onAccept]);

  // Move focus into the dialog so the window-level Escape handler in the
  // settings window does not fire first.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const caps = held.length > 0 ? held : formatAccelerator(value).split(" + ");
  const isHolding = held.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "var(--scrim)" }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Record global shortcut"
        className={cn(
          "w-full max-w-[360px] overflow-hidden outline-none",
          "rounded-surface border border-line-strong",
          "bg-[var(--surface-popup)] shadow-[var(--shadow-popup)]",
        )}
      >
        <div className="flex flex-col items-center gap-3 px-5 py-7">
          <div className="flex min-h-[34px] items-center gap-1.5">
            {caps.map((part) => (
              <Kbd key={part} size="lg">
                {part}
              </Kbd>
            ))}
          </div>

          <p
            role={problem ? "alert" : "status"}
            className={cn(
              "text-center text-[12px] leading-4",
              problem ? "text-danger" : "text-fg-subtle",
            )}
          >
            {problem ?? (isHolding ? "Now press the final key" : "Press a key combination")}
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <span className="text-[11.5px] text-fg-subtle">Global shortcut</span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
            Close
            <Kbd>Esc</Kbd>
            <span>or</span>
            <Kbd>⏎</Kbd>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
