use serde::{Deserialize, Deserializer, Serialize};

use crate::ai::model::AiSettings;
use crate::search::engine;

pub const SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_GLOBAL_SHORTCUT: &str = "alt+KeyT";
pub const DEFAULT_SEARCH_ENGINE: &str = "google";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// Deserializes the theme leniently: an unrecognized value falls back to
/// `System` instead of rejecting the whole settings file.
impl<'de> Deserialize<'de> for Theme {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.trim().to_ascii_lowercase().as_str() {
            "light" => Theme::Light,
            "dark" => Theme::Dark,
            "system" => Theme::System,
            other => {
                log::warn!("unknown theme {other:?}; falling back to system");
                Theme::System
            }
        })
    }
}

/// Persistent user settings.
///
/// The struct-level `#[serde(default)]` means a missing, partial, or
/// hand-edited settings file still loads instead of failing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub global_shortcut: String,
    pub search_engine: String,
    pub theme: Theme,
    /// Reserved for the next iteration (Start with Windows). It is stored now
    /// so enabling it later needs no migration, and no UI pretends it works.
    pub launch_at_login: bool,
    /// AI chat. Disabled by default, and its API key is not stored here.
    pub ai: AiSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            global_shortcut: DEFAULT_GLOBAL_SHORTCUT.into(),
            search_engine: DEFAULT_SEARCH_ENGINE.into(),
            theme: Theme::default(),
            launch_at_login: false,
            ai: AiSettings::default(),
        }
    }
}

impl Settings {
    /// Repairs anything a user or a hand-edited file could get wrong, so the
    /// rest of the app can assume valid values.
    pub fn normalized(mut self) -> Self {
        self.schema_version = SCHEMA_VERSION;

        self.global_shortcut = self.global_shortcut.trim().to_string();
        if !crate::shortcut::is_valid_accelerator(&self.global_shortcut) {
            log::warn!(
                "shortcut {:?} is not usable; falling back to {DEFAULT_GLOBAL_SHORTCUT}",
                self.global_shortcut
            );
            self.global_shortcut = DEFAULT_GLOBAL_SHORTCUT.into();
        }

        self.search_engine = self.search_engine.trim().to_ascii_lowercase();
        if engine::find(&self.search_engine).is_none() {
            log::warn!(
                "unknown search engine {:?}; falling back to {DEFAULT_SEARCH_ENGINE}",
                self.search_engine
            );
            self.search_engine = DEFAULT_SEARCH_ENGINE.into();
        }

        self.ai = self.ai.normalized();

        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(json: &str) -> Settings {
        serde_json::from_str::<Settings>(json).unwrap().normalized()
    }

    #[test]
    fn defaults_match_the_product_spec() {
        let settings = Settings::default();
        assert_eq!(settings.global_shortcut, "alt+KeyT");
        assert_eq!(settings.search_engine, "google");
        assert_eq!(settings.theme, Theme::System);
        assert!(!settings.launch_at_login);
    }

    #[test]
    fn empty_object_uses_defaults() {
        assert_eq!(from_json("{}"), Settings::default());
    }

    #[test]
    fn unknown_engine_falls_back() {
        assert_eq!(
            from_json(r#"{"searchEngine":"nope"}"#).search_engine,
            "google"
        );
    }

    #[test]
    fn engine_id_is_normalized() {
        assert_eq!(
            from_json(r#"{"searchEngine":"  GOOGLE "}"#).search_engine,
            "google"
        );
    }

    #[test]
    fn unusable_shortcut_falls_back() {
        for bad in ["", "   ", "not-a-real-key", "alt", "ctrl+shift"] {
            let json = format!(r#"{{"globalShortcut":"{bad}"}}"#);
            assert_eq!(
                from_json(&json).global_shortcut,
                DEFAULT_GLOBAL_SHORTCUT,
                "shortcut {bad:?} should be repaired"
            );
        }
    }

    #[test]
    fn usable_shortcut_is_kept() {
        let settings = from_json(r#"{"globalShortcut":"ctrl+shift+KeyK"}"#);
        assert_eq!(settings.global_shortcut, "ctrl+shift+KeyK");
    }

    #[test]
    fn unknown_theme_does_not_discard_other_fields() {
        // One bad field must not reset the whole configuration.
        let settings =
            from_json(r#"{"theme":"neon","globalShortcut":"ctrl+KeyJ","searchEngine":"google"}"#);
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.global_shortcut, "ctrl+KeyJ");
        assert_eq!(settings.search_engine, "google");
    }

    #[test]
    fn themes_round_trip() {
        for (json, expected) in [
            ("system", Theme::System),
            ("light", Theme::Light),
            ("dark", Theme::Dark),
            ("DARK", Theme::Dark),
        ] {
            let parsed = from_json(&format!(r#"{{"theme":"{json}"}}"#)).theme;
            assert_eq!(parsed, expected, "theme {json:?}");
        }
    }

    #[test]
    fn partial_settings_keep_other_defaults() {
        let settings = from_json(r#"{"theme":"dark"}"#);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.global_shortcut, DEFAULT_GLOBAL_SHORTCUT);
        assert_eq!(settings.search_engine, DEFAULT_SEARCH_ENGINE);
    }

    #[test]
    fn serialized_shape_matches_the_frontend_contract() {
        let value = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["globalShortcut"], "alt+KeyT");
        assert_eq!(value["searchEngine"], "google");
        assert_eq!(value["theme"], "system");
        assert_eq!(value["launchAtLogin"], false);
        assert_eq!(value["ai"]["enabled"], false);
        assert_eq!(value["ai"]["modeKey"], "Tab");
    }

    #[test]
    fn a_settings_file_without_the_ai_block_still_loads() {
        // Every field is sent back on save, so a file written by a build that
        // predates AI must deserialize into a disabled AI block rather than
        // failing and resetting the user's other preferences.
        let settings = from_json(r#"{"theme":"dark","searchEngine":"bing"}"#);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.search_engine, "bing");
        assert!(!settings.ai.enabled);
        assert_eq!(settings.ai.mode_key, "Tab");
    }

    #[test]
    fn ai_settings_are_normalized_with_the_rest() {
        let settings = from_json(
            r#"{"ai":{"enabled":true,"baseUrl":"https://a.test/v1/","model":" gpt-4o ","modeKey":"Enter"}}"#,
        );
        assert!(settings.ai.enabled);
        assert_eq!(settings.ai.base_url, "https://a.test/v1");
        assert_eq!(settings.ai.model, "gpt-4o");
        // A key that cannot toggle must be repaired even when it arrives nested.
        assert_eq!(settings.ai.mode_key, "Tab");
    }
}
