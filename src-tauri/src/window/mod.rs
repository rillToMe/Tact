pub mod lifecycle;

pub use lifecycle::{
    EVENT_SETTINGS_CHANGED, handle_window_event, hide_search, hide_settings, show_search,
    show_settings, toggle_search,
};
