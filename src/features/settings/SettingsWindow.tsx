import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../../hooks/useSettings";
import { ipc, toAppError } from "../../lib/ipc";
import { applyTheme } from "../../lib/theme";
import type { SearchEngine, Settings, Theme } from "../../types";
import { CloseIcon } from "../../components/icons";
import {
  InlineError,
  SegmentedControl,
  SettingsGroup,
  SettingsRow,
} from "../../components/ui";
import { Select } from "../../components/Select";
import { ShortcutRecorder } from "./ShortcutRecorder";

/** Engine icons are served as static files from `public/`. */
const ICONS_BASE = "/icons-search-engine";

export function SettingsWindow() {
  const { settings, shortcut, loading, error, update } = useSettings();
  const [engines, setEngines] = useState<SearchEngine[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    ipc.listSearchEngines().then(setEngines).catch(() => setEngines([]));
  }, []);

  // Escape closes settings, matching the search window. The recorder captures
  // its own Escape while it is active, so this never interferes with recording.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void ipc.hideSettingsWindow();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const patch = useCallback(
    (partial: Partial<Settings>) => {
      if (!settings) return;
      setSaveError(null);
      update({ ...settings, ...partial }).catch((cause) => {
        setSaveError(toAppError(cause).message);
      });
    },
    [settings, update],
  );

  // A registration failure reported by the backend and a failure from the last
  // save attempt are both shortcut problems; show the most recent one.
  const shortcutError = saveError ?? shortcut?.error?.message ?? null;

  return (
    <div className="surface flex h-full w-full flex-col overflow-hidden">
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2"
        data-tauri-drag-region
      >
        <h1 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">Settings</h1>
        <button
          type="button"
          onClick={() => void ipc.hideSettingsWindow()}
          aria-label="Close settings"
          className="focus-ring flex size-7 items-center justify-center rounded-control text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg-muted"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {loading && !settings ? (
          <p className="text-[12.5px] text-fg-muted">Loading settings...</p>
        ) : error ? (
          <InlineError message={error} />
        ) : settings ? (
          <>
            <SettingsGroup title="General">
              <SettingsRow
                label="Global shortcut"
                description="Opens the search window from anywhere."
                control={
                  <ShortcutRecorder
                    value={settings.globalShortcut}
                    onChange={(globalShortcut) => patch({ globalShortcut })}
                    error={shortcutError}
                  />
                }
              />
              {shortcutError && (
                <p role="alert" className="px-1 py-2 text-[11.5px] leading-4 text-danger">
                  {shortcutError}
                </p>
              )}
            </SettingsGroup>

            <SettingsGroup title="Search">
              <SettingsRow
                label="Search engine"
                htmlFor="search-engine"
                control={
                  <Select<string>
                    id="search-engine"
                    label="Search engine"
                    value={settings.searchEngine}
                    options={engines.map((engine) => ({
                      value: engine.id,
                      label: engine.name,
                      iconSrc: `${ICONS_BASE}/${engine.icon}`,
                    }))}
                    onChange={(searchEngine) => patch({ searchEngine })}
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup title="Appearance">
              <SettingsRow
                label="Theme"
                description="System follows your Windows setting."
                control={
                  <SegmentedControl<Theme>
                    name="theme"
                    label="Theme"
                    value={settings.theme}
                    options={[
                      { value: "system", label: "System" },
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ]}
                    onChange={(theme) => {
                      applyTheme(theme);
                      patch({ theme });
                    }}
                  />
                }
              />
            </SettingsGroup>
          </>
        ) : null}
      </div>

      <footer className="flex h-12 shrink-0 items-center justify-between border-t border-line pl-4 pr-2.5">
        <p className="text-[11px] text-fg-subtle">Changes are saved automatically.</p>
        <button
          type="button"
          onClick={() => void ipc.quitApp()}
          className="focus-ring rounded-control px-2.5 py-1.5 text-[12px] font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
        >
          Quit Search Short
        </button>
      </footer>
    </div>
  );
}
