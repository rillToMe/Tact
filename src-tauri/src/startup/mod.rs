use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult, ErrorCode};

/// True when Windows will actually start the app.
///
/// Note what this does *not* mean. The underlying check is
/// `is_registered() && is_task_manager_enabled()`, so `false` covers two
/// different situations: the app was never registered, or it was registered and
/// the user then switched it off in Task Manager's Startup tab. There is no way
/// to tell them apart through this API, which is why the stored preference
/// exists and is reconciled by `reconcile` below.
pub fn is_enabled(app: &AppHandle) -> AppResult<bool> {
    app.autolaunch().is_enabled().map_err(|error| {
        log::error!("could not read the startup registration: {error}");
        AppError::new(
            ErrorCode::StartupUnavailable,
            "The Windows startup setting could not be read.",
        )
    })
}

/// Registers or removes the app from Windows startup.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> AppResult<()> {
    let manager = app.autolaunch();

    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    result.map_err(|error| {
        log::error!("could not set the startup registration to {enabled}: {error}");
        AppError::new(
            ErrorCode::StartupUnavailable,
            if enabled {
                "The app could not be added to Windows startup."
            } else {
                "The app could not be removed from Windows startup."
            },
        )
    })
}

/// What `reconcile` should do to the Windows registration.
#[derive(Debug, PartialEq, Eq)]
enum Action {
    /// The two already agree; leave the registry alone.
    Keep,
    /// Write the registration so it matches the stored preference.
    Register,
    /// Remove the registration.
    Unregister,
}

/// Decides what to do, given the stored preference and what Windows reports.
///
/// Split out as a pure function so every branch is covered by a test on any
/// machine - the alternative is tests that only run on Windows, only pass when
/// the registry happens to be in a particular state, and leave entries behind
/// when they fail.
fn plan(preference: bool, registered: bool) -> Action {
    match (preference, registered) {
        (true, true) | (false, false) => Action::Keep,
        (true, false) => Action::Register,
        (false, true) => Action::Unregister,
    }
}

/// Brings the stored preference and the real registration back in line.
///
/// The stored preference is the source of truth for *intent*; Windows is the
/// source of truth for whether it currently works. Three cases:
///
/// * **Preference on, Windows on.** Already correct, and re-registering is
///   skipped: `enable()` rewrites the registry value, and doing that on every
///   launch is pointless churn.
/// * **Preference on, Windows off.** Either the user switched it off in Task
///   Manager, or the registration was never made. The two are indistinguishable
///   from here - `is_enabled()` collapses both - so the preference is trusted and
///   the entry is (re)created. That is the recoverable direction: the worst case
///   is an entry the user switches off again, whereas trusting the empty
///   registry would silently undo a setting they turned on and leave them
///   wondering why it kept reverting.
/// * **Preference off, Windows on.** A leftover entry, most likely from a build
///   that was uninstalled or a settings file that was reset. It is removed.
///
/// A failure is logged and the preference returned unchanged, so a broken
/// registry write cannot stop the app from starting.
pub fn reconcile(app: &AppHandle, preference: bool) -> bool {
    let registered = match is_enabled(app) {
        Ok(value) => value,
        Err(error) => {
            log::warn!("startup state could not be read: {}", error.message);
            return preference;
        }
    };

    let action = plan(preference, registered);

    if action == Action::Keep {
        return preference;
    }

    let wanted = action == Action::Register;
    if let Err(error) = set_enabled(app, wanted) {
        log::warn!(
            "startup registration could not be set to {wanted}: {}",
            error.message
        );
        return preference;
    }

    match action {
        Action::Register => {
            log::info!("startup entry was missing; registered it to match the preference");
        }
        Action::Unregister => {
            log::info!("removed a leftover startup entry");
        }
        Action::Keep => unreachable!("handled above"),
    }

    wanted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_matching_state_is_left_alone() {
        // Re-registering on every launch would rewrite the registry value for
        // no reason, and unregistering an already-absent entry is a needless
        // write that can fail.
        assert_eq!(plan(true, true), Action::Keep);
        assert_eq!(plan(false, false), Action::Keep);
    }

    #[test]
    fn a_missing_entry_is_restored_when_the_preference_is_on() {
        // "Never registered" and "switched off in Task Manager" look identical
        // through the API, so the stored preference wins - otherwise a setting
        // the user turned on would silently revert on every launch.
        assert_eq!(plan(true, false), Action::Register);
    }

    #[test]
    fn a_leftover_entry_is_removed_when_the_preference_is_off() {
        // Most likely from an uninstall or a reset settings file.
        assert_eq!(plan(false, true), Action::Unregister);
    }

    #[test]
    fn every_combination_is_decided() {
        // The table is exhaustive; a missing arm would be a silent no-op.
        for preference in [true, false] {
            for registered in [true, false] {
                let action = plan(preference, registered);
                let expected = if preference == registered {
                    Action::Keep
                } else if preference {
                    Action::Register
                } else {
                    Action::Unregister
                };
                assert_eq!(
                    action, expected,
                    "preference={preference} registered={registered}"
                );
            }
        }
    }

    #[test]
    fn a_write_happens_exactly_when_the_two_disagree() {
        // The negation of this would be either a silent no-op or an unnecessary
        // registry write on every launch.
        for preference in [true, false] {
            for registered in [true, false] {
                let writes = plan(preference, registered) != Action::Keep;
                assert_eq!(
                    writes,
                    preference != registered,
                    "preference={preference} registered={registered}"
                );
            }
        }
    }

    #[test]
    fn the_result_of_a_write_always_matches_the_preference() {
        // The invariant the function exists to hold: afterwards, what is stored
        // and what Windows will do are the same thing.
        for preference in [true, false] {
            for registered in [true, false] {
                let resulting_registration = match plan(preference, registered) {
                    Action::Keep => registered,
                    Action::Register => true,
                    Action::Unregister => false,
                };
                assert_eq!(
                    resulting_registration, preference,
                    "preference={preference} registered={registered}"
                );
            }
        }
    }

    #[test]
    fn the_error_code_is_the_documented_one() {
        // The frontend switches on this string, so it is part of the contract
        // rather than an implementation detail.
        let error = AppError::new(ErrorCode::StartupUnavailable, "x");
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["code"], "startupUnavailable");
    }
}
