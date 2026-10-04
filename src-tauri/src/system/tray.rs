use tauri::AppHandle;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use crate::error::AppResult;
use crate::window::{show_search, show_settings};

const MENU_SEARCH: &str = "tray.search";
const MENU_SETTINGS: &str = "tray.settings";
const MENU_QUIT: &str = "tray.quit";

/// The search window is hidden from the taskbar, so the tray icon is the
/// always-available entry point when the global shortcut cannot be used
/// (for example because another application already owns it).
pub fn setup(app: &AppHandle) -> AppResult<()> {
    let search =
        MenuItem::with_id(app, MENU_SEARCH, "Search", true, None::<&str>).map_err(tray_error)?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Settings...", true, None::<&str>)
        .map_err(tray_error)?;
    let separator = PredefinedMenuItem::separator(app).map_err(tray_error)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>).map_err(tray_error)?;

    let menu =
        Menu::with_items(app, &[&search, &settings, &separator, &quit]).map_err(tray_error)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Search Short — Alt + T")
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SEARCH => {
                let _ = show_search(app);
            }
            MENU_SETTINGS => {
                let _ = show_settings(app);
            }
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_search(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app).map_err(tray_error)?;
    Ok(())
}

fn tray_error(error: tauri::Error) -> crate::error::AppError {
    log::error!("tray icon could not be created: {error}");
    crate::error::AppError::new(
        crate::error::ErrorCode::Internal,
        "The tray icon could not be created.",
    )
}
