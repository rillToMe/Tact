use async_openai::Client;
use async_openai::config::OpenAIConfig;
use async_openai::error::OpenAIError;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::ai::model::AiSettings;
use crate::ai::secret;
use crate::error::{AppError, AppResult, ErrorCode};

/// A message in the conversation, as sent by the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// One piece of a streamed reply.
///
/// Serialized as an internally-tagged enum so the frontend can switch on `type`
/// without inspecting the payload's shape.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// A token (or part of one) appended to the reply.
    Delta { text: String },
    /// A token of the model's reasoning, when the provider exposes it.
    ///
    /// Kept separate from `Delta` because the two are shown differently: the
    /// reply is the answer, while reasoning is process the user can watch and
    /// then collapse.
    Reasoning { text: String },
    /// The stream finished successfully.
    Done { reason: Option<String> },
}

/// The chunk shape we deserialize from an OpenAI-compatible SSE stream.
///
/// Every field is optional and unknown fields are ignored on purpose. This is
/// the whole reason `byot` is enabled: providers disagree about which fields
/// they send, and a strict type would reject an otherwise valid stream. A
/// provider that omits `choices`, for example, still streams fine here instead
/// of failing to deserialize mid-response.
#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: Option<StreamDelta>,
    #[serde(default)]
    finish_reason: Option<String>,
}

impl StreamChoice {
    /// The finish reason, or `None` while the stream is still going.
    ///
    /// An empty string has to be treated as "not finished". Several
    /// OpenAI-compatible gateways send `"finish_reason": ""` on *every* chunk
    /// until the last one, rather than the `null` the spec implies. Deserialised
    /// straight into `Option<String>` that becomes `Some("")`, which reads as
    /// "finished" and ends the stream on the very first chunk - the reply is
    /// empty and the user sees the thinking indicator and then nothing.
    fn finish_reason(&self) -> Option<&str> {
        self.finish_reason
            .as_deref()
            .map(str::trim)
            .filter(|reason| !reason.is_empty())
    }

    /// The events this choice produces, in the order they should be sent.
    ///
    /// Extracted from the streaming loop so the exact byte sequence a provider
    /// sends can be replayed in a test - which is how the empty-`finish_reason`
    /// bug was found and is now locked down.
    fn events(&self) -> Vec<ChatEvent> {
        let mut events = Vec::new();

        // Content and reasoning are collected before the finish check, because
        // a provider may put both on the final chunk. Checking first would drop
        // the last token of every reply.
        if let Some(delta) = self.delta.as_ref() {
            // Reasoning first, matching the order the model produces it. A
            // provider that sends neither field simply produces no reasoning.
            if let Some(text) = delta.reasoning_text() {
                events.push(ChatEvent::Reasoning {
                    text: text.to_string(),
                });
            }

            if let Some(text) = delta.content.as_deref().filter(|text| !text.is_empty()) {
                events.push(ChatEvent::Delta {
                    text: text.to_string(),
                });
            }
        }

        if let Some(reason) = self.finish_reason() {
            events.push(ChatEvent::Done {
                reason: Some(reason.to_string()),
            });
        }

        events
    }
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
    /// OpenRouter's field name for streamed reasoning.
    #[serde(default)]
    reasoning: Option<String>,
    /// DeepSeek's field name for the same thing.
    ///
    /// Both are read because the two conventions are equally common among
    /// OpenAI-compatible providers, and a model that exposes its thinking would
    /// otherwise look like it was stalling.
    #[serde(default)]
    reasoning_content: Option<String>,
}

impl StreamDelta {
    /// The reasoning text carried by this delta, if any.
    fn reasoning_text(&self) -> Option<&str> {
        self.reasoning
            .as_deref()
            .or(self.reasoning_content.as_deref())
            .filter(|text| !text.is_empty())
    }
}

/// A streaming request as issued by the frontend.
///
/// The API key is deliberately not part of this struct. It is read from the
/// Windows Credential Manager inside `stream_chat`, so the secret never crosses
/// the IPC boundary and never enters the webview at all.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
}

/// Streams a chat completion, emitting each token through `on_event`.
///
/// Runs on Tauri's async runtime, so the UI thread is never blocked while the
/// response arrives - which is what makes streaming feel live rather than
/// frozen.
pub async fn stream_chat(
    settings: &AiSettings,
    request: ChatRequest,
    on_event: Channel<ChatEvent>,
) -> AppResult<()> {
    if !settings.is_configured() {
        return Err(AppError::new(
            ErrorCode::AiNotConfigured,
            "Add a base URL and a model in Settings, then try again.",
        ));
    }

    // Read the secret here rather than accepting it as an argument, so it
    // exists only for the duration of the request.
    let api_key = secret::load()?.ok_or_else(|| {
        AppError::new(
            ErrorCode::AiKeyMissing,
            "Add your API key in Settings, then try again.",
        )
    })?;

    let config = OpenAIConfig::new()
        .with_api_base(settings.base_url.trim())
        .with_api_key(api_key.trim());

    let client = Client::with_config(config);

    // `byot` takes the request as plain JSON. Building it as a `Value` rather
    // than a typed struct keeps this working for providers that accept extra
    // or differently-typed parameters.
    let body = serde_json::json!({
        "model": settings.model.trim(),
        "stream": true,
        "messages": build_messages(settings, &request.messages),
    });

    let mut stream = client
        .chat()
        .create_stream_byot::<_, StreamChunk>(body)
        .await
        .map_err(describe)?;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(describe)?;

        for choice in chunk.choices {
            for event in choice.events() {
                let finished = matches!(event, ChatEvent::Done { .. });
                if let Err(error) = on_event.send(event) {
                    // The window was closed or reloaded mid-stream. Stop pulling
                    // tokens rather than logging a failure per token.
                    log::debug!("chat stream receiver went away: {error}");
                    return Ok(());
                }
                if finished {
                    return Ok(());
                }
            }
        }
    }

    // The stream ended without an explicit finish_reason, which is legal.
    let _ = on_event.send(ChatEvent::Done { reason: None });
    Ok(())
}

/// Prefixes the system prompt, unless the frontend already sent one.
fn build_messages(settings: &AiSettings, messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    let mut out = Vec::with_capacity(messages.len() + 1);

    let has_system = messages
        .iter()
        .any(|message| message.role.eq_ignore_ascii_case("system"));

    if !has_system && !settings.system_prompt.trim().is_empty() {
        out.push(serde_json::json!({
            "role": "system",
            "content": settings.system_prompt.trim(),
        }));
    }

    out.extend(messages.iter().map(|message| {
        serde_json::json!({
            "role": message.role,
            "content": message.content,
        })
    }));

    out
}

/// Turns a provider error into something the user can act on.
///
/// The distinction that matters in practice is "the request never arrived"
/// versus "the provider rejected it": a wrong base URL, a refused connection
/// and a TLS failure all look like a generic network error otherwise, and the
/// user has no way to tell which part of the configuration is wrong.
fn describe(error: OpenAIError) -> AppError {
    match error {
        OpenAIError::Reqwest(error) => {
            log::error!("chat request failed: {error}");

            let hint = if error.is_connect() {
                "Could not reach the provider. Check the base URL."
            } else if error.is_timeout() {
                "The provider took too long to respond."
            } else {
                "The request to the provider failed."
            };

            AppError::new(ErrorCode::AiRequestFailed, hint)
        }
        OpenAIError::ApiError(error) => {
            // The provider's own message is the useful part ("invalid api key",
            // "model not found"), so it is shown rather than a generic string.
            log::error!(
                "provider rejected the request: {} {}",
                error.status_code,
                error.api_error
            );

            AppError::new(ErrorCode::AiRequestFailed, error.api_error.message)
        }
        other => {
            log::error!("chat stream failed: {other}");
            AppError::new(
                ErrorCode::AiRequestFailed,
                "The reply could not be read. Check the model name in Settings.",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::model::DEFAULT_SYSTEM_PROMPT;

    fn settings_with_prompt(prompt: &str) -> AiSettings {
        AiSettings {
            enabled: true,
            base_url: "https://a.test/v1".into(),
            model: "test-model".into(),
            system_prompt: prompt.into(),
            ..AiSettings::default()
        }
    }

    fn user(content: &str) -> ChatMessage {
        ChatMessage {
            role: "user".into(),
            content: content.into(),
        }
    }

    #[test]
    fn the_system_prompt_is_prepended() {
        let messages = build_messages(&settings_with_prompt("Be terse."), &[user("hi")]);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "Be terse.");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"], "hi");
    }

    #[test]
    fn an_existing_system_message_is_not_duplicated() {
        let messages = build_messages(
            &settings_with_prompt("Be terse."),
            &[
                ChatMessage {
                    role: "system".into(),
                    content: "Already set.".into(),
                },
                user("hi"),
            ],
        );
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["content"], "Already set.");
    }

    #[test]
    fn role_matching_ignores_case() {
        let messages = build_messages(
            &settings_with_prompt("Be terse."),
            &[ChatMessage {
                role: "System".into(),
                content: "Already set.".into(),
            }],
        );
        assert_eq!(messages.len(), 1);
    }

    #[test]
    fn an_empty_system_prompt_sends_nothing_extra() {
        let messages = build_messages(&settings_with_prompt("   "), &[user("hi")]);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
    }

    #[test]
    fn chunks_parse_when_optional_fields_are_missing() {
        // Providers differ in the margins; these are all shapes that appear in
        // the wild and must not abort the stream.
        let minimal: StreamChunk = serde_json::from_str(r#"{}"#).unwrap();
        assert!(minimal.choices.is_empty());

        let no_delta: StreamChunk =
            serde_json::from_str(r#"{"choices":[{"finish_reason":"stop"}]}"#).unwrap();
        assert_eq!(no_delta.choices[0].finish_reason.as_deref(), Some("stop"));

        let no_content: StreamChunk =
            serde_json::from_str(r#"{"choices":[{"delta":{}}]}"#).unwrap();
        assert!(
            no_content.choices[0]
                .delta
                .as_ref()
                .unwrap()
                .content
                .is_none()
        );
    }

    #[test]
    fn chunks_tolerate_unknown_fields() {
        // A strict type would reject the whole chunk and break the reply.
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"id":"x","object":"chat.completion.chunk","created":1,"model":"m",
                "system_fingerprint":"fp","choices":[{"index":0,
                "delta":{"content":"hi","reasoning_content":"thinking"},
                "logprobs":null}]}"#,
        )
        .unwrap();
        assert_eq!(
            chunk.choices[0].delta.as_ref().unwrap().content.as_deref(),
            Some("hi")
        );
    }

    #[test]
    fn a_normal_delta_yields_its_text() {
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(
            chunk.choices[0].delta.as_ref().unwrap().content.as_deref(),
            Some("Hello")
        );
        assert!(chunk.choices[0].finish_reason.is_none());
    }

    #[test]
    fn chat_events_serialize_for_the_frontend() {
        let delta = serde_json::to_value(ChatEvent::Delta { text: "hi".into() }).unwrap();
        assert_eq!(delta["type"], "delta");
        assert_eq!(delta["text"], "hi");

        let done = serde_json::to_value(ChatEvent::Done { reason: None }).unwrap();
        assert_eq!(done["type"], "done");
        assert_eq!(done["reason"], serde_json::Value::Null);
    }

    #[test]
    fn reasoning_events_serialize_for_the_frontend() {
        let value = serde_json::to_value(ChatEvent::Reasoning {
            text: "weighing options".into(),
        })
        .unwrap();
        assert_eq!(value["type"], "reasoning");
        assert_eq!(value["text"], "weighing options");
    }

    #[test]
    fn reasoning_is_read_from_the_openrouter_field() {
        let chunk: StreamChunk =
            serde_json::from_str(r#"{"choices":[{"delta":{"reasoning":"step one"}}]}"#).unwrap();
        assert_eq!(
            chunk.choices[0].delta.as_ref().unwrap().reasoning_text(),
            Some("step one")
        );
    }

    #[test]
    fn reasoning_is_read_from_the_deepseek_field() {
        // Both field names are in common use among OpenAI-compatible providers,
        // so a model exposing its thinking must not look like it stalled.
        let chunk: StreamChunk =
            serde_json::from_str(r#"{"choices":[{"delta":{"reasoning_content":"step one"}}]}"#)
                .unwrap();
        assert_eq!(
            chunk.choices[0].delta.as_ref().unwrap().reasoning_text(),
            Some("step one")
        );
    }

    #[test]
    fn an_empty_reasoning_field_is_not_an_event() {
        // Some providers send the field as an empty string on every chunk of a
        // non-reasoning response; forwarding those would render an empty
        // thinking block.
        for json in [
            r#"{"choices":[{"delta":{"reasoning":""}}]}"#,
            r#"{"choices":[{"delta":{"reasoning_content":""}}]}"#,
            r#"{"choices":[{"delta":{"content":"hi"}}]}"#,
        ] {
            let chunk: StreamChunk = serde_json::from_str(json).unwrap();
            assert_eq!(
                chunk.choices[0].delta.as_ref().unwrap().reasoning_text(),
                None,
                "{json}"
            );
        }
    }

    #[test]
    fn an_empty_finish_reason_does_not_end_the_stream() {
        // Regression: gateways exist that send `"finish_reason": ""` on every
        // chunk until the last one instead of `null`. Deserialised straight into
        // `Option<String>` that is `Some("")`, which reads as "finished" and
        // ended the stream on the very first chunk - the reply came back empty
        // and the user saw the thinking indicator and then nothing at all.
        //
        // This is the exact shape observed from such a gateway.
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"id":"cmb-1","model":"m","object":"chat.completion.chunk","created":1,
                "choices":[{"index":0,"delta":{"role":"assistant","content":"",
                "reasoning_content":"","function_call":null,"refusal":"",
                "extra_fields":null},"logprobs":null,"finish_reason":""}],"usage":null}"#,
        )
        .unwrap();

        assert_eq!(chunk.choices[0].finish_reason(), None);
    }

    #[test]
    fn a_real_finish_reason_is_reported() {
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}"#,
        )
        .unwrap();
        assert_eq!(chunk.choices[0].finish_reason(), Some("stop"));
    }

    #[test]
    fn a_whitespace_finish_reason_is_not_a_finish() {
        // Some gateways pad the field rather than leaving it empty.
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"choices":[{"delta":{"content":"x"},"finish_reason":"   "}]}"#,
        )
        .unwrap();
        assert_eq!(chunk.choices[0].finish_reason(), None);
    }

    #[test]
    fn a_chunk_with_no_delta_at_all_still_reports_its_finish_reason() {
        // A provider may end the stream with a bare finish chunk. The delta must
        // be optional for that to survive deserialisation.
        let chunk: StreamChunk =
            serde_json::from_str(r#"{"choices":[{"finish_reason":"length"}]}"#).unwrap();
        assert!(chunk.choices[0].delta.is_none());
        assert_eq!(chunk.choices[0].finish_reason(), Some("length"));
    }

    #[test]
    fn the_last_chunk_can_carry_both_content_and_a_finish_reason() {
        // The finish check must not run before the content is forwarded, or the
        // final token of every reply would be dropped.
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"choices":[{"delta":{"content":"world","reasoning_content":"done"},
                "finish_reason":"stop"}]}"#,
        )
        .unwrap();

        let delta = chunk.choices[0].delta.as_ref().unwrap();
        assert_eq!(delta.content.as_deref(), Some("world"));
        assert_eq!(delta.reasoning_text(), Some("done"));
        assert_eq!(chunk.choices[0].finish_reason(), Some("stop"));
    }

    #[test]
    fn a_stream_that_only_has_an_empty_finish_reason_never_finishes_early() {
        // The end-to-end shape of the regression: a run of chunks that all carry
        // `""` must produce zero finish reasons, so the loop keeps pulling.
        let mut finishes = 0;
        for _ in 0..5 {
            let chunk: StreamChunk = serde_json::from_str(
                r#"{"choices":[{"delta":{"content":"","reasoning_content":"t"},
                    "finish_reason":""}]}"#,
            )
            .unwrap();
            if chunk.choices[0].finish_reason().is_some() {
                finishes += 1;
            }
        }
        assert_eq!(
            finishes, 0,
            "an empty finish_reason must never end the stream"
        );
    }

    /// Replays a captured SSE body through the same deserialisation and event
    /// extraction the streaming loop uses, stopping where production stops.
    ///
    /// Two framing quirks of these gateways are handled here so a fixture can be
    /// replayed verbatim:
    ///
    /// * `[DONE]` appears **twice**, which the SSE spec does not allow. It is
    ///   skipped rather than treated as an error.
    /// * A trailing `data:` line may be a usage-only chunk with an empty
    ///   `choices` array, which produces no events.
    ///
    /// Stopping at the first `Done` is essential rather than incidental: a
    /// helper that kept draining would still collect the reply tokens and pass
    /// even with the bug present, because the bug is that production never
    /// *reaches* them.
    fn replay_capture(body: &str) -> Vec<ChatEvent> {
        let mut events = Vec::new();

        'capture: for line in body.lines() {
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data.trim().eq_ignore_ascii_case("[DONE]") {
                continue;
            }

            let chunk: StreamChunk = serde_json::from_str(data)
                .unwrap_or_else(|e| panic!("captured chunk should parse: {e}\n{data}"));

            for choice in chunk.choices {
                for event in choice.events() {
                    let finished = matches!(event, ChatEvent::Done { .. });
                    events.push(event);
                    if finished {
                        break 'capture;
                    }
                }
            }
        }

        events
    }

    fn text_of(events: &[ChatEvent], want: fn(&ChatEvent) -> Option<&str>) -> String {
        events.iter().filter_map(want).collect()
    }

    fn delta_text(event: &ChatEvent) -> Option<&str> {
        match event {
            ChatEvent::Delta { text } => Some(text),
            _ => None,
        }
    }

    fn reasoning_text(event: &ChatEvent) -> Option<&str> {
        match event {
            ChatEvent::Reasoning { text } => Some(text),
            _ => None,
        }
    }

    #[test]
    fn the_gateway_that_sends_an_empty_finish_reason_streams_normally() {
        // Captured verbatim from a local OpenAI-compatible gateway, the one that
        // reported no reply at all.
        //
        // This gateway sends `"finish_reason": ""` on every chunk until the
        // last one. The old code read `Some("")` as "finished" and returned on
        // the *first* chunk, so the user saw the thinking indicator and then
        // nothing - the exact symptom.
        //
        // Note both fixtures in this directory come from the *same* gateway.
        // They are two models, not two providers, and the point is that the
        // gateway is not even self-consistent: the finish shape differs per
        // model, so neither can be assumed.
        let body = include_str!("../../tests/fixtures/empty-finish-reason.sse");
        let events = replay_capture(body);

        let reply = text_of(&events, delta_text);
        let thought = text_of(&events, reasoning_text);

        assert!(
            !thought.is_empty(),
            "this model does send reasoning, and it must survive"
        );
        assert!(
            !reply.is_empty(),
            "the reply must not be empty - this is the reported bug. \
             Got reasoning={thought:?}"
        );
        assert!(reply.contains("hello"), "got reply {reply:?}");
        assert!(
            matches!(events.last(), Some(ChatEvent::Done { .. })),
            "the stream must end on the real finish chunk"
        );
    }

    #[test]
    fn the_gateway_that_sends_a_null_finish_reason_streams_normally() {
        // Also captured from the same gateway, but a *different* model on the
        // same endpoint, which nevertheless uses the spec-correct `null` until
        // the last chunk.
        //
        // It never hit the empty-string bug. It is kept as a fixture because the
        // two together are the two profiles an OpenAI-compatible gateway can
        // have, and because this one proves the fix did not regress the
        // spec-correct path.
        let body = include_str!("../../tests/fixtures/null-finish-reason.sse");
        let events = replay_capture(body);

        let reply = text_of(&events, delta_text);
        let thought = text_of(&events, reasoning_text);

        assert!(
            !thought.is_empty(),
            "this model streams `reasoning_content` too, so the thought line \
             must have something to show. Got reasoning={thought:?}"
        );
        assert!(!reply.is_empty(), "the reply must not be empty");
        assert!(reply.contains("hello"), "got reply {reply:?}");
    }

    #[test]
    fn both_captured_profiles_agree_on_the_essentials() {
        // The point of keeping both captures: they must be handled by the same
        // code path without a per-model branch. If a future change makes one
        // work by special-casing it, this test still passes - but the two above
        // would not, which is the signal to stop and reconsider.
        for (name, body) in [
            (
                "empty finish_reason",
                include_str!("../../tests/fixtures/empty-finish-reason.sse"),
            ),
            (
                "null finish_reason",
                include_str!("../../tests/fixtures/null-finish-reason.sse"),
            ),
        ] {
            let events = replay_capture(body);
            assert!(!events.is_empty(), "{name}: produced no events at all");
            assert!(
                !text_of(&events, delta_text).is_empty(),
                "{name}: produced no reply text"
            );
            assert!(
                !text_of(&events, reasoning_text).is_empty(),
                "{name}: produced no reasoning text"
            );
            assert!(
                matches!(events.last(), Some(ChatEvent::Done { .. })),
                "{name}: did not end with a finish event"
            );
        }
    }

    #[test]
    fn reasoning_and_content_can_arrive_together() {
        // The two are independent: a provider may interleave them, and both
        // must survive.
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"choices":[{"delta":{"reasoning":"thinking","content":"answer"}}]}"#,
        )
        .unwrap();
        let delta = chunk.choices[0].delta.as_ref().unwrap();
        assert_eq!(delta.reasoning_text(), Some("thinking"));
        assert_eq!(delta.content.as_deref(), Some("answer"));
    }

    #[test]
    fn the_default_prompt_asks_for_markdown() {
        // The frontend renders replies as Markdown, so the default prompt must
        // ask for it - otherwise the renderer is there but unused.
        assert!(
            DEFAULT_SYSTEM_PROMPT.contains("Markdown"),
            "the default prompt should ask for Markdown"
        );
    }
}
