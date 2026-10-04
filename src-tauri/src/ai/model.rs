use serde::{Deserialize, Serialize};

/// The key that switches the search bar into AI mode.
///
/// Unlike the global shortcut this is *not* registered with the OS: it is a
/// plain key handled inside the search window. That is what lets a bare `Tab`
/// be the default, where the global shortcut parser would demand a modifier.
///
/// It is still stored as an accelerator (`Tab`, `ctrl+KeyK`) so a modifier can
/// be used when the chosen key would otherwise be untypeable - see
/// `is_valid_mode_key`.
pub const DEFAULT_MODE_KEY: &str = "Tab";

pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a helpful assistant. Answer concisely, and use Markdown for formatting \
     - code blocks, lists, tables, and emphasis - since replies are rendered as Markdown.";

/// Codes that cannot become the AI mode toggle.
///
/// Modifier-only keys are here because pressing one alone never completes a
/// keypress. `Enter` and `Escape` are here because they are already bound in the
/// search window - Enter submits, Escape dismisses - so binding them as the mode
/// key would make the surface impossible to use.
const RESERVED_MODE_CODES: &[&str] = &[
    "AltLeft",
    "AltRight",
    "ControlLeft",
    "ControlRight",
    "ShiftLeft",
    "ShiftRight",
    "MetaLeft",
    "MetaRight",
    "CapsLock",
    "NumLock",
    "ScrollLock",
    "ContextMenu",
    "Enter",
    "NumpadEnter",
    "Escape",
];

/// Modifiers the mode key accepts, matching the global shortcut vocabulary.
const MODE_KEY_MODIFIERS: &[&str] = &["ctrl", "control", "alt", "shift", "super", "command", "cmd"];

/// AI chat configuration.
///
/// The API key is deliberately absent: it lives in the Windows Credential
/// Manager (see `ai::secret`) and never reaches this struct, the settings file,
/// or the frontend.
///
/// The struct-level `#[serde(default)]` means an older settings file - written
/// before this feature existed - still loads, with AI simply disabled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    /// Off by default. Nothing is sent anywhere until the user turns this on.
    pub enabled: bool,
    /// Base URL of an OpenAI-compatible endpoint, without `/chat/completions`.
    pub base_url: String,
    pub model: String,
    pub system_prompt: String,
    /// Accelerator that toggles AI mode inside the search window.
    ///
    /// Stored in the same format as the global shortcut (`Tab`, `ctrl+KeyK`) so
    /// the same parser and formatter apply, even though it is never registered
    /// with the OS.
    pub mode_key: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            model: String::new(),
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
            mode_key: DEFAULT_MODE_KEY.to_string(),
        }
    }
}

impl AiSettings {
    /// Repairs anything a user or a hand-edited file could get wrong.
    pub fn normalized(mut self) -> Self {
        self.base_url = normalize_base_url(&self.base_url);
        self.model = self.model.trim().to_string();

        self.system_prompt = self.system_prompt.trim().to_string();
        if self.system_prompt.is_empty() {
            self.system_prompt = DEFAULT_SYSTEM_PROMPT.to_string();
        }

        if !is_valid_mode_key(&self.mode_key) {
            log::warn!(
                "mode key {:?} is not usable; falling back to {DEFAULT_MODE_KEY}",
                self.mode_key
            );
            self.mode_key = DEFAULT_MODE_KEY.to_string();
        }

        self
    }

    /// True when enough is configured to attempt a request at all.
    ///
    /// The API key is checked separately because it is not stored here.
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty() && !self.model.trim().is_empty()
    }
}

/// Canonicalises a base URL typed by the user.
///
/// Two things are repaired, both because they are easy to get wrong and fail in
/// ways that do not explain themselves:
///
/// * A trailing slash would produce `//chat/completions`, since the client
///   concatenates the base with the path directly.
/// * Providers document their endpoint as a full URL, so users paste
///   `https://host/v1/chat/completions`. Stripping the known suffix makes that
///   paste behave identically to the base URL.
pub fn normalize_base_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut base = trimmed.trim_end_matches('/');
    if let Some(stripped) = base.strip_suffix("/chat/completions") {
        base = stripped.trim_end_matches('/');
    }

    if base.is_empty() {
        return String::new();
    }

    // A missing scheme is a common paste error and would otherwise surface as an
    // opaque connection failure, so assume https.
    if base.contains("://") {
        base.to_string()
    } else {
        format!("https://{base}")
    }
}

/// True when the accelerator can serve as the in-window AI mode toggle.
///
/// Unlike a global shortcut this does **not** require a modifier: `Tab` is the
/// default and must pass. A modifier is still allowed, because a bare letter
/// would make the search bar unusable for typing that letter - the user is free
/// to pick `ctrl+KeyK` instead.
///
/// Only validation lives here. Matching a keydown event against the stored value
/// happens in the frontend, where the event is: see `modeKeyMatches` in
/// `src/lib/shortcut.ts`, which mirrors these rules.
pub fn is_valid_mode_key(accelerator: &str) -> bool {
    let Some(code) = mode_key_code(accelerator) else {
        return false;
    };
    !RESERVED_MODE_CODES.contains(&code)
}

/// Splits an accelerator into its final key code, validating the whole shape.
///
/// Returns `None` for anything malformed: an empty string, a bare modifier, a
/// modifier appearing after the key, or an unknown modifier token.
fn mode_key_code(accelerator: &str) -> Option<&str> {
    let trimmed = accelerator.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parts: Vec<&str> = trimmed.split('+').map(str::trim).collect();

    // The final part is the key itself; everything before it must be a modifier.
    let (code, modifiers) = parts.split_last()?;

    if code.is_empty() || MODE_KEY_MODIFIERS.contains(&code.to_ascii_lowercase().as_str()) {
        return None;
    }

    for modifier in modifiers {
        let modifier = modifier.to_ascii_lowercase();
        if !MODE_KEY_MODIFIERS.contains(&modifier.as_str()) {
            return None;
        }
    }

    Some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(json: &str) -> AiSettings {
        serde_json::from_str::<AiSettings>(json)
            .unwrap()
            .normalized()
    }

    #[test]
    fn ai_is_disabled_by_default() {
        let settings = AiSettings::default();
        assert!(!settings.enabled, "AI must be opt-in");
        assert_eq!(settings.mode_key, "Tab");
        assert_eq!(settings.base_url, "");
        assert!(!settings.is_configured());
    }

    #[test]
    fn empty_object_uses_defaults() {
        assert_eq!(from_json("{}"), AiSettings::default());
    }

    #[test]
    fn settings_written_before_ai_existed_still_load() {
        // A file from an older build has no `ai` key at all. The frontend sends
        // the whole settings object back on every save, so a missing block must
        // deserialize rather than fail.
        let settings = from_json("{}");
        assert!(!settings.enabled);
        assert_eq!(settings.mode_key, DEFAULT_MODE_KEY);
    }

    #[test]
    fn trailing_slash_is_removed() {
        // The client concatenates base + "/chat/completions" directly, so a
        // trailing slash would produce a double slash in the request path.
        assert_eq!(
            normalize_base_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1"
        );
    }

    #[test]
    fn a_pasted_endpoint_is_reduced_to_its_base() {
        assert_eq!(
            normalize_base_url("https://openrouter.ai/api/v1/chat/completions"),
            "https://openrouter.ai/api/v1"
        );
        assert_eq!(
            normalize_base_url("https://openrouter.ai/api/v1/chat/completions/"),
            "https://openrouter.ai/api/v1"
        );
    }

    #[test]
    fn a_missing_scheme_defaults_to_https() {
        assert_eq!(
            normalize_base_url("openrouter.ai/api/v1"),
            "https://openrouter.ai/api/v1"
        );
    }

    #[test]
    fn local_provider_urls_are_left_intact() {
        // Ollama and LM Studio are plain http on localhost; forcing https would
        // break them, so an explicit scheme always wins.
        assert_eq!(
            normalize_base_url("http://localhost:11434/v1"),
            "http://localhost:11434/v1"
        );
        assert_eq!(
            normalize_base_url("http://127.0.0.1:1234/v1/"),
            "http://127.0.0.1:1234/v1"
        );
    }

    #[test]
    fn whitespace_and_empty_input_are_handled() {
        assert_eq!(normalize_base_url("   "), "");
        assert_eq!(normalize_base_url(""), "");
        assert_eq!(
            normalize_base_url("  https://a.test/v1  "),
            "https://a.test/v1"
        );
    }

    #[test]
    fn unusable_mode_keys_fall_back() {
        // Modifier-only keys never complete a keypress, and Enter/Escape are
        // already bound in the search window. Malformed strings are rejected
        // too, so a hand-edited file cannot store nonsense.
        for bad in [
            "",
            "   ",
            "AltLeft",
            "ControlRight",
            "Enter",
            "Escape",
            "NumpadEnter",
            "alt",
            "ctrl+shift",
            "shift+KeyQ+alt",
            "hyper+KeyQ",
        ] {
            let json = format!(r#"{{"modeKey":"{bad}"}}"#);
            assert_eq!(
                from_json(&json).mode_key,
                DEFAULT_MODE_KEY,
                "mode key {bad:?} should be repaired"
            );
        }
    }

    #[test]
    fn bare_keys_are_valid_mode_keys() {
        // The point of this setting is that a bare key works, which the global
        // shortcut validator would reject.
        for good in ["Tab", "KeyA", "Slash", "Backquote", "F1"] {
            let json = format!(r#"{{"modeKey":"{good}"}}"#);
            assert_eq!(from_json(&json).mode_key, good, "mode key {good:?}");
        }
    }

    #[test]
    fn a_modified_mode_key_is_valid() {
        // A bare letter would make the search bar unusable for typing it, so
        // allowing a modifier is what makes letters usable at all.
        assert!(is_valid_mode_key("ctrl+KeyK"));
        assert!(is_valid_mode_key("alt+KeyA"));
        assert!(is_valid_mode_key("shift+Space"));
        assert!(is_valid_mode_key("control+KeyK"));
        assert!(is_valid_mode_key("cmd+KeyK"));
        assert!(is_valid_mode_key("super+KeyK"));

        assert_eq!(
            from_json(r#"{"modeKey":"ctrl+KeyK"}"#).mode_key,
            "ctrl+KeyK"
        );
    }

    #[test]
    fn a_malformed_mode_key_is_rejected() {
        // Anything a hand-edited file could contain must be refused, so the
        // stored value is always something the frontend can match against.
        for bad in [
            "ctrl",
            "ctrl+",
            "+KeyK",
            "hyper+KeyK",
            "KeyK+alt",
            "ctrl++KeyK",
        ] {
            assert!(
                !is_valid_mode_key(bad),
                "mode key {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn a_modifier_key_cannot_be_the_mode_key() {
        for bad in [
            "AltLeft",
            "ControlRight",
            "ShiftLeft",
            "MetaRight",
            "CapsLock",
        ] {
            assert!(
                !is_valid_mode_key(bad),
                "mode key {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn the_keys_the_search_window_already_uses_are_rejected() {
        // Enter submits and Escape dismisses, so binding either would leave the
        // surface unusable - in both bare and modified form.
        assert!(!is_valid_mode_key("Enter"));
        assert!(!is_valid_mode_key("Escape"));
        assert!(!is_valid_mode_key("ctrl+Enter"));
        assert!(!is_valid_mode_key("ctrl+Escape"));
    }
    #[test]
    fn an_empty_system_prompt_is_replaced() {
        assert_eq!(
            from_json(r#"{"systemPrompt":"   "}"#).system_prompt,
            DEFAULT_SYSTEM_PROMPT
        );
    }

    #[test]
    fn a_custom_system_prompt_is_kept() {
        assert_eq!(
            from_json(r#"{"systemPrompt":"Reply only in Indonesian."}"#).system_prompt,
            "Reply only in Indonesian."
        );
    }

    #[test]
    fn configuration_requires_a_base_url_and_a_model() {
        let complete = AiSettings {
            enabled: true,
            base_url: "https://a.test/v1".into(),
            model: "gpt-4o".into(),
            ..AiSettings::default()
        };
        assert!(complete.is_configured());

        let no_model = AiSettings {
            model: String::new(),
            ..complete.clone()
        };
        assert!(!no_model.is_configured());

        let no_url = AiSettings {
            base_url: String::new(),
            ..complete
        };
        assert!(!no_url.is_configured());
    }

    #[test]
    fn serialized_shape_matches_the_frontend_contract() {
        let value = serde_json::to_value(AiSettings::default()).unwrap();
        assert_eq!(value["enabled"], false);
        assert_eq!(value["baseUrl"], "");
        assert_eq!(value["model"], "");
        assert_eq!(value["modeKey"], "Tab");
        assert!(value["systemPrompt"].is_string());
        // The key must never appear in the payload sent to the frontend.
        assert!(value.get("apiKey").is_none());
    }
}
