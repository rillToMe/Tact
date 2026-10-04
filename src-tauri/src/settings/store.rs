use std::sync::{Arc, RwLock};

use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::model::Settings;
use crate::error::{AppResult, Ctx};

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";

fn open_store<R: Runtime>(app: &AppHandle<R>) -> AppResult<Arc<tauri_plugin_store::Store<R>>> {
    app.store(STORE_FILE)
        .ctx("open settings store", "Settings could not be opened.")
}

/// Loads settings from disk.
///
/// A missing file, a missing key, or malformed JSON all resolve to defaults so
/// a broken configuration can never prevent the app from starting.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    let store = match open_store(app) {
        Ok(store) => store,
        Err(error) => {
            log::warn!("using default settings; the store could not be opened: {error}");
            return Settings::default();
        }
    };

    match store.get(SETTINGS_KEY) {
        None | Some(Value::Null) => {
            log::info!("no stored settings found; using defaults");
            Settings::default()
        }
        Some(value) => match serde_json::from_value::<Settings>(value) {
            Ok(settings) => {
                let normalized = settings.normalized();
                // Persist the repaired values so the file stops carrying
                // unusable entries that would otherwise be re-repaired on every
                // launch.
                if let Err(error) = save(app, &normalized) {
                    log::warn!(
                        "repaired settings could not be written back: {}",
                        error.message
                    );
                }
                normalized
            }
            Err(error) => {
                log::warn!("stored settings are malformed ({error}); using defaults");
                Settings::default()
            }
        },
    }
}

/// Persists settings to disk.
pub fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> AppResult<()> {
    let store = open_store(app)?;
    let value =
        serde_json::to_value(settings).ctx("serialize settings", "Settings could not be saved.")?;
    store.set(SETTINGS_KEY, value);
    store
        .save()
        .ctx("write settings to disk", "Settings could not be saved.")?;
    Ok(())
}

/// In-memory mirror of the persisted settings.
#[derive(Default)]
pub struct SettingsState(RwLock<Settings>);

impl SettingsState {
    pub fn new(settings: Settings) -> Self {
        Self(RwLock::new(settings))
    }

    pub fn snapshot(&self) -> Settings {
        match self.0.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub fn replace(&self, settings: Settings) {
        let mut guard = match self.0.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = settings;
    }
}
