import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../../hooks/useSettings";
import { ipc, toAppError } from "../../lib/ipc";
import { applyTheme } from "../../lib/theme";
import { cn } from "../../lib/cn";
import type { AiSettings, Bang, SearchEngine, Settings, Theme } from "../../types";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "../../components/icons";
import {
  InlineError,
  SegmentedControl,
  SettingsGroup,
  SettingsRow,
} from "../../components/ui";
import { Select } from "../../components/Select";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { AiSettingsPanel } from "./AiSettingsPanel";

/** Engine icons are served as static files from `public/`. */
const ICONS_BASE = "/icons-search-engine";

/**
 * The settings pages.
 *
 * AI gets its own page rather than a section on the main one: it has its own
 * enable switch and four provider fields, which would bury the three settings
 * most people actually open this window for.
 */
type Page = "general" | "ai";

export function SettingsWindow() {
  const { settings, shortcut, apiKeySet, loading, error, update } = useSettings();
  const [engines, setEngines] = useState<SearchEngine[]>([]);
  const [bangs, setBangs] = useState<Bang[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("general");

  useEffect(() => {
    ipc.listSearchEngines().then(setEngines).catch(() => setEngines([]));
    // The bang list is reference material; if it fails to load the row simply
    // shows nothing rather than blocking the page.
    ipc.listBangs().then(setBangs).catch(() => setBangs([]));
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

  const patchAi = useCallback(
    (partial: Partial<AiSettings>) => {
      if (!settings) return;
      patch({ ai: { ...settings.ai, ...partial } });
    },
    [settings, patch],
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
        <div className="flex items-center gap-2">
          {page === "ai" ? (
            <button
              type="button"
              onClick={() => setPage("general")}
              className="focus-ring flex items-center gap-1 rounded-control py-1 pl-1 pr-1.5 text-[13px] font-medium text-fg-muted transition-colors duration-150 hover:text-fg"
            >
              <ChevronLeftIcon size={14} />
              Settings
            </button>
          ) : (
            <h1 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">Settings</h1>
          )}
          {page === "ai" && (
            <span className="text-[13px] font-semibold tracking-[-0.01em] text-fg">AI</span>
          )}
        </div>
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
          page === "ai" ? (
            <AiSettingsPanel
              settings={settings.ai}
              apiKeySet={apiKeySet}
              onPatch={patchAi}
            />
          ) : (
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

                {/* The bang list is reference material, not a setting: it is
                    read-only and exists so the shortcuts are discoverable at
                    all. Anything that has to be remembered is not a feature. */}
                <SettingsGroup title="Shortcuts">
                  <SettingsRow
                    label="Search a site directly"
                    description="Type a bang before your query."
                    control={<span className="text-[11.5px] text-fg-subtle">e.g. !yt</span>}
                  />
                  <div className="flex flex-wrap gap-1.5 px-1 py-2.5">
                    {bangs.map((bang) => (
                      <span
                        key={bang.keyword}
                        title={bang.name}
                        className={cn(
                          "flex items-center gap-1.5 rounded-chip border border-line",
                          "bg-surface-elevated py-1 pl-1.5 pr-2 text-[11.5px] text-fg-muted",
                        )}
                      >
                        <img
                          src={`${ICONS_BASE}/${bang.icon}`}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                          className="size-3.5 object-contain"
                        />
                        !{bang.keyword}
                      </span>
                    ))}
                  </div>
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

              <SettingsGroup title="Features">
                <SettingsRow
                  label="AI chat"
                  description={
                    settings.ai.enabled
                      ? "On. Chat with your own provider from the search bar."
                      : "Off. Uses your own OpenAI-compatible provider."
                  }
                  control={
                    <button
                      type="button"
                      onClick={() => setPage("ai")}
                      className="focus-ring flex h-8 items-center gap-1 rounded-control bg-surface-elevated pl-2.5 pr-2 text-[12.5px] font-medium text-fg transition-colors duration-150 hover:bg-surface-hover"
                    >
                      Configure
                      <ChevronRightIcon size={14} className="text-fg-subtle" />
                    </button>
                  }
                />
              </SettingsGroup>
            </>
          )
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
