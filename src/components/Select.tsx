import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { CheckIcon, ChevronIcon } from "./icons";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading image, e.g. a search-engine logo. */
  iconSrc?: string;
}

interface SelectProps<T extends string> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name for the trigger button. */
  label: string;
}

const OPTION_HEIGHT = 34;
const POPUP_PADDING = 4;
const GAP = 6;
const MIN_WIDTH = 184;

/**
 * Leading logo for an option.
 *
 * Icons are not all square: Yahoo is a wide wordmark while the rest are
 * near-square glyphs. Forcing the wordmark into a square box shrinks it to an
 * unreadable smear, so a wide slot is given to wordmarks only. The box keeps a
 * fixed height and the image is contained inside it, so the text column stays
 * aligned whichever shape is used.
 */
function OptionIcon({ src }: { src?: string }) {
  if (!src) return null;
  return (
    <span className="flex h-4 w-[38px] shrink-0 items-center">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="max-h-4 w-auto max-w-full object-contain object-left"
      />
    </span>
  );
}

/**
 * A select built from scratch.
 *
 * The native `<select>` is unusable here for two reasons: its popup is drawn by
 * the OS and ignores the app's surface entirely, and Chromium treats `<select>`
 * as always `:focus-visible`, so it paints a focus ring on every mouse click.
 *
 * The popup is rendered in a portal with fixed positioning so it is never
 * clipped by the settings surface or its scroll container.
 */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  label,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const bounds = trigger.getBoundingClientRect();
    const width = Math.max(bounds.width, MIN_WIDTH);
    const height = options.length * OPTION_HEIGHT + POPUP_PADDING * 2;

    // Flip above the trigger when the popup would run past the window edge.
    const opensUp = bounds.bottom + GAP + height > window.innerHeight - 8;

    setRect({
      top: opensUp ? bounds.top - GAP - height : bounds.bottom + GAP,
      left: Math.max(8, bounds.right - width),
      width,
    });
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }, [options, value]);

  // Close instead of drifting when anything moves underneath the popup.
  useEffect(() => {
    if (!open) return;

    const onScroll = () => setOpen(false);
    const onResize = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Move focus into the list so the arrow keys work immediately.
  useLayoutEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const commit = useCallback(
    (next: T) => {
      onChange(next);
      close(true);
    },
    [onChange, close],
  );

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(true);
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(options[activeIndex].value);
        break;
      default:
        break;
    }
  };

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close(true) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
        className={cn(
          "focus-ring flex h-8 items-center gap-2 rounded-control pl-2.5 pr-2",
          "text-[12.5px] font-medium text-fg transition-colors duration-150",
          "bg-surface-elevated hover:bg-surface-hover",
          open && "bg-surface-hover",
        )}
      >
        {selected?.iconSrc && <OptionIcon src={selected.iconSrc} />}
        <span className="min-w-[64px] flex-1 text-left">{selected?.label}</span>
        <ChevronIcon
          size={14}
          className={cn(
            "text-fg-subtle transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onListKeyDown}
            style={{ top: rect.top, left: rect.left, width: rect.width }}
            className={cn(
              "fixed z-50 p-1 outline-none",
              "rounded-surface border border-line-strong",
              "bg-[var(--surface-popup)] shadow-[var(--shadow-popup)]",
            )}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => commit(option.value)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-[12.5px]",
                    index === activeIndex ? "bg-surface-hover text-fg" : "text-fg-muted",
                  )}
                  style={{ height: OPTION_HEIGHT - 2 }}
                >
                  <OptionIcon src={option.iconSrc} />
                  <span className="flex-1 truncate">{option.label}</span>
                  {isSelected && <CheckIcon size={13} className="text-accent" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
