use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;

use crate::error::{AppError, AppResult, ErrorCode};

pub const QUERY_PLACEHOLDER: &str = "{query}";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEngine {
    pub id: &'static str,
    pub name: &'static str,
    /// `{query}` is replaced with the percent-encoded query string.
    pub search_url: &'static str,
    /// File name of the icon under `public/icons-search-engine/`.
    pub icon: &'static str,
}

/// The engine registry.
///
/// Adding an engine is a one-line change here: the frontend reads this list
/// over IPC and renders whatever it is given, so no UI code needs to know about
/// individual engines.
pub const ENGINES: &[SearchEngine] = &[
    SearchEngine {
        id: "google",
        name: "Google",
        search_url: "https://www.google.com/search?q={query}",
        icon: "google.png",
    },
    SearchEngine {
        id: "bing",
        name: "Bing",
        search_url: "https://www.bing.com/search?q={query}",
        icon: "bing.png",
    },
    SearchEngine {
        id: "duckduckgo",
        name: "DuckDuckGo",
        search_url: "https://duckduckgo.com/?q={query}",
        icon: "duckduckgo.png",
    },
    SearchEngine {
        id: "yahoo",
        name: "Yahoo",
        search_url: "https://search.yahoo.com/search?p={query}",
        icon: "yahoo.png",
    },
    SearchEngine {
        id: "yandex",
        name: "Yandex",
        search_url: "https://yandex.com/search/?text={query}",
        icon: "yandex.png",
    },
];

pub fn all() -> &'static [SearchEngine] {
    ENGINES
}

pub fn find(id: &str) -> Option<&'static SearchEngine> {
    ENGINES.iter().find(|engine| engine.id == id)
}

pub fn default_engine() -> &'static SearchEngine {
    ENGINES
        .first()
        .expect("at least one search engine must be registered")
}

pub fn resolve(id: &str) -> &'static SearchEngine {
    find(id).unwrap_or_else(default_engine)
}

/// Everything except RFC 3986 unreserved characters is escaped. A space
/// becomes `%20` (not `+`) so it matches the product specification.
const QUERY_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

pub fn build_search_url(engine: &SearchEngine, query: &str) -> AppResult<String> {
    let query = query.trim();
    if query.is_empty() {
        return Err(AppError::new(
            ErrorCode::EmptyQuery,
            "Type something to search for.",
        ));
    }

    if !engine.search_url.contains(QUERY_PLACEHOLDER) {
        log::error!(
            "search url for {} is missing the {{query}} placeholder",
            engine.id
        );
        return Err(AppError::new(
            ErrorCode::Internal,
            "The search engine is not configured correctly.",
        ));
    }

    let encoded = utf8_percent_encode(query, QUERY_ENCODE_SET).to_string();
    Ok(engine.search_url.replace(QUERY_PLACEHOLDER, &encoded))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn google(query: &str) -> String {
        build_search_url(default_engine(), query).unwrap()
    }

    #[test]
    fn spaces_encode_as_percent_twenty() {
        assert_eq!(
            google("rust ownership"),
            "https://www.google.com/search?q=rust%20ownership"
        );
    }

    #[test]
    fn reserved_characters_are_encoded() {
        assert_eq!(
            google("c++ & rust"),
            "https://www.google.com/search?q=c%2B%2B%20%26%20rust"
        );
    }

    #[test]
    fn query_that_looks_like_a_url_is_not_injectable() {
        // `&`, `?`, and `#` must not be able to add parameters or a fragment.
        let url = google("a&b=c?d#e");
        assert_eq!(url, "https://www.google.com/search?q=a%26b%3Dc%3Fd%23e");
        assert_eq!(url.matches('?').count(), 1);
        assert!(!url.contains('#'));
    }

    #[test]
    fn unicode_is_percent_encoded() {
        assert_eq!(
            google("café ☕"),
            "https://www.google.com/search?q=caf%C3%A9%20%E2%98%95"
        );
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        assert_eq!(google("  rust  "), "https://www.google.com/search?q=rust");
    }

    #[test]
    fn unreserved_characters_are_left_alone() {
        assert_eq!(
            google("a-b_c.d~e"),
            "https://www.google.com/search?q=a-b_c.d~e"
        );
    }

    #[test]
    fn empty_query_is_rejected() {
        assert!(matches!(
            build_search_url(default_engine(), "   ").unwrap_err().code,
            ErrorCode::EmptyQuery
        ));
    }

    #[test]
    fn every_registered_engine_builds_a_url() {
        for engine in all() {
            let url = build_search_url(engine, "test query").unwrap();
            assert!(url.starts_with("https://"), "{url}");
            assert!(!url.contains(QUERY_PLACEHOLDER), "{url}");
        }
    }

    #[test]
    fn unknown_engine_falls_back_to_the_default() {
        assert_eq!(resolve("does-not-exist").id, default_engine().id);
    }

    #[test]
    fn engine_ids_and_names_are_unique() {
        let mut ids: Vec<&str> = all().iter().map(|e| e.id).collect();
        ids.sort_unstable();
        let unique = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), unique, "duplicate engine id");

        let mut names: Vec<&str> = all().iter().map(|e| e.name).collect();
        names.sort_unstable();
        let unique = names.len();
        names.dedup();
        assert_eq!(names.len(), unique, "duplicate engine name");
    }

    #[test]
    fn engine_ids_are_storable_as_settings() {
        // The id is persisted and matched after lowercasing and trimming, so it
        // must already be lowercase and free of whitespace.
        for engine in all() {
            assert_eq!(engine.id, engine.id.trim());
            assert_eq!(engine.id, engine.id.to_ascii_lowercase(), "{}", engine.id);
            assert!(!engine.id.is_empty());
        }
    }

    #[test]
    fn every_engine_icon_exists_on_disk() {
        // A missing icon renders as a broken image in the settings picker, and
        // nothing else would catch it.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../public/icons-search-engine");

        for engine in all() {
            let path = dir.join(engine.icon);
            assert!(
                path.is_file(),
                "icon {} for engine {} is missing at {}",
                engine.icon,
                engine.id,
                path.display()
            );
        }
    }

    #[test]
    fn the_default_engine_is_google() {
        assert_eq!(default_engine().id, "google");
    }
}
