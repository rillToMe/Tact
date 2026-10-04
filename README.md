# Search Short

A keyboard-first desktop launcher for web search. Press a global shortcut from
anywhere, type a query, and it opens in your default browser.

```
Alt + T  →  search window appears  →  type  →  Enter  →  browser opens  →  window hides
```

No browser window to find first, no tabs to manage, no dashboards.

## Requirements

- Windows
- [Bun](https://bun.sh/) (package manager used by this repository)
- [Rust](https://rustup.rs/) 1.90+ and the MSVC toolchain
- WebView2 runtime (preinstalled on Windows 11 and current Windows 10)

## Getting started

```sh
bun install
bun run tauri dev
```

The search window starts hidden in every build. To open it while developing,
press `Alt + T`, or use the tray icon's **Search** item.

## Build

```sh
bun run tauri build
```

Produces a standalone executable plus MSI and NSIS installers under
`src-tauri/target/release/bundle/`.

## Checks

```sh
bun run build          # type-check + frontend production build
bun run lint           # ESLint
cargo test   --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo fmt    --manifest-path src-tauri/Cargo.toml -- --check
```

## Using the app

| Action | Result |
| --- | --- |
| `Alt + T` (default) | Show the search window; press again while it is focused to dismiss |
| Type + `Enter` | Open the query in your default browser and hide the window |
| `Tab` (default, AI on) | Switch the search bar into AI mode |
| `Esc` | Hide the window (the app keeps running) |
| `Ctrl + ,` | Open Settings |
| Tray icon → Search / Settings / Quit | Same actions, always available |

Settings are saved automatically. Quitting is explicit: closing a window hides
it, so the shortcut keeps working in the background.

### Settings

- **Global shortcut** — click the recorder and press a combination. The
  shortcut is released while recording so you can reuse the current one.
- **Search engine** — Google, Bing, DuckDuckGo, Yahoo, or Yandex. The picker
  shows each engine's logo, and the active engine's logo appears in the search
  window. Adding another engine is one entry in the registry (see below).
- **Theme** — System, Light, or Dark.
- **AI chat** — its own settings page. Off by default.

## AI chat

Off by default. Nothing is sent anywhere until you turn it on and configure a
provider.

There is no bundled provider and no default endpoint: point the app at any
OpenAI-compatible API with your own base URL, model, and key. That covers OpenAI
itself, OpenRouter, Groq, DeepSeek, Together, and local servers such as Ollama
and LM Studio.

To use it:

1. Settings → **AI chat** → enable the toggle.
2. Fill in **Base URL** (`https://openrouter.ai/api/v1`), **Model**, and paste an
   **API key**.
3. In the search window, press the **AI mode key** (`Tab` by default) to switch
   modes, type your question, and press `Enter`.

The base URL is normalised on save: a trailing slash is removed, and a pasted
`.../chat/completions` endpoint is reduced to its base, because the client
appends the path itself. A URL without a scheme is assumed to be `https`, while
an explicit `http://localhost` is left alone for local servers.

Replies stream in token by token, and the window grows downward into a panel
while a conversation is on screen. The conversation survives hiding the window;
**Clear** resets it.

### Markdown and reasoning

Replies are rendered as Markdown, and the default system prompt asks the model
to use it. The rendering is safe by construction: `react-markdown` builds a
React element tree instead of assigning HTML, so a reply cannot inject markup.
`rehype-raw` is deliberately not enabled, since it would reintroduce exactly
that risk.

Code blocks are syntax-highlighted by `rehype-highlight`, using its `common`
language set — about 37 languages, which covers essentially everything a model
emits. The token colours are defined per theme in `src/index.css` as `--syn-*`
tokens rather than imported from a highlight.js stylesheet, because a stock theme
ships its own background and padding that would fight the panel, and its colours
are picked for a standalone editor rather than for text at 11.5px.

The rest of the Markdown is coloured too, each for a reason: headings carry the
accent with a hairline rule so a long answer is scannable, `strong` uses a
warmer ink than links so emphasis does not compete with them, list markers and
blockquote rules take the accent, and strikethrough is dimmed because it means
the model retracted something.

When the provider exposes the model's reasoning (OpenRouter's `reasoning`,
DeepSeek's `reasoning_content`), it streams into a **thought line** above the
reply. While the model works, the trace is expanded as a list of steps — the
step being written pulses at full contrast, the finished ones are ticked and
dimmed — with a live timer. When the reply starts, the line collapses to a single
"Thought for 2.4s" row that you can click to re-expand. Providers that do not
expose reasoning simply show nothing extra.

The steps are the model's own sentences, split on its own punctuation
(`splitReasoningSteps` in `src/features/search/reasoningSteps.ts`). They are a
*view* of the trace, not invented structure: naming them ("Searching your
notes") would be fiction, and a wrong name is worse than no name. Fragments
shorter than 24 characters are merged into the next step, because a model that
writes "Hmm. Let me think." would otherwise produce a list flickering through
two-character entries. Splitting is a split and one pass, measured at ~0.013ms
for a 60-sentence trace, so it can run on every frame.

Tokens are rendered once per animation frame rather than once per token. Each
render re-parses the whole reply as Markdown, and a fast local model can emit
hundreds of tokens a second — coalescing to a frame is imperceptible and keeps
the work bounded. Syntax highlighting a 40-line block measured at ~2.4ms, about
15% of a 60fps frame, so the frame-coalescing is what keeps that off the critical
path.

### Scrolling during generation

The transcript follows the reply as it grows, but only while you are already at
the bottom — scroll up and it stays where you put it, with a jump-to-latest
button appearing in the corner. The same rule applies to a reasoning trace that
outgrows its fold.

This is worth stating because the obvious implementation is wrong: an
unconditional `scrollTop = scrollHeight` on every content change makes the view
*impossible* to scroll during streaming. Content arrives every frame, so each
attempt to move up is overwritten on the next one — the view does not merely
snap back, it actively fights you. The rule lives in `src/lib/scroll.ts` as a
pure `isAtBottom`, and the hook is `useStickToBottom`.

### Where the API key lives

In the **Windows Credential Manager**, never in `settings.json` — that file is
plain text and a key is a billable credential. The key is also never sent back to
the interface: Settings only ever learns *whether* a key is stored, so there is
nothing to read out of the webview. Any text typed into the field replaces the
stored key.

To remove it: Settings → AI chat → the **×** button next to the key field, or
delete the `Search Short` entry in Windows Credential Manager directly.

### OpenAI-compatible does not mean identical

Gateways differ in the margins, and two of those differences are load-bearing
here. Both are covered by tests that replay real captured streams from
`src-tauri/tests/fixtures/` — and notably, both captures come from the *same*
gateway, just two different models, which is why neither shape can be assumed.

**`finish_reason` is not always `null`.** The spec implies `null` until the last
chunk. Some gateways send `"finish_reason": ""` on *every* chunk instead.
Deserialised straight into `Option<String>` that is `Some("")`, which reads as
"finished" — and the stream ends on the first chunk, so the reply comes back
empty and you see the thinking indicator and then nothing. An empty (or
whitespace-only) reason is treated as "not finished".

**Reasoning arrives under two field names.** `reasoning` (OpenRouter) and
`reasoning_content` (DeepSeek, and the gateways above). Both are read; a provider
that exposes neither simply shows no thought line.

A third quirk is tolerated rather than worked around: these gateways send
`data: [DONE]` **twice**, which the SSE spec does not allow. The client stops at
the first one, so the second is never read.

### Changing the AI mode key

The mode key is recorded like the global shortcut, but it does **not** need a
modifier — it is only observed inside the search window, never registered with
the OS. `Tab` is the default.

A modifier is still allowed, and is what makes a letter usable: binding a bare
`K` would leave you unable to type that letter in the search bar. The toggle only
fires while the input is empty, so a bound key never interferes with typing.

## Architecture

Operating-system work stays in Rust; React only renders and captures input.

```
src/                          # React + TypeScript
├── components/               # presentational primitives (icons, controls)
├── features/search/          # the search window and AI conversation
├── features/settings/        # settings window, shortcut recorder, AI page
├── hooks/                    # settings, AI chat, focus/event wiring
├── lib/                      # ipc client, theme, shortcut helpers, design utils
└── types/                    # shared IPC types

src-tauri/src/                # Rust
├── ai/                       # AI settings, streaming chat client, key storage
├── commands/                 # the IPC surface (the only #[tauri::command]s)
├── search/                   # search-engine registry and URL building
├── settings/                 # settings model + persistent store
├── shortcut/                 # global shortcut ownership and lifecycle
├── system/                   # opening URLs, tray icon
└── window/                   # window lifecycle and focus rules
```

Key decisions:

- **One reusable window.** The search window is created once, hidden at
  startup, and reused, so opening it is instant. It resizes in place between the
  search bar and the AI panel rather than spawning a second window.
- **Rust owns the OS.** Shortcut registration, window control, URL opening, and
  persistence all live on the Rust side and are reached through Tauri commands.
- **Settings live on disk.** Stored via `tauri-plugin-store` in
  `settings.json` under the app data directory, mirrored in memory for fast
  reads. Secrets are the exception and live in the OS credential store.
- **Errors are user-facing.** Commands return `{ code, message }`; technical
  detail is logged, never shown in the UI.

### Adding a search engine

The engine list is data, not code. Add one entry to `ENGINES` in
`src-tauri/src/search/engine.rs`:

```rust
SearchEngine {
    id: "brave",
    name: "Brave",
    search_url: "https://search.brave.com/search?q={query}",
    icon: "brave.png",
},
```

Then drop the icon in `public/icons-search-engine/`. Nothing else changes: the
frontend reads the list over IPC and renders whatever it is given.

Two tests fail the build if an icon is wrong: one if the file is missing, one if
it is oversized. Keep sources small — the icons render at 17px, and a 3840x3840
source decodes to ~56 MB of RGBA for something that size.

### Security notes

- The query is percent-encoded before it is substituted into the search URL, so
  it cannot inject extra parameters or a fragment.
- URLs are handed to the OS through `tauri-plugin-opener`. There is no embedded
  browser, no iframe, and no remote content in the app itself.
- The AI API key is stored in the Windows Credential Manager and is never
  returned to the frontend, so it cannot be read out of the webview.
- AI replies are rendered with `react-markdown`, which builds a React element
  tree rather than assigning HTML. Raw HTML in a reply is shown as text, and
  `rehype-raw` is not enabled, so a model cannot inject markup into the app.

## Behavior details

- **Blur handling.** The search window hides when it loses focus, but a blur is
  only trusted after the window has actually held focus and the desktop has
  settled — activating a window emits transient focus events that would
  otherwise dismiss it immediately.
- **Shortcut conflicts.** If a combination is already owned by another
  application, registration fails, the previous shortcut stays active, and the
  error is shown in Settings. The app never silently pretends it registered.
- **Broken configuration.** Missing, partial, or malformed settings fall back to
  defaults field by field; the repaired values are written back. One bad value
  cannot reset the rest of your configuration.

## Not in this foundation

Search suggestions, history, bangs/aliases, browser profiles, plugins, accounts,
and telemetry are intentionally out of scope. The structure above is meant to
absorb them without a rewrite.

AI chat is deliberately narrow for now: one conversation, no persistence, and
no per-provider presets. The provider is whatever OpenAI-compatible endpoint you
point it at.

## License

Not yet specified.
