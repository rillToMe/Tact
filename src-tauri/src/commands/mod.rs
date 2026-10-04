use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

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
}

fn payload(state: &SettingsState, shortcut: &ShortcutState) -> SettingsPayload {
    SettingsPayload {
        settings: state.snapshot(),
        shortcut: shortcut.status(),
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
#[tauri::command]
pub fn submit_search(
    app: AppHandle,
    state: State<'_, SettingsState>,
    query: String,
) -> AppResult<String> {
    let settings = state.snapshot();
    let engine = engine::resolve(&settings.search_engine);
    let url = engine::build_search_url(engine, &query)?;

    log::info!("submit_search: engine={} url={url}", engine.id);

    open_external(&app, &url)?;
    hide_search(&app)?;
    Ok(url)
}

#[tauri::command]
pub fn hide_search_window(app: AppHandle) -> AppResult<()> {
    hide_search(&app)
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
