use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow, WindowEvent,
};

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

    // Every appearance starts as a plain search bar. The window is reused for
    // both modes, so without this reset it would reopen still expanded from the
    // previous AI conversation - a large panel with nothing in it.
    if let Err(error) = resize_keeping_top(&window, SEARCH_COLLAPSED.0, SEARCH_COLLAPSED.1) {
        // A failed reset is cosmetic: the window is still usable, and refusing
        // to show it would be far worse than showing it at the wrong size.
        log::warn!("search window could not be reset to its collapsed size: {error}");
    }

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

/// Size of the search window with only the search bar visible.
///
/// The panel is 628x64 and `App.tsx` adds 12px of padding on every side for the
/// floating surface's shadow, so the window is the panel plus that padding.
pub const SEARCH_COLLAPSED: (f64, f64) = (652.0, 88.0);

/// Size of the search window while an AI conversation is on screen.
///
/// The panel is the window minus the 12px of shadow padding on every side, so
/// this leaves 496px: 64px for the search bar, 32px for the footer, and 400px
/// of transcript. That is about twenty lines of reply, which covers a short
/// answer without scrolling.
pub const SEARCH_EXPANDED: (f64, f64) = (652.0, 520.0);

/// Grows or shrinks the search window between its two modes.
///
/// The window is `resizable: false`, but that flag only governs *user* resizing:
/// the OS drag borders and the maximize button. Programmatic resizing still
/// works, which is what this relies on. The panel must stay a fixed size the
/// user cannot drag, while still changing shape between search and chat.
pub fn set_search_expanded(app: &AppHandle, expanded: bool) -> AppResult<()> {
    let window = get_window(app, SEARCH_WINDOW)?;
    let (width, height) = if expanded {
        SEARCH_EXPANDED
    } else {
        SEARCH_COLLAPSED
    };
    resize_keeping_top(&window, width, height)
}

/// Resizes a window while holding its top edge in place.
///
/// Anchoring the top rather than the centre is what makes the AI panel read as
/// an expansion of the search bar: the bar stays exactly where the user's eyes
/// already are, and the panel unfolds beneath it.
fn resize_keeping_top(window: &WebviewWindow, width: f64, height: f64) -> AppResult<()> {
    let scale = window.scale_factor().unwrap_or(1.0);
    let origin = window
        .outer_position()
        .ok()
        .map(|position| position.to_logical::<f64>(scale));

    window
        .set_size(LogicalSize::new(width, height))
        .ctx("resize window", "The window could not be resized.")?;

    let Some(origin) = origin else {
        return Ok(());
    };

    let (mut x, mut y) = (origin.x, origin.y);

    // An expanded panel is tall enough to run past the bottom of the screen, so
    // it is pulled back inside the monitor's work area - which excludes the
    // taskbar, so the panel never ends up underneath it.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let area = monitor.work_area();
        let area_origin = area.position.to_logical::<f64>(scale);
        let area_size = area.size.to_logical::<f64>(scale);

        let max_x = area_origin.x + area_size.width - width;
        let max_y = area_origin.y + area_size.height - height;

        x = x.clamp(area_origin.x, max_x.max(area_origin.x));
        y = y.clamp(area_origin.y, max_y.max(area_origin.y));
    }

    window
        .set_position(LogicalPosition::new(x, y))
        .ctx("reposition window", "The window could not be repositioned.")?;

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
