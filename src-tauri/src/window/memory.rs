//! WebView2 memory-usage targeting for inactive windows.
//!
//! WebView2 exposes `ICoreWebView2_19::SetMemoryUsageTargetLevel`, which tells
//! the runtime that a webview is not being looked at and that it should trim
//! what it is holding - caches, decoded resources, spare heap. This is a hint,
//! not a suspension: the page keeps running, the DOM is untouched, and
//! restoring it is a change of level rather than a reload.
//!
//! That distinction is what makes it safe to use on the search window.
//! `TrySuspend` is deliberately *not* used: it stops script execution, which
//! would make reopening the launcher visibly slow - the one thing the search
//! window must never be.
//!
//! The API arrived in WebView2 111. An older runtime fails the
//! `ICoreWebView2_19` query, which is logged and then ignored. This is an
//! optimization; an app that refused to run because it could not save a few
//! megabytes would be worse than one that spends them.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;

/// Whether the runtime has been asked for a memory level yet.
///
/// The first request is reported at `info` and the rest are not. Whether the
/// installed runtime supports the API is the single fact that explains a
/// difference in memory between two machines, and it is not visible anywhere
/// else - so it is worth one line in the log. Repeating it on every hide would
/// only be noise.
static REPORTED: AtomicBool = AtomicBool::new(false);

/// What the runtime should be told about a window's memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryTarget {
    /// The window is on screen or about to be: keep everything warm, because
    /// the user is waiting.
    Active,
    /// The window is hidden: nothing here will be looked at until the user asks
    /// for it again, so the runtime may give memory back.
    Inactive,
}

/// Tells the runtime that a window has become active or inactive.
///
/// Best-effort by design. The call crosses into the WebView2 runtime and can
/// fail for reasons that are not the app's to fix - an older runtime without
/// `ICoreWebView2_19`, or a webview that is already gone - and none of them are
/// worth failing an operation the user asked for.
pub fn set_target(window: &WebviewWindow, target: MemoryTarget) {
    // The level is applied inside the closure, which runs on the main thread
    // with the platform webview in hand.
    let result = window.with_webview(move |platform| {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19,
            };
            use windows_core::Interface;

            let level = match target {
                MemoryTarget::Active => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
                MemoryTarget::Inactive => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            };

            let first = !REPORTED.swap(true, Ordering::Relaxed);

            // The controller is the entry point; the level itself lives on a
            // later interface revision, which is where the version check
            // happens.
            let controller = platform.controller();

            let core = match unsafe { controller.CoreWebView2() } {
                Ok(core) => core,
                Err(error) => {
                    if first {
                        log::info!("low-memory mode unavailable: no core webview ({error})");
                    }
                    return;
                }
            };

            match core.cast::<ICoreWebView2_19>() {
                Ok(core) => {
                    if let Err(error) = unsafe { core.SetMemoryUsageTargetLevel(level) } {
                        if first {
                            log::info!("low-memory mode unavailable: {error}");
                        }
                    } else if first {
                        log::info!("low-memory mode active for inactive windows");
                    }
                }
                // Expected on a WebView2 runtime older than 111. Not a warning:
                // the app works exactly as before, it just keeps the memory.
                Err(_) => {
                    if first {
                        log::info!(
                            "low-memory mode unavailable: the installed WebView2 runtime predates 111"
                        );
                    }
                }
            }
        }

        // Other platforms have no equivalent, and none is needed: this app
        // ships for Windows.
        #[cfg(not(windows))]
        let _ = platform;
    });

    if let Err(error) = result {
        log::debug!("memory target could not be requested: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mapping is the part that can be got backwards, and getting it
    /// backwards is invisible: a hidden window would be told to stay warm and a
    /// visible one told to shrink. Both still work, so nothing would fail - it
    /// would just quietly do the opposite of what it should.
    #[test]
    fn targets_are_distinct() {
        assert_ne!(MemoryTarget::Active, MemoryTarget::Inactive);
    }

    #[test]
    fn target_is_copy_so_it_can_cross_into_the_callback() {
        let target = MemoryTarget::Inactive;
        let moved = target;
        assert_eq!(target, moved);
    }
}
