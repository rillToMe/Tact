mod commands;
mod error;
mod search;
mod settings;
mod shortcut;
mod system;
mod window;

use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState as ShortcutEventState;

use crate::settings::{SettingsState, store};
use crate::shortcut::ShortcutState;
use crate::window::{handle_window_event, toggle_search};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Release builds stay quiet; debug builds log at Info so shortcut
    // registration and search URLs can be inspected while developing.
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Info
    } else {
        log::LevelFilter::Warn
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log_level).build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutEventState::Pressed
                        && let Err(error) = toggle_search(app)
                    {
                        log::error!("search window could not be toggled: {}", error.message);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();

            let settings = store::load(&handle);
            let shortcut = ShortcutState::new(settings.global_shortcut.clone());
            if let Err(error) = shortcut.register(&handle) {
                // A shortcut conflict must not stop the app from starting; the
                // tray icon keeps it reachable and the error is surfaced in
                // Settings.
                log::error!("global shortcut unavailable at startup: {}", error.message);
                shortcut.set_error(error);
            }

            app.manage(SettingsState::new(settings));
            app.manage(shortcut);

            if let Err(error) = system::tray::setup(&handle) {
                log::warn!("tray icon unavailable: {}", error.message);
            }

            // The window is created hidden and only shown by the global
            // shortcut or the tray menu, so startup stays silent.
            Ok(())
        })
        .on_window_event(|window, event| {
            handle_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::list_search_engines,
            commands::get_shortcut_status,
            commands::capture_shortcut,
            commands::submit_search,
            commands::hide_search_window,
            commands::open_settings_window,
            commands::hide_settings_window,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
