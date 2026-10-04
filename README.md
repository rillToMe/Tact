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

## Architecture

Operating-system work stays in Rust; React only renders and captures input.

```
src/                          # React + TypeScript
├── components/               # presentational primitives (icons, controls)
├── features/search/          # the search window
├── features/settings/        # settings window + shortcut recorder
├── hooks/                    # settings + focus/event wiring
├── lib/                      # ipc client, theme, shortcut helpers, design utils
└── types/                    # shared IPC types

src-tauri/src/                # Rust
├── commands/                 # the IPC surface (the only #[tauri::command]s)
├── search/                   # search-engine registry and URL building
├── settings/                 # settings model + persistent store
├── shortcut/                 # global shortcut ownership and lifecycle
├── system/                   # opening URLs, tray icon
└── window/                   # window lifecycle and focus rules
```

Key decisions:

- **One reusable window.** The search window is created once, hidden at
  startup, and reused, so opening it is instant.
- **Rust owns the OS.** Shortcut registration, window control, URL opening, and
  persistence all live on the Rust side and are reached through Tauri commands.
- **Settings live on disk.** Stored via `tauri-plugin-store` in
  `settings.json` under the app data directory, mirrored in memory for fast
  reads.
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

Search suggestions, history, bangs/aliases, browser profiles, plugins, AI
features, accounts, and telemetry are intentionally out of scope. The structure
above is meant to absorb them without a rewrite.

## License

Not yet specified.
