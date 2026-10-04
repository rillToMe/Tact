import type { Theme } from "../types";

/**
 * Theme application.
 *
 * The resolved theme lives on `<html>` as a `dark` class plus `color-scheme`,
 * which is what the semantic tokens in `index.css` key off.
 *
 * `currentTheme` is module state so the system listener knows whether the user
 * is following the system or has pinned Light/Dark.
 */
let currentTheme: Theme = "system";

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function paint(dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  currentTheme = theme;
  paint(theme === "system" ? prefersDark() : theme === "dark");
}

/**
 * Paints the system preference before React mounts, so the window never flashes
 * the wrong background. The stored preference is applied once settings load.
 */
export function applyInitialTheme(): void {
  paint(prefersDark());

  // Installed once per window at module scope, so no component has to remember
  // to subscribe and an explicit Light/Dark choice is never overridden.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (event) => {
      if (currentTheme === "system") {
        paint(event.matches);
      }
    });
}
