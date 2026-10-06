mod ai;
mod commands;
mod error;
mod search;
mod settings;
mod shortcut;
mod startup;
mod system;
mod window;

use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState as ShortcutEventState;

use crate::settings::{SettingsState, store};
use crate::shortcut::ShortcutState;
use crate::window::{handle_window_event, toggle_search};

/// The log level when `SEARCH_SHORT_LOG` is unset.
///
/// Debug builds are chatty because that is what they are for; release builds
/// keep warnings and errors only, so a normal run writes nothing but problems.
fn default_log_level() -> log::LevelFilter {
    if cfg!(debug_assertions) {
        log::LevelFilter::Info
    } else {
        log::LevelFilter::Warn
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Release builds stay quiet; debug builds log at Info so shortcut
    // registration and search URLs can be inspected while developing.
    //
    // `SEARCH_SHORT_LOG` overrides both. Memory and WebView2 behaviour are
    // environment-dependent - which runtime version is installed, which
    // Chromium process split the machine gets - so the diagnostics that explain
    // a difference between two machines have to be reachable in the build users
    // actually run, without shipping a build that logs constantly.
    let log_level = match std::env::var("SEARCH_SHORT_LOG").ok().as_deref() {
        Some("trace") => log::LevelFilter::Trace,
        Some("debug") => log::LevelFilter::Debug,
        Some("info") => log::LevelFilter::Info,
        Some("warn") => log::LevelFilter::Warn,
        Some("error") => log::LevelFilter::Error,
        Some(other) => {
            // Ignored rather than fatal: an unparsable value in a user's
            // environment should not stop the app from starting.
            eprintln!("ignoring SEARCH_SHORT_LOG={other:?}; expected trace|debug|info|warn|error");
            default_log_level()
        }
        None => default_log_level(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log_level).build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // Used to copy a reply. The plugin is here rather than
        // `navigator.clipboard`, which needs a secure context and a granted
        // permission - neither of which the webview origin guarantees.
        .plugin(tauri_plugin_clipboard_manager::init())
        // Start with Windows. The app name is set explicitly rather than left to
        // default to the binary name, because it is what the user sees in Task
        // Manager's Startup tab and in the registry - `search-short` would be a
        // worse label there than the product name.
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Search Short")
                .build(),
        )
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

            // State is managed before any webview exists, so the first
            // `get_settings` call from the frontend can never race it. See
            // `window::creation` for why the windows are built here instead of
            // by Tauri's own setup pass.
            let mut settings = store::load(&handle);
            let shortcut = ShortcutState::new(settings.global_shortcut.clone());

            // The stored preference says what the user wants; Windows says
            // whether it currently works. They can disagree - a Task Manager
            // toggle, an uninstall, a settings reset - so they are reconciled
            // before the state is managed, and the result is what the first read
            // already reports.
            let actual_startup = startup::reconcile(&handle, settings.launch_at_login);
            if actual_startup != settings.launch_at_login {
                settings.launch_at_login = actual_startup;
                if let Err(error) = store::save(&handle, &settings) {
                    log::warn!("startup state could not be written back: {}", error.message);
                }
            }

            app.manage(SettingsState::new(settings));
            app.manage(shortcut);

            window::create_startup_windows(app)?;

            let shortcut = app.state::<ShortcutState>();
            if let Err(error) = shortcut.register(&handle) {
                // A shortcut conflict must not stop the app from starting; the
                // tray icon keeps it reachable and the error is surfaced in
                // Settings.
                log::error!("global shortcut unavailable at startup: {}", error.message);
                shortcut.set_error(error);
            }

            if let Err(error) = system::tray::setup(&handle) {
                log::warn!("tray icon unavailable: {}", error.message);
            }

            // The windows are created hidden and only shown by the global
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
            commands::list_bangs,
            commands::get_startup_enabled,
            commands::set_startup_enabled,
            commands::get_shortcut_status,
            commands::capture_shortcut,
            commands::submit_search,
            commands::hide_search_window,
            commands::set_search_expanded,
            commands::open_settings_window,
            commands::hide_settings_window,
            commands::quit_app,
            commands::set_ai_api_key,
            commands::clear_ai_api_key,
            commands::send_chat_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
