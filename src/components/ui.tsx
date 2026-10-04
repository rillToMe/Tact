import { cn } from "../lib/cn";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: React.ReactNode;
}

export function IconButton({ label, children, className, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "focus-ring flex size-7 shrink-0 items-center justify-center rounded-control",
        "text-fg-subtle transition-colors duration-150",
        "hover:bg-surface-hover hover:text-fg-muted",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

interface KbdProps {
  children: React.ReactNode;
  /** `lg` is used by the shortcut recorder dialog. */
  size?: "sm" | "lg";
}

export function Kbd({ children, size = "sm" }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-chip border border-line",
        "bg-surface-elevated font-medium text-fg-muted",
        size === "lg"
          ? "h-8 min-w-8 px-2.5 text-[13px] shadow-[0_1px_0_var(--border)]"
          : "h-[21px] min-w-[21px] px-1.5 text-[11px]",
      )}
    >
      {children}
    </kbd>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[12.5px] leading-5 text-danger">
      {message}
    </p>
  );
}

/**
 * A settings group.
 *
 * Deliberately not a card: the group is separated by spacing and a small
 * sentence-case heading, and its rows are divided by hairlines. Wrapping each
 * group in a bordered box is what makes a settings pane look like a dashboard.
 */
export function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="px-1 pb-1.5 text-[11.5px] font-medium text-fg-subtle">{title}</h2>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  /** Associates the visible label with a form control for assistive tech. */
  htmlFor?: string;
  control: React.ReactNode;
}

export function SettingsRow({ label, description, htmlFor, control }: SettingsRowProps) {
  const Label = htmlFor ? "label" : "span";

  return (
    <div className="flex items-center justify-between gap-6 px-1 py-2.5">
      <div className="min-w-0">
        <Label
          {...(htmlFor ? { htmlFor } : {})}
          className="block text-[13px] text-fg"
        >
          {label}
        </Label>
        {description && (
          <p className="mt-px text-[11.5px] leading-4 text-fg-subtle">{description}</p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  name: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}

export function SegmentedControl<T extends string>({
  name,
  value,
  options,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-control bg-surface-sunken p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "cursor-pointer rounded-[5px] px-2.5 py-[3px] text-[12px] font-medium",
              "transition-colors duration-150",
              "has-[:focus-visible]:outline has-[:focus-visible]:outline-2",
              "has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-1",
              selected
                ? "bg-surface-elevated text-fg shadow-[0_1px_2px_rgb(0_0_0/0.14)]"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
