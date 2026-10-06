import { useCallback, useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { ipc, toAppError } from "../../lib/ipc";
import { formatModeKey } from "../../lib/shortcut";
import { Kbd, SettingsGroup, SettingsRow, Switch } from "../../components/ui";
import { CheckIcon, CloseIcon } from "../../components/icons";
import { ShortcutDialog } from "../../components/ShortcutDialog";
import type { AiSettings } from "../../types";

/**
 * A text field that is editable locally but adopts external changes.
 *
 * The settings window saves on every change, so the value coming back from the
 * backend is the authority (it is normalized there - a trailing slash stripped
 * from a URL, a blank prompt replaced). The draft exists so typing is not fought
 * by that round trip.
 *
 * The sync happens during render rather than in an effect: React documents this
 * as the way to adjust state when a prop changes, and doing it in an effect
 * would render the stale value first and then immediately render again.
 *
 * Only the field whose own server value changed is reset, so saving one field
 * does not discard half-typed text in another.
 */
function useDraft(serverValue: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(serverValue);
  const [synced, setSynced] = useState(serverValue);

  if (synced !== serverValue) {
    setSynced(serverValue);
    setDraft(serverValue);
  }

  return [draft, setDraft];
}

interface ApiKeyFieldProps {
  /** Whether a key is already stored in the Windows Credential Manager. */
  stored: boolean;
}

/**
 * Write-only API key input.
 *
 * The stored key is never sent back to the frontend - not even masked - so this
 * field cannot display it. It reports only whether one exists, and treats any
 * text the user types as a replacement. That is a deliberate trade: a
 * round-trippable key would have to cross the IPC boundary, where anything
 * running in the webview could read it.
 */
export function ApiKeyField({ stored }: ApiKeyFieldProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The field owns what it displays after a write, because the parent only
  // learns "a key exists" and would otherwise need a round trip to reflect it.
  const [hasKey, setHasKey] = useState(stored);
  const [syncedStored, setSyncedStored] = useState(stored);

  if (syncedStored !== stored) {
    setSyncedStored(stored);
    setHasKey(stored);
  }

  // Clear the confirmation shortly after it appears so it reads as a transient
  // acknowledgement rather than a permanent state.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const save = useCallback(async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.setAiApiKey(draft);
      // Clear the field immediately: the value now lives in the OS store, and
      // leaving it in the DOM would keep the secret in the page.
      setDraft("");
      setSaved(true);
      setHasKey(true);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  }, [draft, busy]);

  const clear = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.clearAiApiKey();
      setDraft("");
      setSaved(false);
      setHasKey(false);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="password"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
            setSaved(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={hasKey ? "Replace key..." : "Paste API key"}
          aria-label="API key"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "focus-ring h-8 w-[190px] rounded-control border bg-surface-elevated px-2.5",
            "text-[12.5px] text-fg placeholder:text-fg-subtle",
            error ? "border-danger/55" : "border-line",
          )}
        />

        {hasKey && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            aria-label="Remove the stored API key"
            title="Remove the stored API key"
            className={cn(
              "focus-ring flex size-8 shrink-0 items-center justify-center rounded-control",
              "text-fg-subtle transition-colors duration-150",
              "hover:bg-surface-hover hover:text-danger",
              busy && "opacity-50",
            )}
          >
            <CloseIcon size={13} />
          </button>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={!draft.trim() || busy}
          className={cn(
            "focus-ring h-8 shrink-0 rounded-control px-2.5 text-[12px] font-medium",
            "transition-colors duration-150",
            !draft.trim() || busy
              ? "cursor-not-allowed text-fg-subtle"
              : "bg-accent-soft text-accent hover:bg-accent hover:text-white",
          )}
        >
          Save
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[11.5px] leading-4 text-danger">
          {error}
        </p>
      ) : saved ? (
        <p className="flex items-center gap-1 text-[11.5px] leading-4 text-fg-subtle">
          <CheckIcon size={12} className="text-accent" />
          Saved
        </p>
      ) : (
        <p className="flex items-center gap-1 text-[11.5px] leading-4 text-fg-subtle">
          {hasKey ? (
            <>
              <CheckIcon size={12} className="text-accent" />A key is stored
            </>
          ) : (
            "Kept in Windows Credential Manager, not in settings."
          )}
        </p>
      )}
    </div>
  );
}

interface ModeKeyRecorderProps {
  value: string;
  onChange: (modeKey: string) => void;
}

/**
 * The AI mode key row's control: shows the key as a cap and opens a recorder.
 *
 * A bare key is valid here, unlike the global shortcut, because it is only
 * observed inside the search window. Nothing is registered with the OS, so
 * there is nothing to suspend while recording.
 */
export function ModeKeyRecorder({ value, onChange }: ModeKeyRecorderProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Change the AI mode key. Current key ${formatModeKey(value)}`}
        className={cn(
          "focus-ring flex min-h-8 items-center gap-1 rounded-control border px-2 py-1",
          "border-line bg-surface-elevated transition-colors duration-150 hover:border-line-strong",
        )}
      >
        <Kbd>{formatModeKey(value)}</Kbd>
      </button>

      <ShortcutDialog
        open={open}
        value={value}
        variant="key"
        onCancel={() => setOpen(false)}
        onAccept={(modeKey) => {
          setOpen(false);
          onChange(modeKey);
        }}
      />
    </>
  );
}

interface AiSettingsPanelProps {
  settings: AiSettings;
  apiKeySet: boolean;
  onPatch: (partial: Partial<AiSettings>) => void;
}

/**
 * The AI settings page.
 *
 * Everything here is opt-in: with the toggle off, no request is ever made and
 * the search window behaves exactly as it did before this feature existed.
 */
export function AiSettingsPanel({ settings, apiKeySet, onPatch }: AiSettingsPanelProps) {
  const [model, setModel] = useDraft(settings.model);
  const [baseUrl, setBaseUrl] = useDraft(settings.baseUrl);
  const [systemPrompt, setSystemPrompt] = useDraft(settings.systemPrompt);

  return (
    <>
      <SettingsGroup title="AI chat">
          <SettingsRow
            label="Enable AI chat"
            description="Adds an AI mode to the search window."
            control={
              <Switch
                checked={settings.enabled}
                onChange={(enabled) => onPatch({ enabled })}
                label="Enable AI chat"
              />
            }
          />
      </SettingsGroup>

      {/* Everything below is meaningless while AI is off, so it is hidden
          rather than shown disabled - a page of greyed-out fields reads as
          broken rather than as inactive. */}
      {settings.enabled && (
        <>
          <SettingsGroup title="Provider">
            <SettingsRow
              label="Base URL"
              description="OpenAI-compatible endpoint, without /chat/completions."
              control={
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  onBlur={() => {
                    if (baseUrl !== settings.baseUrl) onPatch({ baseUrl });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onPatch({ baseUrl });
                    }
                  }}
                  placeholder="https://api.openai.com/v1"
                  aria-label="Base URL"
                  autoComplete="off"
                  spellCheck={false}
                  className="focus-ring h-8 w-[240px] rounded-control border border-line bg-surface-elevated px-2.5 text-[12.5px] text-fg placeholder:text-fg-subtle"
                />
              }
            />

            <SettingsRow
              label="Model"
              description="Exact model name the provider expects."
              control={
                <input
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  onBlur={() => {
                    if (model !== settings.model) onPatch({ model });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onPatch({ model });
                    }
                  }}
                  placeholder="gpt-4o-mini"
                  aria-label="Model"
                  autoComplete="off"
                  spellCheck={false}
                  className="focus-ring h-8 w-[190px] rounded-control border border-line bg-surface-elevated px-2.5 text-[12.5px] text-fg placeholder:text-fg-subtle"
                />
              }
            />

            <SettingsRow
              label="API key"
              description="Never leaves this machine except to your provider."
              control={<ApiKeyField stored={apiKeySet} />}
            />
          </SettingsGroup>

          <SettingsGroup title="Behaviour">
            <SettingsRow
              label="AI mode key"
              description="Press it in the search bar to switch to AI."
              control={
                <ModeKeyRecorder
                  value={settings.modeKey}
                  onChange={(modeKey) => onPatch({ modeKey })}
                />
              }
            />

            <SettingsRow
              label="System prompt"
              description="Sent before every conversation."
              control={
                <input
                  type="text"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  onBlur={() => {
                    if (systemPrompt !== settings.systemPrompt) onPatch({ systemPrompt });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onPatch({ systemPrompt });
                    }
                  }}
                  placeholder="You are a helpful assistant."
                  aria-label="System prompt"
                  spellCheck={false}
                  className="focus-ring h-8 w-[240px] rounded-control border border-line bg-surface-elevated px-2.5 text-[12.5px] text-fg placeholder:text-fg-subtle"
                />
              }
            />
          </SettingsGroup>
        </>
      )}
    </>
  );
}
