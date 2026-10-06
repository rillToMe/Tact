import { lazy } from "react";

/**
 * The AI conversation renderer, loaded on demand.
 *
 * Everything the AI transcript needs - `react-markdown`, `remark-gfm`,
 * `rehype-highlight`, and through that the whole of highlight.js - is reached
 * from `AiConversation` and nothing else. Measured against the production
 * bundle, that subtree is 288 KB of the 609 KB that used to be shipped and
 * parsed by *both* windows at startup: highlight.js alone is 160 KB, or 26% of
 * the entire bundle.
 *
 * The search bar - which is what this app is, and what almost every launch
 * uses - needs none of it. AI is off by default, so the common case was paying
 * to parse a syntax highlighter it would never call.
 *
 * Splitting it out means the launcher starts on the search UI alone, and the
 * renderer arrives the first time a conversation is actually shown. `preload`
 * exists so that first arrival does not have to be the moment the user is
 * waiting for it.
 */
export const AiConversationLazy = lazy(() =>
  import("./AiConversation").then((module) => ({ default: module.AiConversation })),
);

/**
 * Starts fetching the AI renderer without rendering it.
 *
 * Called when the search window opens and AI is enabled. That is a real signal
 * of intent - the user has turned the feature on and is now looking at the bar
 * - but it is still one step short of switching modes, so the fetch overlaps
 * the time they spend typing the first question rather than adding to it.
 *
 * Deliberately not called at startup. A hidden window with AI enabled is still
 * not about to render a transcript, and loading 288 KB for it would put the
 * cost straight back where this change removed it.
 *
 * Safe to call repeatedly: the module registry caches the import, so repeat
 * calls resolve against the already-loaded module. A failure is swallowed
 * because the lazy component will make the same request when it renders, and
 * report it through Suspense then.
 */
export function preloadAiConversation(): void {
  void import("./AiConversation").catch(() => {
    // Intentionally ignored: see above.
  });
}
