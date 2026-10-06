use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{App, AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::error::{AppError, AppResult, Ctx, ErrorCode};

use super::lifecycle::{SEARCH_WINDOW, SETTINGS_WINDOW, reveal};
use super::memory::{MemoryTarget, set_target};

/// Serialises window construction.
///
/// Two near-simultaneous requests - the tray menu and the search bar's settings
/// button, say - would otherwise both find Settings absent and both try to
/// build it under the same label. Tauri rejects the second, so the user would
/// get an error where they should have got the window.
static CREATION_LOCK: Mutex<()> = Mutex::new(());

/// How long to wait for the settings page to report a load before showing the
/// window anyway.
///
/// The reveal is driven by the page load so the panel is painted before it
/// appears, rather than a transparent frame flashing where a window should be.
/// This is the backstop for a page that never reports one, which would
/// otherwise leave Settings permanently invisible.
const REVEAL_DEADLINE: Duration = Duration::from_millis(700);

/// Creates the window that has to exist before the user does anything.
///
/// Only the search window: it is what the global shortcut and the tray icon
/// show, so it has to be ready the instant either fires.
///
/// The config entries are marked `"create": false`, which stops Tauri building
/// them during its own setup pass. That matters: Tauri creates config windows
/// *before* it runs the app's `setup` hook, so a webview would already be
/// loading - and calling `get_settings` - while `SettingsState` was still
/// unmanaged. Those early calls were rejected with "state not managed" and the
/// frontend silently fell back to defaults, which showed up as the wrong theme
/// and a missing engine icon on first launch. Building the window here, after
/// the state is managed, removes that race entirely rather than papering over
/// it with retries in the frontend.
///
/// Settings is deliberately *not* built here. It used to be, and the cost was a
/// second WebView2 host - its own DOM, its own JavaScript context, and a full
/// load and execution of the frontend bundle - held for the whole session, for
/// a window many users open rarely or never. `ensure_settings_window` builds it
/// on first use instead.
pub fn create_startup_windows(app: &App) -> AppResult<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == SEARCH_WINDOW)
        .cloned()
        .ok_or_else(|| {
            log::error!("no window config for {SEARCH_WINDOW:?}");
            AppError::new(
                ErrorCode::WindowUnavailable,
                "The window could not be created.",
            )
        })?;

    WebviewWindowBuilder::from_config(app.handle(), &config)
        .and_then(WebviewWindowBuilder::build)
        .ctx(
            "create search window",
            "The search window could not be created.",
        )?;

    // The window is built hidden and stays that way until the shortcut or the
    // tray asks for it, so it starts in the state that costs the least. Without
    // this it would sit at full memory from launch until its first hide, which
    // for a user who never opens it is the entire session.
    if let Some(window) = app.get_webview_window(SEARCH_WINDOW) {
        set_target(&window, MemoryTarget::Inactive);
    }

    Ok(())
}

/// Returns the settings window, building it the first time it is asked for.
///
/// The second value reports whether this call is what created it, which the
/// caller needs: a window that already exists is fully loaded and can be shown
/// at once, while a new one reveals itself once its page has painted.
///
/// Creating on demand rather than at startup is what keeps the idle process
/// tree down to a single WebView.
pub fn ensure_settings_window(app: &AppHandle) -> AppResult<(WebviewWindow, bool)> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        return Ok((window, false));
    }

    let _guard = CREATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    // Re-checked under the lock: a concurrent caller may have built it while
    // this one was waiting for the guard.
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        return Ok((window, false));
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == SETTINGS_WINDOW)
        .cloned()
        .ok_or_else(|| {
            log::error!("no window config for {SETTINGS_WINDOW:?}");
            AppError::new(
                ErrorCode::WindowUnavailable,
                "The settings window could not be opened.",
            )
        })?;

    let revealed = Arc::new(AtomicBool::new(false));

    let window = {
        let revealed = revealed.clone();

        WebviewWindowBuilder::from_config(app, &config)
            .map(|builder| {
                builder.on_page_load(move |window, payload| {
                    if matches!(payload.event(), PageLoadEvent::Finished) {
                        reveal_once(&window, &revealed);
                    }
                })
            })
            .and_then(WebviewWindowBuilder::build)
            .ctx(
                "create settings window",
                "The settings window could not be opened.",
            )?
    };

    // Backstop for a page that never reports a load: showing an empty window is
    // still better than leaving the user with no way to reach Settings.
    {
        let window = window.clone();
        let revealed = revealed.clone();

        std::thread::spawn(move || {
            std::thread::sleep(REVEAL_DEADLINE);
            reveal_once(&window, &revealed);
        });
    }

    Ok((window, true))
}

/// Shows and focuses a window, at most once across every holder of the flag.
///
/// The page-load handler and the deadline backstop race each other by design,
/// and whichever arrives second must do nothing.
fn reveal_once(window: &WebviewWindow, revealed: &AtomicBool) {
    if revealed.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Err(error) = reveal(window) {
        log::warn!("settings window could not be revealed: {error}");
    }
}
