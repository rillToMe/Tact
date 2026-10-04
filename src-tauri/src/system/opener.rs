use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult, ErrorCode};

/// Hands the URL to the operating system, so it opens in the user's default
/// browser (or whatever app is registered for HTTP/HTTPS).
///
/// No embedded browser is involved: the app is a launcher, not a browser.
pub fn open_external(app: &AppHandle, url: &str) -> AppResult<()> {
    app.opener().open_url(url, None::<&str>).map_err(|error| {
        log::error!("could not open {url:?}: {error}");
        AppError::new(
            ErrorCode::OpenUrlFailed,
            "Your browser could not be opened. Make sure a default browser is set.",
        )
    })?;

    log::info!("opened {url} in the default browser");
    Ok(())
}
