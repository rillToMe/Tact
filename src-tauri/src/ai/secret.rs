use keyring::Entry;

use crate::error::{AppError, AppResult, ErrorCode};

/// Service name under which the API key is filed in the Windows Credential
/// Manager. It is what the user sees in the Credential Manager UI, so it uses
/// the product name rather than the bundle identifier.
const SERVICE: &str = "Search Short";
const ACCOUNT: &str = "ai-api-key";

fn entry() -> AppResult<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(|error| {
        log::error!("credential store is unavailable: {error}");
        AppError::new(
            ErrorCode::AiKeyUnavailable,
            "The Windows Credential Manager could not be reached.",
        )
    })
}

/// Stores the API key in the Windows Credential Manager.
///
/// The key is never written to `settings.json`: that file is plain text, and an
/// API key is a billable credential. The OS store encrypts it per user account.
pub fn store(api_key: &str) -> AppResult<()> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(AppError::new(
            ErrorCode::AiKeyMissing,
            "Enter an API key first.",
        ));
    }

    entry()?.set_password(api_key).map_err(|error| {
        log::error!("API key could not be stored: {error}");
        AppError::new(
            ErrorCode::AiKeyUnavailable,
            "The API key could not be saved to the Windows Credential Manager.",
        )
    })
}

/// Reads the stored API key.
///
/// Returns `Ok(None)` when nothing has been stored yet, which is an ordinary
/// state rather than a failure: the user simply has not configured AI.
pub fn load() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => {
            log::error!("API key could not be read: {error}");
            Err(AppError::new(
                ErrorCode::AiKeyUnavailable,
                "The stored API key could not be read.",
            ))
        }
    }
}

/// Removes the stored API key. Succeeds when there was nothing to remove.
pub fn clear() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => {
            log::error!("API key could not be deleted: {error}");
            Err(AppError::new(
                ErrorCode::AiKeyUnavailable,
                "The stored API key could not be removed.",
            ))
        }
    }
}

/// True when a key is present, without reading it into a `String`.
///
/// Used to report "configured or not" to the settings UI. The key itself is
/// never sent to the frontend - not even masked - so it cannot be exfiltrated
/// through the webview.
pub fn is_set() -> bool {
    matches!(load(), Ok(Some(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_key_is_rejected_before_touching_the_store() {
        // Guarding here keeps the credential store free of empty entries, which
        // would otherwise read back as "configured" while being useless.
        for empty in ["", "   ", "\t"] {
            let error = store(empty).unwrap_err();
            assert_eq!(error.code, ErrorCode::AiKeyMissing);
        }
    }

    #[test]
    fn the_service_name_is_the_product_name() {
        // This string is visible in the Windows Credential Manager UI, so it is
        // part of the user-facing surface, not an implementation detail.
        assert_eq!(SERVICE, "Search Short");
    }
}
