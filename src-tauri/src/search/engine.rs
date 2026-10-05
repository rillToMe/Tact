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

/// A `!bang` shortcut that sends the query straight to one site.
///
/// Separate from `SearchEngine` because the two are different things: an engine
/// is the default that a plain query goes to and is chosen in Settings, while a
/// bang is typed per query and is never a default. Merging them would mean a
/// Settings dropdown listing `!yt`, which is not a choice anyone wants to make.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bang {
    /// What the user types after `!`, without the `!`. Lowercase, no spaces.
    pub keyword: &'static str,
    pub name: &'static str,
    /// `{query}` is replaced with the percent-encoded query string.
    ///
    /// May be empty for a bang whose site has no search endpoint, in which case
    /// the query is ignored and the home page opens.
    pub search_url: &'static str,
    /// Where a bare bang with no argument goes.
    ///
    /// Explicit rather than derived by stripping the query string off
    /// `search_url`: that produces `https://github.com/search`, an empty search
    /// page, when what a bare `!gh` should open is the site itself.
    pub home_url: &'static str,
    /// File name of the icon under `public/icons-search-engine/`.
    pub icon: &'static str,
}

/// The bang registry.
///
/// A bang is matched only when it is the *first* token of the query, so a query
/// that merely mentions "yt" later is left alone. Keywords are short because
/// they are typed by hand every time.
pub const BANGS: &[Bang] = &[
    Bang {
        keyword: "yt",
        name: "YouTube",
        search_url: "https://www.youtube.com/results?search_query={query}",
        home_url: "https://www.youtube.com",
        icon: "youtube.png",
    },
    Bang {
        keyword: "gh",
        name: "GitHub",
        search_url: "https://github.com/search?q={query}",
        home_url: "https://github.com",
        icon: "github.png",
    },
    Bang {
        keyword: "w",
        name: "Wikipedia",
        search_url: "https://en.wikipedia.org/w/index.php?search={query}",
        home_url: "https://en.wikipedia.org",
        icon: "wikipedia.png",
    },
    Bang {
        keyword: "so",
        name: "Stack Overflow",
        search_url: "https://stackoverflow.com/search?q={query}",
        home_url: "https://stackoverflow.com",
        icon: "stackoverflow.png",
    },
    Bang {
        keyword: "npm",
        name: "npm",
        search_url: "https://www.npmjs.com/search?q={query}",
        home_url: "https://www.npmjs.com",
        icon: "npm.png",
    },
];

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

pub fn all_bangs() -> &'static [Bang] {
    BANGS
}

pub fn find_bang(keyword: &str) -> Option<&'static Bang> {
    let keyword = keyword.to_ascii_lowercase();
    BANGS.iter().find(|bang| bang.keyword == keyword)
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

/// A query split into an optional bang and the text to search for.
#[derive(Debug, PartialEq, Eq)]
pub struct ParsedQuery<'a> {
    /// The bang that was typed, if it matched a registered one.
    pub bang: Option<&'static Bang>,
    /// The remaining text, trimmed.
    pub query: &'a str,
}

/// Splits a leading `!bang` off a query.
///
/// A bang is only recognised as the **first** token, which is what makes it safe
/// to use such short keywords: `how to yt` is an ordinary search, and only
/// `!yt how to` is a bang. Anything else would make it impossible to search for
/// the word itself.
///
/// An unrecognised bang is *not* stripped. `!foo bar` is left whole and searched
/// normally, because silently dropping text the user typed is worse than a
/// search that returns nothing useful - and it tells them the bang does not
/// exist.
pub fn parse_query(raw: &str) -> ParsedQuery<'_> {
    let trimmed = raw.trim();

    let Some(rest) = trimmed.strip_prefix('!') else {
        return ParsedQuery {
            bang: None,
            query: trimmed,
        };
    };

    // The keyword ends at the first space; a bang with no argument ("!yt") is
    // allowed and opens the site's home page.
    let (keyword, remainder) = match rest.split_once(char::is_whitespace) {
        Some((keyword, remainder)) => (keyword, remainder.trim()),
        None => (rest, ""),
    };

    match find_bang(keyword) {
        Some(bang) => ParsedQuery {
            bang: Some(bang),
            query: remainder,
        },
        // Unknown keyword: keep the original text so nothing is lost.
        None => ParsedQuery {
            bang: None,
            query: trimmed,
        },
    }
}

pub fn build_search_url(engine: &SearchEngine, query: &str) -> AppResult<String> {
    build_url(engine.id, engine.search_url, query)
}

/// Builds the URL for a bang.
///
/// A bang with no argument opens the site itself, which is what makes a bare
/// `!gh` a shortcut rather than an error.
pub fn build_bang_url(bang: &Bang, query: &str) -> AppResult<String> {
    if query.trim().is_empty() {
        return Ok(bang.home_url.to_string());
    }
    build_url(bang.keyword, bang.search_url, query)
}

fn build_url(label: &str, template: &str, query: &str) -> AppResult<String> {
    let query = query.trim();
    if query.is_empty() {
        return Err(AppError::new(
            ErrorCode::EmptyQuery,
            "Type something to search for.",
        ));
    }

    if !template.contains(QUERY_PLACEHOLDER) {
        log::error!("search url for {label} is missing the {{query}} placeholder");
        return Err(AppError::new(
            ErrorCode::Internal,
            "The search engine is not configured correctly.",
        ));
    }

    let encoded = utf8_percent_encode(query, QUERY_ENCODE_SET).to_string();
    Ok(template.replace(QUERY_PLACEHOLDER, &encoded))
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
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/icons-search-engine");

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
    fn engine_icons_are_not_absurdly_large() {
        // Icons render at ~17px. A multi-megapixel source decodes to tens of
        // megabytes of RGBA and costs that on every launch for no visible gain.
        //
        // This checks pixel dimensions rather than file size: compression can
        // make a huge image look small on disk (a 3840x3840 WebP here was only
        // 51 KB while decoding to ~56 MB), so bytes are the wrong proxy.
        const MAX_DIMENSION: u32 = 512;

        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/icons-search-engine");

        for engine in all() {
            let path = dir.join(engine.icon);
            let (width, height) = png_dimensions(&path)
                .unwrap_or_else(|e| panic!("cannot read dimensions of {}: {e}", path.display()));

            assert!(
                width <= MAX_DIMENSION && height <= MAX_DIMENSION,
                "icon {} is {width}x{height}; it renders at ~17px, so normalise it \
                 to at most {MAX_DIMENSION}px on its longest side",
                engine.icon
            );
        }
    }

    /// Reads width and height from a PNG's IHDR chunk.
    fn png_dimensions(path: &std::path::Path) -> Result<(u32, u32), String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;

        // 8-byte signature, then the IHDR chunk: 4-byte length, "IHDR",
        // 4-byte width, 4-byte height.
        if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
            return Err("not a PNG".to_string());
        }
        if &bytes[12..16] != b"IHDR" {
            return Err("missing IHDR".to_string());
        }

        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        Ok((width, height))
    }

    #[test]
    fn the_default_engine_is_google() {
        assert_eq!(default_engine().id, "google");
    }

    #[test]
    fn a_leading_bang_selects_its_site() {
        let parsed = parse_query("!yt rust ownership");
        assert_eq!(parsed.bang.map(|b| b.keyword), Some("yt"));
        assert_eq!(parsed.query, "rust ownership");

        let url = build_bang_url(parsed.bang.unwrap(), parsed.query).unwrap();
        assert_eq!(
            url,
            "https://www.youtube.com/results?search_query=rust%20ownership"
        );
    }

    #[test]
    fn a_bang_is_only_matched_as_the_first_token() {
        // The whole reason the keywords can be one letter: `w` in the middle of
        // a sentence must stay an ordinary word.
        for query in ["how to yt a video", "rust ownership w", "see !yt later"] {
            let parsed = parse_query(query);
            assert!(parsed.bang.is_none(), "{query:?} should not be a bang");
            assert_eq!(parsed.query, query.trim());
        }
    }

    #[test]
    fn a_bang_may_have_no_argument() {
        // A bare `!gh` is a shortcut to the site, not an error.
        let parsed = parse_query("!gh");
        assert_eq!(parsed.bang.map(|b| b.keyword), Some("gh"));
        assert_eq!(parsed.query, "");

        let url = build_bang_url(parsed.bang.unwrap(), parsed.query).unwrap();
        assert_eq!(url, "https://github.com");
    }

    #[test]
    fn a_bare_bang_opens_the_site_not_an_empty_search() {
        // Stripping the query string off `search_url` would give
        // `https://github.com/search` - an empty search page, which is not what
        // someone typing `!gh` meant. Hence the explicit `home_url`.
        for bang in all_bangs() {
            let url = build_bang_url(bang, "   ").unwrap();
            assert_eq!(
                url, bang.home_url,
                "!{} should open its home page",
                bang.keyword
            );
            assert!(!url.contains("/search"), "{}: {url}", bang.keyword);
            assert!(!url.contains("?"), "{}: {url}", bang.keyword);
        }
    }

    #[test]
    fn an_unknown_bang_is_left_in_the_query() {
        // Dropping text the user typed would be worse than a bad search: it
        // would silently change what they asked for. Leaving it whole also tells
        // them the bang does not exist.
        let parsed = parse_query("!nope some words");
        assert!(parsed.bang.is_none());
        assert_eq!(parsed.query, "!nope some words");
    }

    #[test]
    fn bang_keywords_are_matched_case_insensitively() {
        for query in ["!YT rust", "!Yt rust", "!yt rust"] {
            let parsed = parse_query(query);
            assert_eq!(
                parsed.bang.map(|b| b.keyword),
                Some("yt"),
                "{query:?} should match"
            );
            assert_eq!(parsed.query, "rust");
        }
    }

    #[test]
    fn a_lone_exclamation_is_not_a_bang() {
        // "!" alone, or "! " with nothing after, must not be swallowed.
        for query in ["!", "! ", "!  "] {
            let parsed = parse_query(query);
            assert!(parsed.bang.is_none(), "{query:?} should not be a bang");
        }
    }

    #[test]
    fn whitespace_around_a_bang_is_trimmed() {
        let parsed = parse_query("   !yt    rust ownership   ");
        assert_eq!(parsed.bang.map(|b| b.keyword), Some("yt"));
        assert_eq!(parsed.query, "rust ownership");
    }

    #[test]
    fn a_bang_query_is_percent_encoded() {
        // The same escaping as an engine query: a bang must not be a way to
        // inject extra parameters.
        let parsed = parse_query("!yt a&b=c?d#e");
        let url = build_bang_url(parsed.bang.unwrap(), parsed.query).unwrap();
        assert_eq!(
            url,
            "https://www.youtube.com/results?search_query=a%26b%3Dc%3Fd%23e"
        );
        assert_eq!(url.matches('?').count(), 1);
        assert!(!url.contains('#'));
    }

    #[test]
    fn every_bang_builds_a_url_for_a_query() {
        for bang in all_bangs() {
            let url = build_bang_url(bang, "test query").unwrap();
            assert!(url.starts_with("https://"), "{}: {url}", bang.keyword);
            assert!(!url.contains(QUERY_PLACEHOLDER), "{}", bang.keyword);
        }
    }

    #[test]
    fn every_bang_has_a_home_page() {
        // A bare bang has no query to encode, so it falls back to `home_url`.
        // That must be a usable absolute URL on its own.
        for bang in all_bangs() {
            let url = build_bang_url(bang, "   ").unwrap();
            assert!(url.starts_with("https://"), "{}: {url}", bang.keyword);
            assert!(!url.contains('?'), "{}: {url}", bang.keyword);
            assert!(!url.ends_with('/'), "{}: {url}", bang.keyword);
        }
    }

    #[test]
    fn bang_keywords_are_unique_and_typed_friendly() {
        let mut keywords: Vec<&str> = all_bangs().iter().map(|b| b.keyword).collect();
        let unique = keywords.len();
        keywords.sort_unstable();
        keywords.dedup();
        assert_eq!(keywords.len(), unique, "duplicate bang keyword");

        for bang in all_bangs() {
            assert!(!bang.keyword.is_empty());
            assert_eq!(
                bang.keyword,
                bang.keyword.to_ascii_lowercase(),
                "{} must be lowercase to match",
                bang.keyword
            );
            assert!(
                !bang.keyword.contains(char::is_whitespace),
                "{} must not contain whitespace",
                bang.keyword
            );
            // A `!` inside the keyword would make it untypeable, since the
            // leading one is the marker.
            assert!(!bang.keyword.contains('!'), "{}", bang.keyword);
        }
    }

    #[test]
    fn every_bang_icon_exists_on_disk() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/icons-search-engine");

        for bang in all_bangs() {
            let path = dir.join(bang.icon);
            assert!(
                path.is_file(),
                "icon {} for bang !{} is missing at {}",
                bang.icon,
                bang.keyword,
                path.display()
            );
        }
    }

    #[test]
    fn every_bang_icon_is_a_sane_size() {
        const MAX_DIMENSION: u32 = 512;
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/icons-search-engine");

        for bang in all_bangs() {
            let path = dir.join(bang.icon);
            let (width, height) = png_dimensions(&path)
                .unwrap_or_else(|e| panic!("cannot read dimensions of {}: {e}", path.display()));
            assert!(
                width <= MAX_DIMENSION && height <= MAX_DIMENSION,
                "icon {} is {width}x{height}; normalise it to at most {MAX_DIMENSION}px",
                bang.icon
            );
        }
    }

    #[test]
    fn a_bang_keyword_does_not_shadow_an_engine_id() {
        // Not a hard requirement, but a bang named `google` would be confusing
        // next to the Google engine.
        for bang in all_bangs() {
            assert!(
                find(bang.keyword).is_none(),
                "bang !{} collides with an engine id",
                bang.keyword
            );
        }
    }
}
