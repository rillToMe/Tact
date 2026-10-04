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

/**
 * Modifier-only key codes, which never complete a keypress on their own.
 *
 * Mirrors `RESERVED_MODE_CODES` in `src-tauri/src/ai/model.rs`.
 */
const MODIFIER_ONLY_CODES = new Set([
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

/**
 * Keys that cannot become the AI mode toggle because the search window already
 * uses them: Enter submits, Escape dismisses.
 *
 * This mirrors the Rust-side rule, which is the authority: the backend
 * re-validates and repairs on load, so this copy only exists to give immediate
 * feedback while recording. If the two ever disagree, Rust wins.
 */
const RESERVED_MODE_CODES = new Set(["Enter", "NumpadEnter", "Escape"]);

/** Modifier tokens accepted in a stored accelerator, in display order. */
const MODIFIER_TOKENS = new Set(["ctrl", "control", "alt", "shift", "super", "command", "cmd"]);

/**
 * True when the recorded accelerator can serve as the AI mode toggle.
 *
 * A modifier is optional here, unlike a global shortcut: `Tab` is the default.
 * A modifier is still *allowed*, which is what makes a letter usable as the
 * toggle - binding a bare `K` would make the search bar impossible to type in.
 */
export function isValidModeKey(accelerator: string): boolean {
  const parts = accelerator.split("+").map((part) => part.trim());
  const code = parts[parts.length - 1];

  if (!code || MODIFIER_ONLY_CODES.has(code)) return false;
  if (RESERVED_MODE_CODES.has(code)) return false;

  // Every part before the key must be a known modifier.
  return parts.slice(0, -1).every((part) => MODIFIER_TOKENS.has(part.toLowerCase()));
}

/**
 * True when a keydown event matches a stored mode key.
 *
 * Both sides are compared as sets: every modifier in the stored accelerator must
 * be held, and no extra modifier may be held. That means a bare `Tab` does not
 * fire while Ctrl is down, so `Ctrl+Tab` stays available to the webview instead
 * of being swallowed by the mode toggle.
 */
export function modeKeyMatches(accelerator: string, event: KeyboardEvent): boolean {
  const parts = accelerator.split("+").map((part) => part.trim());
  const code = parts[parts.length - 1];
  if (!code || code !== event.code) return false;

  const stored = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  const wantsCtrl = stored.has("ctrl") || stored.has("control");
  const wantsSuper = stored.has("super") || stored.has("command") || stored.has("cmd");

  return (
    wantsCtrl === event.ctrlKey &&
    stored.has("alt") === event.altKey &&
    stored.has("shift") === event.shiftKey &&
    wantsSuper === event.metaKey
  );
}

/**
 * Turns a stored mode key into readable key caps.
 *
 * The mode key is stored as an accelerator (`Tab`, `ctrl+KeyK`) so it goes
 * through the same formatter as the global shortcut, which is what keeps the
 * settings row and the search bar's hint chip saying the same thing.
 */
export function formatModeKey(accelerator: string): string {
  return formatAccelerator(accelerator);
}
