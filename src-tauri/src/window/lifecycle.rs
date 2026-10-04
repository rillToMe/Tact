use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

use crate::error::{AppError, AppResult, Ctx, ErrorCode};

pub const SEARCH_WINDOW: &str = "search";
pub const SETTINGS_WINDOW: &str = "settings";

/// Emitted whenever the search window becomes visible and ready for input.
pub const EVENT_SEARCH_OPENED: &str = "search://opened";
/// Emitted whenever settings change so every window can stay in sync.
pub const EVENT_SETTINGS_CHANGED: &str = "settings://changed";

/// True once the search window has been focused since it was last shown.
///
/// Windows sometimes refuses the first focus request for a window that was just
/// made visible. Without this guard the blur that follows would hide the search
/// window the instant it appeared.
static SEARCH_WAS_FOCUSED: AtomicBool = AtomicBool::new(false);

/// How long to wait before trusting a blur.
///
/// Activating a window produces a transient blur/focus sequence. Hiding on the
/// raw event makes the window flicker away right after it opens, so the blur is
/// confirmed once the desktop has settled.
const BLUR_SETTLE: Duration = Duration::from_millis(160);

fn get_window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label).ok_or_else(|| {
        log::error!("window {label:?} is missing");
        AppError::new(
            ErrorCode::WindowUnavailable,
            "The window could not be opened.",
        )
    })
}

/// Shows a window, restores it if minimized, and gives it keyboard focus.
fn reveal(window: &WebviewWindow) -> AppResult<()> {
    if window.is_minimized().unwrap_or(false) {
        window
            .unminimize()
            .ctx("unminimize window", "The window could not be restored.")?;
    }

    window
        .show()
        .ctx("show window", "The window could not be shown.")?;

    // Windows sometimes refuses the first focus request for a window that was
    // just shown; a second attempt is enough in practice.
    if window.set_focus().is_err() {
        log::warn!(
            "first focus attempt failed for {:?}; retrying",
            window.label()
        );
        window
            .set_focus()
            .ctx("focus window", "The window could not be focused.")?;
    }

    Ok(())
}

pub fn show_search(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, SEARCH_WINDOW)?;
    SEARCH_WAS_FOCUSED.store(false, Ordering::Relaxed);
    reveal(&window)?;
    window
        .emit(EVENT_SEARCH_OPENED, ())
        .ctx("emit search opened", "The window could not notify the UI.")?;
    Ok(())
}

pub fn hide_search(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, SEARCH_WINDOW)?;
    window
        .hide()
        .ctx("hide search window", "The window could not be hidden.")?;
    Ok(())
}

/// Reuses the single search window: pressing the shortcut while it is already
/// focused dismisses it, otherwise it is brought to the front.
pub fn toggle_search(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, SEARCH_WINDOW)?;
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);

    if visible && focused {
        hide_search(app)
    } else {
        show_search(app)
    }
}

pub fn show_settings(app: &AppHandle) -> AppResult<()> {
    let _ = hide_search(app);
    let window = get_window(app, SETTINGS_WINDOW)?;
    reveal(&window)
}

pub fn hide_settings(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, SETTINGS_WINDOW)?;
    window.hide().ctx(
        "hide settings window",
        "The settings window could not be hidden.",
    )?;
    Ok(())
}

/// Registered through `Builder::on_window_event`.
///
/// * Closing a window hides it instead of destroying it, so the global shortcut
///   keeps working and the search window stays instant to reopen.
/// * The search window dismisses itself once it loses focus, which is what makes
///   the interaction feel like a launcher rather than a window.
pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        WindowEvent::Focused(true) if window.label() == SEARCH_WINDOW => {
            SEARCH_WAS_FOCUSED.store(true, Ordering::Relaxed);
        }
        // Ignore blurs until the window has actually held focus, then confirm
        // the blur off the event path before hiding.
        WindowEvent::Focused(false)
            if window.label() == SEARCH_WINDOW && SEARCH_WAS_FOCUSED.load(Ordering::Relaxed) =>
        {
            confirm_blur_then_hide(window.app_handle().clone());
        }
        _ => {}
    }
}

/// Hides the search window only if it is still unfocused once the desktop has
/// settled, so a transient blur cannot dismiss it mid-activation.
fn confirm_blur_then_hide(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(BLUR_SETTLE);

        let Some(window) = app.get_webview_window(SEARCH_WINDOW) else {
            return;
        };

        if !window.is_visible().unwrap_or(false) {
            return;
        }

        // Focus came back (or never really left); keep the window open.
        if window.is_focused().unwrap_or(false) {
            return;
        }

        SEARCH_WAS_FOCUSED.store(false, Ordering::Relaxed);
        if let Err(error) = window.hide() {
            log::warn!("search window could not be hidden after losing focus: {error}");
        }
    });
}
