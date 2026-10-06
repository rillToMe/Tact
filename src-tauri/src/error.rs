use serde::Serialize;

/// Machine-readable error codes shared with the frontend.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    ShortcutInvalid,
    ShortcutInUse,
    OpenUrlFailed,
    WindowUnavailable,
    EmptyQuery,
    Internal,
    /// AI is switched on but the base URL or model is still empty.
    AiNotConfigured,
    /// No API key has been stored for the AI provider.
    AiKeyMissing,
    /// The Windows Credential Manager could not be read or written.
    AiKeyUnavailable,
    /// The provider was reached but refused, or could not be reached at all.
    AiRequestFailed,
    /// The Windows startup registration could not be read or changed.
    StartupUnavailable,
}

/// The only error shape that ever crosses the IPC boundary.
///
/// Technical detail is logged on the Rust side so users only ever see the
/// `message` field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

/// Logs the technical detail and converts any error into a user-facing error.
pub trait Ctx<T> {
    fn ctx(self, context: &str, user_message: &str) -> AppResult<T>;
}

impl<T, E: std::fmt::Display> Ctx<T> for Result<T, E> {
    fn ctx(self, context: &str, user_message: &str) -> AppResult<T> {
        self.map_err(|error| {
            log::error!("{context}: {error}");
            AppError::new(ErrorCode::Internal, user_message.to_string())
        })
    }
}
