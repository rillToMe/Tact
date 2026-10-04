use std::sync::RwLock;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::error::{AppError, AppResult, Ctx, ErrorCode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    /// Accelerator the app is trying to keep registered.
    pub accelerator: String,
    /// True only while the OS reports the accelerator as registered by us.
    pub active: bool,
    /// True while the settings window is recording a new combination.
    pub suspended: bool,
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, Default)]
struct Inner {
    desired: String,
    /// The accelerator currently held with the OS, if any.
    registered: Option<String>,
    suspended: bool,
    error: Option<AppError>,
}

/// Owns the single global shortcut.
///
/// Invariants this type exists to protect:
/// * at most one shortcut is registered by this app at any time;
/// * `registered` mirrors what the OS actually holds;
/// * a failed change never leaves the app without a working shortcut.
#[derive(Debug, Default)]
pub struct ShortcutState(RwLock<Inner>);

impl ShortcutState {
    pub fn new(accelerator: impl Into<String>) -> Self {
        Self(RwLock::new(Inner {
            desired: accelerator.into(),
            ..Inner::default()
        }))
    }

    pub fn status(&self) -> ShortcutStatus {
        let inner = self.lock();
        ShortcutStatus {
            active: !inner.suspended && inner.registered.as_deref() == Some(inner.desired.as_str()),
            accelerator: inner.desired.clone(),
            suspended: inner.suspended,
            error: inner.error.clone(),
        }
    }

    /// Registers the configured shortcut. Called once during setup.
    pub fn register(&self, app: &AppHandle) -> AppResult<()> {
        let desired = self.lock().desired.clone();
        let shortcut = parse(&desired)?;
        register_shortcut(app, &desired, shortcut)?;
        self.update(|inner| inner.registered = Some(inner.desired.clone()));
        Ok(())
    }

    /// Changes the registered shortcut.
    ///
    /// The new combination is claimed before the old one is released, so a
    /// rejected change leaves the previous shortcut working.
    pub fn apply(&self, app: &AppHandle, accelerator: &str) -> AppResult<()> {
        let accelerator = accelerator.trim();
        if accelerator.is_empty() {
            return Err(AppError::new(
                ErrorCode::ShortcutInvalid,
                "That isn't a valid shortcut combination.",
            ));
        }

        let previous = {
            let inner = self.lock();
            if !inner.suspended && inner.registered.as_deref() == Some(accelerator) {
                return Ok(());
            }
            inner.registered.clone()
        };

        let shortcut = parse(accelerator)?;
        register_shortcut(app, accelerator, shortcut)?;

        if let Some(previous) = previous
            && previous != accelerator
            && let Ok(previous_shortcut) = parse(&previous)
            && let Err(error) = app.global_shortcut().unregister(previous_shortcut)
        {
            log::warn!("previous shortcut {previous:?} could not be released: {error}");
        }

        // Applying a shortcut always ends any recording session.
        self.update(|inner| {
            inner.desired = accelerator.to_string();
            inner.registered = Some(accelerator.to_string());
            inner.error = None;
            inner.suspended = false;
        });

        Ok(())
    }

    /// Releases the shortcut while the settings window records a new one, so
    /// the user can press the current combination without dismissing the
    /// recorder.
    pub fn suspend(&self, app: &AppHandle) -> AppResult<()> {
        let previous = self.lock().registered.clone();
        if let Some(previous) = previous
            && let Ok(shortcut) = parse(&previous)
        {
            app.global_shortcut()
                .unregister(shortcut)
                .ctx("suspend shortcut", "The shortcut could not be suspended.")?;
        }
        self.update(|inner| {
            inner.suspended = true;
            inner.registered = None;
        });
        Ok(())
    }

    /// Restores the configured shortcut after recording finishes. Idempotent,
    /// so it is safe whether or not a new shortcut was applied in the meantime.
    pub fn resume(&self, app: &AppHandle) -> AppResult<()> {
        let desired = {
            let mut inner = self.lock();
            inner.suspended = false;
            inner.desired.clone()
        };

        if desired.is_empty() {
            return Ok(());
        }

        let shortcut = parse(&desired)?;
        register_shortcut(app, &desired, shortcut)?;
        self.update(|inner| inner.registered = Some(desired));
        Ok(())
    }

    /// Records a registration failure so the UI can report it.
    pub fn set_error(&self, error: AppError) {
        self.update(|inner| inner.error = Some(error));
    }

    fn lock(&self) -> std::sync::RwLockWriteGuard<'_, Inner> {
        match self.0.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn update<F: FnOnce(&mut Inner)>(&self, f: F) {
        f(&mut self.lock());
    }
}

fn parse(accelerator: &str) -> AppResult<Shortcut> {
    accelerator.parse::<Shortcut>().map_err(|error| {
        log::error!("invalid accelerator {accelerator:?}: {error}");
        AppError::new(
            ErrorCode::ShortcutInvalid,
            "That isn't a valid shortcut combination.",
        )
    })
}

fn register_shortcut(app: &AppHandle, accelerator: &str, shortcut: Shortcut) -> AppResult<()> {
    let manager = app.global_shortcut();

    // Never double-register: the plugin errors if we already hold the key.
    if manager.is_registered(shortcut) {
        return Ok(());
    }

    manager.register(shortcut).map_err(|error| {
        log::error!("global shortcut {accelerator:?} could not be registered: {error}");
        AppError::new(
            ErrorCode::ShortcutInUse,
            format!(
                "Couldn't register {}. That shortcut may already be in use by another application.",
                crate::shortcut::display_accelerator(accelerator)
            ),
        )
    })
}

/// True when the accelerator is something the OS could actually register.
///
/// Used to validate stored settings before they are handed to the plugin.
pub fn is_valid_accelerator(accelerator: &str) -> bool {
    !accelerator.trim().is_empty() && accelerator.parse::<Shortcut>().is_ok()
}

/// Formats an accelerator for display: `alt+KeyT` becomes `Alt + T`.
pub fn display_accelerator(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|part| match part.trim() {
            "alt" => "Alt".to_string(),
            "ctrl" | "control" => "Ctrl".to_string(),
            "shift" => "Shift".to_string(),
            "super" | "command" | "cmd" => "Super".to_string(),
            "ArrowUp" => "↑".to_string(),
            "ArrowDown" => "↓".to_string(),
            "ArrowLeft" => "←".to_string(),
            "ArrowRight" => "→".to_string(),
            "Space" => "Space".to_string(),
            code => {
                if let Some(letter) = code.strip_prefix("Key") {
                    letter.to_uppercase()
                } else if let Some(digit) = code.strip_prefix("Digit") {
                    digit.to_string()
                } else if let Some(key) = code.strip_prefix("Numpad") {
                    key.to_string()
                } else {
                    code.to_string()
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_accelerator_parses() {
        assert!("alt+KeyT".parse::<Shortcut>().is_ok());
    }

    #[test]
    fn accelerator_requires_a_key() {
        assert!("alt".parse::<Shortcut>().is_err());
        assert!("ctrl+shift".parse::<Shortcut>().is_err());
    }

    #[test]
    fn modifiers_must_come_first() {
        assert!("shift+alt+KeyQ".parse::<Shortcut>().is_ok());
        assert!("shift+KeyQ+alt".parse::<Shortcut>().is_err());
    }

    #[test]
    fn display_formats_the_default() {
        assert_eq!(display_accelerator("alt+KeyT"), "Alt + T");
        assert_eq!(display_accelerator("ctrl+shift+KeyA"), "Ctrl + Shift + A");
        assert_eq!(display_accelerator("shift+Digit1"), "Shift + 1");
    }

    #[test]
    fn status_reports_inactive_until_registered() {
        let state = ShortcutState::new("alt+KeyT");
        let status = state.status();
        assert!(!status.active);
        assert!(!status.suspended);
        assert!(status.error.is_none());
        assert_eq!(status.accelerator, "alt+KeyT");
    }
}
