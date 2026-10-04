use tauri::{App, WebviewWindowBuilder};

use crate::error::{AppResult, Ctx};

/// Creates the windows declared in `tauri.conf.json`.
///
/// Those entries are marked `"create": false`, which stops Tauri from building
/// them during its own setup pass. That matters: Tauri creates config windows
/// *before* it runs the app's `setup` hook, so a webview would already be
/// loading - and calling `get_settings` - while `SettingsState` was still
/// unmanaged. Those early calls were rejected with "state not managed" and the
/// frontend silently fell back to defaults, which showed up as the wrong theme
/// and a missing engine icon on first launch.
///
/// Building them here, after the state is managed, removes that race entirely
/// rather than papering over it with retries in the frontend.
pub fn create_windows(app: &App) -> AppResult<()> {
    for config in app.config().app.windows.iter().filter(|w| !w.create) {
        WebviewWindowBuilder::from_config(app.handle(), config)
            .and_then(WebviewWindowBuilder::build)
            .ctx(
                &format!("create window {:?}", config.label),
                "A window could not be created.",
            )?;
    }

    Ok(())
}
