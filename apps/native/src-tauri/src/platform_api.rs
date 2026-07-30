use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, Method, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const DEV_API_BASE_URL: &str = "http://127.0.0.1:3000";
const COMPILED_API_BASE_URL: Option<&str> = option_env!("SYNTARA_NATIVE_API_BASE_URL");
const PLATFORM_STREAM_EVENT: &str = "syntara://platform-ai-stream";
const LEGACY_AI_STREAM_EVENT: &str = "syntara://ai-stream";
pub(crate) const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);
const LONG_RUNNING_TIMEOUT: Duration = Duration::from_secs(900);
const MAX_JSON_RESPONSE_BYTES: usize = 96 * 1024 * 1024;
#[allow(dead_code)] // Used by the asset installer once signed lecture URLs are persisted.
const MAX_DOWNLOAD_BYTES: usize = 256 * 1024 * 1024;

const CAPABILITIES_PATH: &str = "/api/native/v1/capabilities";
const TEACHING_TURN_PATH: &str = "/api/native/v1/turn";
const MINI_LECTURES_PATH: &str = "/api/native/v1/mini-lectures";
const REVIEW_PLANS_PATH: &str = "/api/native/v1/review-plans";
const GRADE_PATH: &str = "/api/native/v1/grade";
const TRANSCRIPTIONS_PATH: &str = "/api/native/v1/transcriptions";
const SYLLABUS_PARSE_PATH: &str = "/api/native/v1/syllabus/parse";
const AUTH_DEVICE_START_PATH: &str = "/api/native/v1/auth/device/start";
const AUTH_DEVICE_TOKEN_PATH: &str = "/api/native/v1/auth/device/token";
const AUTH_REFRESH_PATH: &str = "/api/native/v1/auth/refresh";
const AUTH_ME_PATH: &str = "/api/native/v1/auth/me";
const AUTH_LOGOUT_PATH: &str = "/api/native/v1/auth/logout";

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAuthRequest {
    #[serde(default)]
    pub(crate) syntara_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformJsonRequest {
    pub(crate) request_id: String,
    pub(crate) payload: Value,
    #[serde(default)]
    pub(crate) syntara_token: Option<String>,
    #[serde(default)]
    pub(crate) idempotency_key: Option<String>,
    #[serde(default)]
    pub(crate) model: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformConfiguration {
    pub configured: bool,
    pub api_base_url: Option<String>,
    pub source: Option<&'static str>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformStreamEvent {
    request_id: String,
    sequence: u64,
    event_id: Option<String>,
    event: String,
    data: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformTeachingTurnResult {
    pub request_id: String,
    pub text: String,
    pub model: Option<String>,
    pub response_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub final_event: Value,
}

#[derive(Default)]
struct SseParser {
    buffer: Vec<u8>,
}

#[derive(Debug)]
struct SseFrame {
    event: Option<String>,
    id: Option<String>,
    data: String,
}

impl SseParser {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.buffer.extend_from_slice(chunk);
        self.take_complete_blocks()
    }

    fn finish(&mut self) -> Result<Vec<String>, String> {
        let mut blocks = self.take_complete_blocks()?;
        if !self.buffer.iter().all(u8::is_ascii_whitespace) {
            blocks.push(
                String::from_utf8(std::mem::take(&mut self.buffer))
                    .map_err(|_| "平台返回了无效的 UTF-8 事件流。".to_string())?,
            );
        }
        Ok(blocks)
    }

    fn take_complete_blocks(&mut self) -> Result<Vec<String>, String> {
        let mut blocks = Vec::new();
        loop {
            let lf = self
                .buffer
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| (index, 2));
            let crlf = self
                .buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| (index, 4));
            let boundary = match (lf, crlf) {
                (Some(left), Some(right)) => Some(if left.0 <= right.0 { left } else { right }),
                (Some(found), None) | (None, Some(found)) => Some(found),
                (None, None) => None,
            };
            let Some((index, separator_length)) = boundary else {
                break;
            };
            let block = self.buffer.drain(..index).collect::<Vec<_>>();
            self.buffer.drain(..separator_length);
            if !block.iter().all(u8::is_ascii_whitespace) {
                blocks.push(
                    String::from_utf8(block)
                        .map_err(|_| "平台返回了无效的 UTF-8 事件流。".to_string())?,
                );
            }
        }
        Ok(blocks)
    }
}

fn parse_sse_frame(block: &str) -> Option<SseFrame> {
    let mut event = None;
    let mut id = None;
    let mut data = Vec::new();
    for raw_line in block.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.starts_with(':') {
            continue;
        }
        let (field, value) = line
            .split_once(':')
            .map(|(field, value)| (field, value.strip_prefix(' ').unwrap_or(value)))
            .unwrap_or((line, ""));
        match field {
            "event" => event = Some(value.to_string()),
            "id" => id = Some(value.to_string()),
            "data" => data.push(value.to_string()),
            _ => {}
        }
    }
    (!data.is_empty()).then(|| SseFrame {
        event,
        id,
        data: data.join("\n"),
    })
}

fn normalized_sensitive_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_forbidden_provider_field(key: &str) -> bool {
    let key = normalized_sensitive_key(key);
    key == "authorization"
        || key == "providerkey"
        || key == "providercredential"
        || key == "providercredentials"
        || key.ends_with("apikey")
        || key == "baseurl"
        || key.ends_with("baseurl")
}

fn reject_provider_credentials_at(value: &Value, path: &str) -> Result<(), String> {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                let child_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}.{key}")
                };
                if is_forbidden_provider_field(key) {
                    return Err(format!(
                        "原生请求不能包含供应商密钥或 Base URL 字段：{child_path}"
                    ));
                }
                reject_provider_credentials_at(child, &child_path)?;
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                reject_provider_credentials_at(child, &format!("{path}[{index}]"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn reject_provider_credentials(value: &Value) -> Result<(), String> {
    reject_provider_credentials_at(value, "")
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn validate_api_base_url(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw.trim())
        .map_err(|error| format!("SYNTARA_NATIVE_API_BASE_URL 无效：{error}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("平台 API 地址不能包含用户名或密码。".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("平台 API 地址不能包含 query 或 fragment。".to_string());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("平台 API 地址只能配置 origin，不能包含路径。".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "平台 API 地址缺少 host。".to_string())?;
    if cfg!(debug_assertions) {
        if url.scheme() != "https" && !(url.scheme() == "http" && is_loopback_host(host)) {
            return Err("开发模式只允许 HTTPS，或 loopback HTTP 平台地址。".to_string());
        }
    } else if url.scheme() != "https" {
        return Err("正式安装包的平台 API 地址必须使用 HTTPS。".to_string());
    }
    url.set_path("/");
    Ok(url)
}

fn configured_base_url() -> Result<(Url, &'static str), String> {
    if let Ok(runtime) = std::env::var("SYNTARA_NATIVE_API_BASE_URL") {
        if !runtime.trim().is_empty() {
            return validate_api_base_url(&runtime).map(|url| (url, "runtime-env"));
        }
    }
    if let Some(compiled) = COMPILED_API_BASE_URL.filter(|value| !value.trim().is_empty()) {
        return validate_api_base_url(compiled).map(|url| (url, "compiled-origin"));
    }
    if cfg!(debug_assertions) {
        return validate_api_base_url(DEV_API_BASE_URL).map(|url| (url, "development-default"));
    }
    Err(
        "正式安装包尚未配置平台 API。请在构建时设置 HTTPS 的 SYNTARA_NATIVE_API_BASE_URL。"
            .to_string(),
    )
}

pub fn platform_configuration() -> PlatformConfiguration {
    match configured_base_url() {
        Ok((url, source)) => PlatformConfiguration {
            configured: true,
            api_base_url: Some(url.as_str().trim_end_matches('/').to_string()),
            source: Some(source),
            error: None,
        },
        Err(error) => PlatformConfiguration {
            configured: false,
            api_base_url: None,
            source: None,
            error: Some(error),
        },
    }
}

fn endpoint_url(path: &str) -> Result<Url, String> {
    let (base, _) = configured_base_url()?;
    base.join(path.trim_start_matches('/'))
        .map_err(|error| format!("无法构造平台 API 地址：{error}"))
}

fn http_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(timeout)
        .user_agent(concat!("Syntara Native/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("无法创建平台连接：{error}"))
}

fn apply_platform_headers(
    mut builder: reqwest::RequestBuilder,
    syntara_token: Option<&str>,
    request_id: Option<&str>,
    idempotency_key: Option<&str>,
    model: Option<&str>,
) -> reqwest::RequestBuilder {
    if let Some(token) = syntara_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.bearer_auth(token);
    }
    if let Some(request_id) = request_id.map(str::trim).filter(|value| !value.is_empty()) {
        builder = builder.header("X-Request-Id", request_id);
    }
    if let Some(idempotency_key) = idempotency_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.header("Idempotency-Key", idempotency_key);
    }
    if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
        builder = builder.header("X-Model", model);
    }
    builder.header("X-Syntara-Native-Version", env!("CARGO_PKG_VERSION"))
}

fn platform_error_message(status: reqwest::StatusCode, payload: &Value) -> String {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return "尚未配置 Syntara 平台登录凭据，请先完成 App 登录后重试（HTTP 401）。".to_string();
    }
    let message = payload
        .pointer("/error/message")
        .or_else(|| payload.pointer("/data/error/message"))
        .or_else(|| payload.pointer("/message"))
        .or_else(|| payload.pointer("/error"))
        .and_then(Value::as_str)
        .unwrap_or("平台请求失败。");
    format!("{message}（HTTP {status}）")
}

async fn response_json(response: Response) -> Result<Value, String> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_JSON_RESPONSE_BYTES)
    {
        return Err("平台响应超过 96 MB 安全限制。".to_string());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("无法读取平台响应：{error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_JSON_RESPONSE_BYTES {
            return Err("平台响应超过 96 MB 安全限制。".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let payload = serde_json::from_slice::<Value>(&bytes).map_err(|_| {
        if status == reqwest::StatusCode::NOT_FOUND {
            return "当前版本的登录服务尚未上线，请稍后重试（HTTP 404）。".to_string();
        }
        if !status.is_success() {
            return format!("平台服务暂时不可用，请稍后重试（HTTP {status}）。");
        }
        "平台返回了无法解析的响应，请稍后重试。".to_string()
    })?;
    if !status.is_success() {
        return Err(platform_error_message(status, &payload));
    }
    if payload.get("ok").and_then(Value::as_bool) == Some(false)
        || payload.get("success").and_then(Value::as_bool) == Some(false)
    {
        return Err(platform_error_message(status, &payload));
    }
    Ok(payload)
}

async fn request_json(
    method: Method,
    path: &str,
    payload: Option<&Value>,
    syntara_token: Option<&str>,
    request_id: Option<&str>,
    idempotency_key: Option<&str>,
    model: Option<&str>,
    timeout: Duration,
) -> Result<Value, String> {
    if let Some(payload) = payload {
        reject_provider_credentials(payload)?;
    }
    let client = http_client(timeout)?;
    let url = endpoint_url(path)?;
    let builder = apply_platform_headers(
        client.request(method, url),
        syntara_token,
        request_id,
        idempotency_key,
        model,
    );
    let builder = if let Some(payload) = payload {
        builder.json(payload)
    } else {
        builder
    };
    let response = builder
        .send()
        .await
        .map_err(|error| format!("无法连接 Syntara 平台服务：{error}"))?;
    response_json(response).await
}

pub async fn get_json(path: &str, syntara_token: Option<&str>) -> Result<Value, String> {
    request_json(
        Method::GET,
        path,
        None,
        syntara_token,
        None,
        None,
        None,
        DEFAULT_TIMEOUT,
    )
    .await
}

pub async fn post_json(
    path: &str,
    request: &PlatformJsonRequest,
    timeout: Duration,
) -> Result<Value, String> {
    request_json(
        Method::POST,
        path,
        Some(&request.payload),
        request.syntara_token.as_deref(),
        Some(&request.request_id),
        request.idempotency_key.as_deref(),
        request.model.as_deref(),
        timeout,
    )
    .await
}

fn envelope_data(payload: &Value) -> &Value {
    if payload.get("ok").and_then(Value::as_bool) == Some(true)
        || payload.get("success").and_then(Value::as_bool) == Some(true)
    {
        payload.get("data").unwrap_or(payload)
    } else {
        payload
    }
}

fn value_at_paths<'a>(payload: &'a Value, paths: &[&str]) -> Option<&'a Value> {
    paths.iter().find_map(|path| payload.pointer(path))
}

fn string_at_paths(payload: &Value, paths: &[&str]) -> Option<String> {
    value_at_paths(payload, paths)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn u64_at_paths(payload: &Value, paths: &[&str]) -> Option<u64> {
    value_at_paths(payload, paths).and_then(Value::as_u64)
}

fn stream_event_name(frame: &SseFrame, payload: &Value) -> String {
    payload
        .get("type")
        .or_else(|| payload.get("event"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| frame.event.clone())
        .unwrap_or_else(|| "message".to_string())
}

fn stream_delta(payload: &Value) -> Option<String> {
    string_at_paths(
        payload,
        &[
            "/delta",
            "/content",
            "/data/delta",
            "/data/content",
            "/data/textDelta",
        ],
    )
}

fn response_text(payload: &Value) -> Option<String> {
    let payload = envelope_data(payload);
    string_at_paths(
        payload,
        &[
            "/text",
            "/replyText",
            "/assistantMessage/text",
            "/answer/text",
            "/result/text",
            "/message/text",
        ],
    )
}

fn response_error(payload: &Value) -> Option<String> {
    string_at_paths(
        payload,
        &[
            "/error/message",
            "/data/error/message",
            "/message",
            "/error",
        ],
    )
}

fn emit_platform_stream(app: &AppHandle, event: &PlatformStreamEvent) {
    let _ = app.emit(PLATFORM_STREAM_EVENT, event);
}

fn emit_legacy_stream(
    app: &AppHandle,
    request_id: &str,
    kind: &str,
    delta: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        LEGACY_AI_STREAM_EVENT,
        json!({
            "requestId": request_id,
            "kind": kind,
            "delta": delta,
            "message": message,
        }),
    );
}

fn collect_stream_frame(
    app: &AppHandle,
    request_id: &str,
    sequence: &mut u64,
    frame: SseFrame,
    output: &mut String,
    final_event: &mut Value,
) -> Result<(), String> {
    if frame.data == "[DONE]" {
        return Ok(());
    }
    let event_id = frame.id.clone();
    let payload = serde_json::from_str::<Value>(&frame.data).unwrap_or_else(|_| {
        json!({
            "type": frame.event.clone().unwrap_or_else(|| "message".to_string()),
            "data": frame.data,
        })
    });
    let event_name = stream_event_name(&frame, &payload);
    *sequence += 1;
    let platform_event = PlatformStreamEvent {
        request_id: request_id.to_string(),
        sequence: *sequence,
        event_id,
        event: event_name.clone(),
        data: payload.clone(),
    };
    emit_platform_stream(app, &platform_event);

    if matches!(event_name.as_str(), "text_delta" | "delta") {
        if let Some(delta) = stream_delta(&payload) {
            output.push_str(&delta);
            emit_legacy_stream(app, request_id, "delta", Some(delta), None);
        }
    } else if event_name == "done" {
        if let Some(text) = response_text(&payload) {
            if output.is_empty() {
                output.push_str(&text);
            }
        }
        *final_event = payload;
        emit_legacy_stream(app, request_id, "done", None, None);
    } else if event_name == "error" {
        let message = response_error(&payload).unwrap_or_else(|| "平台生成失败。".to_string());
        emit_legacy_stream(app, request_id, "error", None, Some(message.clone()));
        return Err(message);
    }
    Ok(())
}

fn teaching_result_from_payload(
    request_id: &str,
    payload: Value,
) -> Result<PlatformTeachingTurnResult, String> {
    let data = envelope_data(&payload);
    let text = response_text(data).unwrap_or_default();
    if text.trim().is_empty() {
        return Err("平台没有返回助教回复。".to_string());
    }
    Ok(PlatformTeachingTurnResult {
        request_id: request_id.to_string(),
        text,
        model: string_at_paths(
            data,
            &[
                "/model",
                "/model/id",
                "/metadata/model/model",
                "/assistantMessage/metadata/model/model",
            ],
        ),
        response_id: string_at_paths(
            data,
            &[
                "/responseId",
                "/metadata/model/responseId",
                "/assistantMessage/metadata/model/responseId",
                "/id",
            ],
        ),
        input_tokens: u64_at_paths(
            data,
            &[
                "/inputTokens",
                "/usage/inputTokens",
                "/metadata/model/inputTokens",
                "/assistantMessage/metadata/model/inputTokens",
            ],
        ),
        output_tokens: u64_at_paths(
            data,
            &[
                "/outputTokens",
                "/usage/outputTokens",
                "/metadata/model/outputTokens",
                "/assistantMessage/metadata/model/outputTokens",
            ],
        ),
        final_event: payload,
    })
}

pub async fn execute_teaching_turn(
    app: AppHandle,
    request: PlatformJsonRequest,
) -> Result<PlatformTeachingTurnResult, String> {
    reject_provider_credentials(&request.payload)?;
    let client = http_client(DEFAULT_TIMEOUT)?;
    let url = endpoint_url(TEACHING_TURN_PATH)?;
    let response = apply_platform_headers(
        client.post(url),
        request.syntara_token.as_deref(),
        Some(&request.request_id),
        request.idempotency_key.as_deref(),
        request.model.as_deref(),
    )
    .header("Accept", "text/event-stream, application/json")
    .json(&request.payload)
    .send()
    .await
    .map_err(|error| format!("无法连接 Syntara 教学服务：{error}"))?;

    if !response.status().is_success() {
        return response_json(response)
            .await
            .and_then(|_| Err("平台教学请求失败，但服务没有返回错误详情。".to_string()));
    }
    let is_sse = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
    if !is_sse {
        let payload = response_json(response).await?;
        let result = teaching_result_from_payload(&request.request_id, payload.clone())?;
        emit_platform_stream(
            &app,
            &PlatformStreamEvent {
                request_id: request.request_id.clone(),
                sequence: 1,
                event_id: None,
                event: "done".to_string(),
                data: payload,
            },
        );
        emit_legacy_stream(&app, &request.request_id, "done", None, None);
        return Ok(result);
    }

    let mut stream = response.bytes_stream();
    let mut parser = SseParser::default();
    let mut output = String::new();
    let mut sequence = 0;
    let mut final_event = Value::Null;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("平台回复中断：{error}"))?;
        for block in parser.push(&chunk)? {
            if let Some(frame) = parse_sse_frame(&block) {
                collect_stream_frame(
                    &app,
                    &request.request_id,
                    &mut sequence,
                    frame,
                    &mut output,
                    &mut final_event,
                )?;
            }
        }
    }
    for block in parser.finish()? {
        if let Some(frame) = parse_sse_frame(&block) {
            collect_stream_frame(
                &app,
                &request.request_id,
                &mut sequence,
                frame,
                &mut output,
                &mut final_event,
            )?;
        }
    }
    if output.trim().is_empty() {
        if let Some(text) = response_text(&final_event) {
            output = text;
        }
    }
    if output.trim().is_empty() {
        return Err("平台没有返回助教回复。".to_string());
    }
    let metadata = envelope_data(&final_event);
    Ok(PlatformTeachingTurnResult {
        request_id: request.request_id,
        text: output.trim().to_string(),
        model: string_at_paths(
            metadata,
            &[
                "/model",
                "/metadata/model/model",
                "/assistantMessage/metadata/model/model",
            ],
        ),
        response_id: string_at_paths(
            metadata,
            &[
                "/responseId",
                "/metadata/model/responseId",
                "/assistantMessage/metadata/model/responseId",
            ],
        ),
        input_tokens: u64_at_paths(
            metadata,
            &[
                "/inputTokens",
                "/usage/inputTokens",
                "/metadata/model/inputTokens",
                "/assistantMessage/metadata/model/inputTokens",
            ],
        ),
        output_tokens: u64_at_paths(
            metadata,
            &[
                "/outputTokens",
                "/usage/outputTokens",
                "/metadata/model/outputTokens",
                "/assistantMessage/metadata/model/outputTokens",
            ],
        ),
        final_event,
    })
}

#[allow(dead_code)] // Foundation for signed lecture-asset downloads; persistence is a separate slice.
pub async fn download_asset(url: &str) -> Result<Vec<u8>, String> {
    let parsed = Url::parse(url).map_err(|error| format!("资源下载地址无效：{error}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "资源下载地址缺少 host。".to_string())?;
    if parsed.scheme() != "https"
        && !(cfg!(debug_assertions) && parsed.scheme() == "http" && is_loopback_host(host))
    {
        return Err("资源下载必须使用 HTTPS；开发模式仅允许 loopback HTTP。".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("资源下载地址不能包含用户名或密码。".to_string());
    }
    let response = http_client(LONG_RUNNING_TIMEOUT)?
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("资源下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("资源下载失败（HTTP {}）。", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_DOWNLOAD_BYTES)
    {
        return Err("资源超过 256 MB 限制。".to_string());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("资源下载中断：{error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_DOWNLOAD_BYTES {
            return Err("资源超过 256 MB 限制。".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn native_get_capabilities(request: PlatformAuthRequest) -> Result<Value, String> {
    get_json(CAPABILITIES_PATH, request.syntara_token.as_deref()).await
}

#[tauri::command]
pub async fn native_start_device_auth(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(AUTH_DEVICE_START_PATH, &request, DEFAULT_TIMEOUT).await
}

#[tauri::command]
pub async fn native_poll_device_auth(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(AUTH_DEVICE_TOKEN_PATH, &request, DEFAULT_TIMEOUT).await
}

#[tauri::command]
pub async fn native_refresh_device_auth(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(AUTH_REFRESH_PATH, &request, DEFAULT_TIMEOUT).await
}

#[tauri::command]
pub async fn native_get_current_user(request: PlatformAuthRequest) -> Result<Value, String> {
    get_json(AUTH_ME_PATH, request.syntara_token.as_deref()).await
}

#[tauri::command]
pub async fn native_logout_device(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(AUTH_LOGOUT_PATH, &request, DEFAULT_TIMEOUT).await
}

#[tauri::command]
pub async fn native_teaching_turn(
    app: AppHandle,
    request: PlatformJsonRequest,
) -> Result<PlatformTeachingTurnResult, String> {
    execute_teaching_turn(app, request).await
}

#[tauri::command]
pub async fn native_create_mini_lecture(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(MINI_LECTURES_PATH, &request, LONG_RUNNING_TIMEOUT).await
}

#[tauri::command]
pub async fn native_create_review_plan(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(REVIEW_PLANS_PATH, &request, DEFAULT_TIMEOUT).await
}

#[tauri::command]
pub async fn native_grade_answer(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(GRADE_PATH, &request, DEFAULT_TIMEOUT).await
}

#[tauri::command]
pub async fn native_transcribe_audio(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(TRANSCRIPTIONS_PATH, &request, DEFAULT_TIMEOUT).await
}

#[tauri::command]
pub async fn native_parse_syllabus(request: PlatformJsonRequest) -> Result<Value, String> {
    post_json(SYLLABUS_PARSE_PATH, &request, DEFAULT_TIMEOUT).await
}

#[cfg(test)]
mod tests {
    use super::{
        parse_sse_frame, reject_provider_credentials, validate_api_base_url, SseParser,
        DEV_API_BASE_URL,
    };
    use serde_json::json;

    #[test]
    fn parses_sse_across_chunks_and_crlf() {
        let mut parser = SseParser::default();
        assert!(parser.push(b":heartbeat\r\n\r\n").unwrap().len() == 1);
        assert!(parser.push(b"event: text_").unwrap().is_empty());
        let blocks = parser
            .push(b"delta\r\nid: 4\r\ndata: {\"type\":\"text_delta\",\"data\":{\"content\":\"\xe4\xbd\xa0\xe5\xa5\xbd\"}}\r\n\r\n")
            .unwrap();
        let frame = parse_sse_frame(&blocks[0]).unwrap();
        assert_eq!(frame.event.as_deref(), Some("text_delta"));
        assert_eq!(frame.id.as_deref(), Some("4"));
        assert!(frame.data.contains("你好"));
    }

    #[test]
    fn rejects_provider_credentials_recursively() {
        assert!(reject_provider_credentials(&json!({
            "course": {"id": "mat136"},
            "providers": {"openaiApiKey": "secret"}
        }))
        .is_err());
        assert!(reject_provider_credentials(&json!({
            "audio": [{"ttsBaseUrl": "https://example.com"}]
        }))
        .is_err());
        assert!(reject_provider_credentials(&json!({
            "course": {"id": "mat136"},
            "source": {"url": "https://example.com/source.pdf"}
        }))
        .is_ok());
    }

    #[test]
    fn validates_debug_base_urls() {
        assert!(validate_api_base_url(DEV_API_BASE_URL).is_ok());
        assert!(validate_api_base_url("https://api.example.com").is_ok());
        assert!(validate_api_base_url("http://example.com").is_err());
        assert!(validate_api_base_url("https://user:password@example.com").is_err());
        assert!(validate_api_base_url("https://api.example.com/v1").is_err());
    }
}
