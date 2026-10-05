import type { Bang } from "../types";

/** A query split into an optional bang and the text to search for. */
export interface ParsedQuery {
  /** The bang that was typed, if it matched a registered one. */
  bang: Bang | null;
  /** The remaining text, trimmed. */
  query: string;
}

/**
 * Splits a leading `!bang` off a query.
 *
 * Mirrors `parse_query` in `src-tauri/src/search/engine.rs`, which is the
 * authority: the Rust side re-parses and builds the URL, so a disagreement here
 * only affects what the search bar previews, never where the query goes.
 *
 * The rules, and why:
 *
 * * Only the **first** token is matched, which is what makes one-letter keywords
 *   safe - `how to yt` stays an ordinary search.
 * * An unrecognised bang is *not* stripped. Silently dropping text the user
 *   typed would change what they asked for; leaving it whole also shows them the
 *   bang does not exist.
 */
export function parseQuery(raw: string, bangs: Bang[]): ParsedQuery {
  const trimmed = raw.trim();

  if (!trimmed.startsWith("!")) {
    return { bang: null, query: trimmed };
  }

  const rest = trimmed.slice(1);
  const match = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);

  if (!match) {
    return { bang: null, query: trimmed };
  }

  const [, keyword, remainder = ""] = match;
  const bang = bangs.find((b) => b.keyword === keyword.toLowerCase()) ?? null;

  if (!bang) {
    // Keep the original text so nothing is lost.
    return { bang: null, query: trimmed };
  }

  return { bang, query: remainder.trim() };
}
