/**
 * Accelerator helpers.
 *
 * The stored format is the one the Rust global-shortcut plugin parses:
 * lowercase modifiers first, then a `KeyboardEvent.code` value —
 * for example `alt+KeyT` or `ctrl+shift+Digit1`.
 */

const MODIFIER_DISPLAY: Record<string, string> = {
  alt: "Alt",
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  super: "Super",
  command: "Super",
  cmd: "Super",
};

const CODE_DISPLAY: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Del",
  Escape: "Esc",
  Tab: "Tab",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => formatPart(part.trim()))
    .join(" + ");
}

function formatPart(part: string): string {
  const lower = part.toLowerCase();
  if (MODIFIER_DISPLAY[lower]) return MODIFIER_DISPLAY[lower];
  if (lower.startsWith("key") && lower.length === 4) return lower.slice(3).toUpperCase();
  if (lower.startsWith("digit") && lower.length === 6) return lower.slice(5);
  if (lower.startsWith("numpad")) return `Num ${lower.slice(6)}`;
  return CODE_DISPLAY[part] ?? part;
}

/** Keys that only exist to modify another key. */
const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "ContextMenu",
]);

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

/**
 * Converts a keydown event into a stored accelerator, or `null` when the event
 * is only a modifier (the user is still holding the combination).
 */
export function acceleratorFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (isModifierCode(event.code)) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("super");
  parts.push(event.code);

  return parts.join("+");
}

/**
 * Modifier labels currently held, in display order.
 *
 * Used to render live key caps while the user is still holding the combination
 * together, before the final key arrives.
 */
export function modifiersHeld(event: KeyboardEvent): string[] {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  return parts;
}

/**
 * Mirrors the Rust-side rule: a global shortcut must include at least one
 * modifier, otherwise it would swallow a normal typing key system-wide.
 */
export function validateAccelerator(accelerator: string): string | null {
  const parts = accelerator.split("+").filter(Boolean);
  const modifiers = parts.slice(0, -1);

  if (modifiers.length === 0) {
    return "Include a modifier key (Alt, Ctrl, Shift, or Super).";
  }

  return null;
}
