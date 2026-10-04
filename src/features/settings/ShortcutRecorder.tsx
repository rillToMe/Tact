import { useCallback, useState } from "react";
import { cn } from "../../lib/cn";
import { formatAccelerator } from "../../lib/shortcut";
import { ipc } from "../../lib/ipc";
import { Kbd } from "../../components/ui";
import { ShortcutDialog } from "../../components/ShortcutDialog";

interface ShortcutRecorderProps {
  /** Accelerator currently stored in settings, e.g. `alt+KeyT`. */
  value: string;
  onChange: (accelerator: string) => void;
  error?: string | null;
}

/**
 * The shortcut row's control: shows the current combination as key caps and
 * opens the recorder dialog.
 *
 * The caps are the affordance - the row reads as a display of state, and the
 * whole thing is one click target.
 */
export function ShortcutRecorder({ value, onChange, error }: ShortcutRecorderProps) {
  const [open, setOpen] = useState(false);

  const openDialog = useCallback(() => {
    // Release the global shortcut while recording so the combination currently
    // in use can be pressed without the app reacting to it.
    void ipc.captureShortcut(true);
    setOpen(true);
  }, []);

  const closeDialog = useCallback((next?: string) => {
    setOpen(false);
    if (next) {
      // Accepting saves the new shortcut; the backend claims it and releases
      // the previous one, which also ends the recording suspension.
      onChange(next);
    } else {
      // Cancelled: restore the shortcut that was suspended on open.
      void ipc.captureShortcut(false);
    }
  }, [onChange]);

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-label={`Change global shortcut. Current shortcut ${formatAccelerator(value)}`}
        className={cn(
          "focus-ring flex min-h-8 items-center gap-1 rounded-control border px-2 py-1",
          "bg-surface-elevated transition-colors duration-150",
          error ? "border-danger/55 hover:border-danger" : "border-line hover:border-line-strong",
        )}
      >
        {formatAccelerator(value)
          .split(" + ")
          .map((part) => (
            <Kbd key={part}>{part}</Kbd>
          ))}
      </button>

      <ShortcutDialog
        open={open}
        value={value}
        onCancel={() => closeDialog()}
        onAccept={(accelerator) => closeDialog(accelerator)}
      />
    </>
  );
}
