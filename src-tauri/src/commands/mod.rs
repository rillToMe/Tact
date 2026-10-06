use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

use crate::ai::{self, ChatEvent, ChatRequest};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::search::engine::{self, SearchEngine};
use crate::settings::{Settings, SettingsState, store};
use crate::shortcut::{ShortcutState, ShortcutStatus};
use crate::system::open_external;
use crate::window::{EVENT_SETTINGS_CHANGED, hide_search, hide_settings, show_settings};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPayload {
    pub settings: Settings,
    pub shortcut: ShortcutStatus,
    /// Whether an API key is stored, so the UI can say "saved" without ever
    /// receiving the key itself.
    pub api_key_set: bool,
}

fn payload(state: &SettingsState, shortcut: &ShortcutState) -> SettingsPayload {
    SettingsPayload {
        settings: state.snapshot(),
        shortcut: shortcut.status(),
        api_key_set: ai::secret::is_set(),
    }
}

#[tauri::command]
pub fn get_settings(
    state: State<'_, SettingsState>,
    shortcut: State<'_, ShortcutState>,
) -> SettingsPayload {
    payload(&state, &shortcut)
}

/// Saves settings, applying the global shortcut first.
///
/// If the OS refuses the new shortcut, the previous one is restored and
/// nothing is written, so the app can never end up without a working
/// shortcut.
#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    shortcut: State<'_, ShortcutState>,
    settings: Settings,
) -> AppResult<SettingsPayload> {
    let next = settings.normalized();
    let previous = state.snapshot();

    if next.global_shortcut != previous.global_shortcut
        && let Err(error) = shortcut.apply(&app, &next.global_shortcut)
    {
        // The recorder released the shortcut before capturing; make sure a
        // rejected combination cannot leave the app unresponsive.
        if let Err(resume_error) = shortcut.resume(&app) {
            log::error!("could not restore the previous shortcut: {resume_error}");
        }
        return Err(error);
    }

    // `launch_at_login` is owned by `set_startup_enabled`, which changes the
    // Windows registration and the stored value together. This command carries
    // the whole settings object back, so a value arriving here would be written
    // straight to disk without touching the registry - leaving the two
    // disagreeing. The stored value is carried over instead.
    let next = Settings {
        launch_at_login: previous.launch_at_login,
        ..next
    };

    store::save(&app, &next)?;
    state.replace(next.clone());

    app.emit(EVENT_SETTINGS_CHANGED, &next).map_err(|error| {
        log::error!("settings changed event could not be emitted: {error}");
        AppError::new(
            ErrorCode::Internal,
            "Settings were saved but the windows could not be updated.",
        )
    })?;

    Ok(payload(&state, &shortcut))
}

#[tauri::command]
pub fn list_search_engines() -> &'static [SearchEngine] {
    engine::all()
}

/// Whether the app is registered to start with Windows.
///
/// Read live from Windows rather than from the stored setting, because the user
/// can change it from Task Manager while the app is closed.
#[tauri::command]
pub fn get_startup_enabled(app: AppHandle) -> AppResult<bool> {
    crate::startup::is_enabled(&app)
}

/// Registers or removes the app from Windows startup, and stores the preference.
///
/// The registration is attempted first: if Windows refuses, nothing is written,
/// so the stored value can never claim something that is not true.
#[tauri::command]
pub fn set_startup_enabled(
    app: AppHandle,
    state: State<'_, SettingsState>,
    enabled: bool,
) -> AppResult<bool> {
    crate::startup::set_enabled(&app, enabled)?;

    let mut next = state.snapshot();
    next.launch_at_login = enabled;
    store::save(&app, &next)?;
    state.replace(next.clone());

    app.emit(EVENT_SETTINGS_CHANGED, &next).map_err(|error| {
        log::error!("settings changed event could not be emitted: {error}");
        AppError::new(
            ErrorCode::Internal,
            "The setting was saved but the windows could not be updated.",
        )
    })?;

    Ok(enabled)
}

/// The `!bang` shortcuts, for the settings page and the search bar's hint.
#[tauri::command]
pub fn list_bangs() -> &'static [engine::Bang] {
    engine::all_bangs()
}

#[tauri::command]
pub fn get_shortcut_status(shortcut: State<'_, ShortcutState>) -> ShortcutStatus {
    shortcut.status()
}

/// Releases or restores the global shortcut while the settings window records
/// a new combination.
#[tauri::command]
pub fn capture_shortcut(
    app: AppHandle,
    shortcut: State<'_, ShortcutState>,
    capturing: bool,
) -> AppResult<ShortcutStatus> {
    if capturing {
        shortcut.suspend(&app)?;
    } else {
        shortcut.resume(&app)?;
    }
    Ok(shortcut.status())
}

/// Builds the search URL, hands it to the OS, then hides the window.
///
/// The window is hidden only after the URL opens successfully so a failure
/// leaves the query on screen for a retry.
///
/// A leading `!bang` overrides the configured engine for this one query.
#[tauri::command]
pub fn submit_search(
    app: AppHandle,
    state: State<'_, SettingsState>,
    query: String,
) -> AppResult<String> {
    let settings = state.snapshot();
    let parsed = engine::parse_query(&query);

    let url = match parsed.bang {
        Some(bang) => {
            log::info!(
                "submit_search: bang=!{} query={:?}",
                bang.keyword,
                parsed.query
            );
            engine::build_bang_url(bang, parsed.query)?
        }
        None => {
            let engine = engine::resolve(&settings.search_engine);
            log::info!("submit_search: engine={} url query", engine.id);
            engine::build_search_url(engine, parsed.query)?
        }
    };

    log::info!("submit_search: url={url}");

    open_external(&app, &url)?;
    hide_search(&app)?;
    Ok(url)
}

#[tauri::command]
pub fn hide_search_window(app: AppHandle) -> AppResult<()> {
    hide_search(&app)
}

/// Grows or shrinks the search window for AI mode.
///
/// Driven by the frontend because only it knows when the conversation is
/// actually on screen, and resizing an empty window would show a large blank
/// panel.
#[tauri::command]
pub fn set_search_expanded(app: AppHandle, expanded: bool) -> AppResult<()> {
    crate::window::set_search_expanded(&app, expanded)
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> AppResult<()> {
    show_settings(&app)
}

#[tauri::command]
pub fn hide_settings_window(app: AppHandle) -> AppResult<()> {
    hide_settings(&app)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Stores the AI API key in the Windows Credential Manager.
///
/// The key is written to the OS store and never persisted anywhere else, so it
/// is absent from `settings.json` and from every payload sent to the frontend.
#[tauri::command]
pub fn set_ai_api_key(api_key: String) -> AppResult<()> {
    ai::secret::store(&api_key)
}

#[tauri::command]
pub fn clear_ai_api_key() -> AppResult<()> {
    ai::secret::clear()
}

/// Streams a chat completion, sending each token through `on_event`.
///
/// The reply is streamed rather than awaited whole so a slow model shows
/// progress immediately instead of leaving the window blank for many seconds.
#[tauri::command]
pub async fn send_chat_message(
    state: State<'_, SettingsState>,
    request: ChatRequest,
    on_event: Channel<ChatEvent>,
) -> AppResult<()> {
    let settings = state.snapshot().ai;
    ai::stream_chat(&settings, request, on_event).await
}
