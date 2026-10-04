import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import {
  acceleratorFromKeyboardEvent,
  formatAccelerator,
  isModifierCode,
  isValidModeKey,
  modifiersHeld,
} from "../lib/shortcut";
import { Kbd } from "./ui";

interface ShortcutDialogProps {
  open: boolean;
  /** Accelerator or key code currently stored, shown as the starting point. */
  value: string;
  onCancel: () => void;
  onAccept: (accelerator: string) => void;
  /**
   * What is being recorded.
   *
   * `accelerator` is a global shortcut: it must include a modifier, because the
   * OS hands it every keystroke system-wide. `key` is the AI mode toggle, which
   * is only observed inside the search window, so a bare key such as `Tab` is
   * both valid and the default.
   */
  variant?: "accelerator" | "key";
}

/**
 * Modal recorder for a key binding.
 *
 * Recording happens in its own focused dialog rather than inside the settings
 * row: the combination being captured needs room to be shown as large key caps,
 * and the surrounding UI must not react to the keys being pressed.
 *
 * For a global shortcut the caller releases it for the duration, so the
 * combination currently in use can be re-recorded. The in-window mode key needs
 * no such suspension, because it was never registered with the OS.
 */
export function ShortcutDialog({
  open,
  value,
  onCancel,
  onAccept,
  variant = "accelerator",
}: ShortcutDialogProps) {
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

      if (variant === "key") {
        // Modifiers only so far: show them and wait for the final key. Unlike a
        // global shortcut this may end at the modifier, so Enter accepts what is
        // held rather than being ignored.
        if (isModifierCode(event.code)) {
          setHeld(modifiersHeld(event));
          setProblem(null);
          return;
        }

        const accelerator = acceleratorFromKeyboardEvent(event);

        if (!accelerator || !isValidModeKey(accelerator)) {
          setProblem(`${formatAccelerator(event.code)} is already used by the search window.`);
          return;
        }

        setHeld(formatAccelerator(accelerator).split(" + "));
        setProblem(null);
        // Let the accepted caps paint before the dialog closes.
        window.setTimeout(() => onAccept(accelerator), 140);
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
  }, [open, held.length, onCancel, onAccept, variant]);

  // Move focus into the dialog so the window-level Escape handler in the
  // settings window does not fire first.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const caps =
    held.length > 0 ? held : formatAccelerator(value).split(" + ");
  const isHolding = held.length > 0;

  const isKey = variant === "key";

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
        aria-label={isKey ? "Record AI mode key" : "Record global shortcut"}
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
            {problem ??
              (isHolding
                ? "Now press the final key"
                : isKey
                  ? "Press any single key"
                  : "Press a key combination")}
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <span className="text-[11.5px] text-fg-subtle">
            {isKey ? "AI mode key" : "Global shortcut"}
          </span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
            Close
            <Kbd>Esc</Kbd>
            {!isKey && (
              <>
                <span>or</span>
                <Kbd>⏎</Kbd>
              </>
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
