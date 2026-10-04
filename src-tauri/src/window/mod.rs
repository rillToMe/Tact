pub mod creation;
pub mod lifecycle;

pub use creation::create_windows;
pub use lifecycle::{
    EVENT_SETTINGS_CHANGED, handle_window_event, hide_search, hide_settings, set_search_expanded,
    show_search, show_settings, toggle_search,
};
