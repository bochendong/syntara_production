use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::platform_api::{
    execute_teaching_turn, platform_configuration, post_json, PlatformJsonRequest, DEFAULT_TIMEOUT,
};

const DEFAULT_MODEL: &str = "gpt-5.6-sol";
const MAX_SYLLABUS_FILE_BYTES: usize = 20 * 1024 * 1024;
const MAX_SYLLABUS_IMAGE_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    configured: bool,
    credential_source: Option<&'static str>,
    default_model: &'static str,
    api_base_url: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    role: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    request_id: String,
    course_name: String,
    course_description: String,
    messages: Vec<AiChatMessage>,
    model: Option<String>,
    #[serde(default)]
    teaching_plan: Option<Value>,
    #[serde(default)]
    context_json: Option<Value>,
    #[serde(default)]
    enable_web_search: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResult {
    text: String,
    model: String,
    response_id: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyllabusParseRequest {
    course_name: String,
    course_description: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
    model: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSyllabusEvent {
    title: String,
    kind: String,
    date: String,
    week: Option<String>,
    source_column: Option<String>,
    raw_text: Option<String>,
    confidence: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawParsedSyllabus {
    #[serde(default)]
    course_title: Option<String>,
    #[serde(default)]
    source_markdown: String,
    #[serde(default)]
    events: Vec<ParsedSyllabusEvent>,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default, alias = "modelId")]
    model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSyllabusDocument {
    course_title: Option<String>,
    source_markdown: String,
    events: Vec<ParsedSyllabusEvent>,
    warnings: Vec<String>,
    model: String,
}

pub(crate) fn validated_model(model: Option<&str>) -> Result<String, String> {
    let model = model.unwrap_or(DEFAULT_MODEL).trim();
    let allowed = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
    allowed
        .contains(&model)
        .then(|| model.to_string())
        .ok_or_else(|| "请选择 Syntara 支持的模型。".to_string())
}

fn syllabus_mime_type(file_name: &str, mime_type: &str) -> Result<String, String> {
    let supplied = mime_type.trim().to_ascii_lowercase();
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    let inferred = match extension.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "",
    };
    let normalized = if supplied.is_empty() || supplied == "application/octet-stream" {
        inferred
    } else {
        supplied.as_str()
    };
    let supported_image = matches!(
        normalized,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    );
    let supported_document = matches!(normalized, "application/pdf");
    (supported_image || supported_document)
        .then(|| normalized.to_string())
        .ok_or_else(|| {
            "不支持这个 syllabus 文件格式。AI 日历解析目前只支持 PDF、PNG、JPG、WEBP 和 GIF。"
                .to_string()
        })
}

fn estimated_base64_bytes(data: &str) -> usize {
    let data = data.trim();
    data.len().saturating_mul(3) / 4
}

fn envelope_data(payload: &Value) -> Value {
    if payload.get("ok").and_then(Value::as_bool) == Some(true)
        || payload.get("success").and_then(Value::as_bool) == Some(true)
    {
        payload
            .get("data")
            .cloned()
            .unwrap_or_else(|| payload.clone())
    } else {
        payload.clone()
    }
}

#[tauri::command]
pub fn get_ai_settings() -> Result<AiSettings, String> {
    let configuration = platform_configuration();
    Ok(AiSettings {
        configured: configuration.configured,
        credential_source: configuration.configured.then_some("platform-service"),
        default_model: DEFAULT_MODEL,
        api_base_url: configuration.api_base_url,
        error: configuration.error,
    })
}

#[tauri::command]
pub async fn parse_syllabus_document(
    request: SyllabusParseRequest,
) -> Result<ParsedSyllabusDocument, String> {
    let model = validated_model(request.model.as_deref())?;
    let mime_type = syllabus_mime_type(&request.file_name, &request.mime_type)?;
    if request.data_base64.trim().is_empty() {
        return Err("上传的 syllabus 文件为空。".to_string());
    }
    let max_bytes = if mime_type.starts_with("image/") {
        MAX_SYLLABUS_IMAGE_BYTES
    } else {
        MAX_SYLLABUS_FILE_BYTES
    };
    if estimated_base64_bytes(&request.data_base64) > max_bytes {
        return Err(format!(
            "“{}”超过大小限制（{} MB）。",
            request.file_name,
            max_bytes / 1024 / 1024
        ));
    }

    let platform_request = PlatformJsonRequest {
        request_id: format!("syllabus-{}", uuid_like_request_suffix(&request.file_name)),
        payload: json!({
            "course": {
                "name": request.course_name.trim(),
                "description": request.course_description.trim(),
            },
            "file": {
                "name": request.file_name.trim(),
                "mimeType": mime_type,
                "dataBase64": request.data_base64,
            },
            "preferences": {
                "model": model,
            },
        }),
        syntara_token: None,
        idempotency_key: None,
        model: Some(model.clone()),
    };
    let payload = post_json(
        "/api/native/v1/syllabus/parse",
        &platform_request,
        DEFAULT_TIMEOUT,
    )
    .await?;
    let mut parsed: RawParsedSyllabus = serde_json::from_value(envelope_data(&payload))
        .map_err(|error| format!("平台 syllabus 结果不符合预期结构：{error}"))?;
    parsed.events.truncate(200);
    parsed.warnings.truncate(20);
    Ok(ParsedSyllabusDocument {
        course_title: parsed.course_title,
        source_markdown: parsed.source_markdown,
        events: parsed.events,
        warnings: parsed.warnings,
        model: parsed.model.unwrap_or(model),
    })
}

fn uuid_like_request_suffix(seed: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sanitized = seed
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(16)
        .collect::<String>();
    format!("{sanitized}-{nanos:x}")
}

#[tauri::command]
pub async fn stream_ai_response(
    app: AppHandle,
    request: AiChatRequest,
) -> Result<AiChatResult, String> {
    let model = validated_model(request.model.as_deref())?;
    let request_id = request.request_id.clone();
    let messages = request
        .messages
        .into_iter()
        .filter(|message| matches!(message.role.as_str(), "user" | "assistant"))
        .filter(|message| !message.text.trim().is_empty())
        .collect::<Vec<_>>();
    let question = messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.text.trim().to_string())
        .ok_or_else(|| "没有可发送的学生问题。".to_string())?;

    let platform_request = PlatformJsonRequest {
        request_id: request_id.clone(),
        payload: json!({
            "requestId": request_id,
            "question": question,
            "course": {
                "name": request.course_name.trim(),
                "description": request.course_description.trim(),
            },
            "conversation": {
                "recentMessages": messages,
            },
            "localContext": request.context_json.unwrap_or_else(|| json!({})),
            "teachingPlan": request.teaching_plan.unwrap_or_else(|| json!({})),
            "preferences": {
                "model": model,
                "allowWebSearch": request.enable_web_search,
            },
        }),
        syntara_token: None,
        idempotency_key: Some(request.request_id),
        model: Some(model.clone()),
    };
    let result = execute_teaching_turn(app, platform_request).await?;
    Ok(AiChatResult {
        text: result.text,
        model: result.model.unwrap_or(model),
        response_id: result.response_id,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::{estimated_base64_bytes, syllabus_mime_type, validated_model};

    #[test]
    fn accepts_only_product_models() {
        assert_eq!(
            validated_model(Some("gpt-5.6-terra")).unwrap(),
            "gpt-5.6-terra"
        );
        assert!(validated_model(Some("untrusted-model")).is_err());
    }

    #[test]
    fn accepts_only_syllabus_pdfs_and_images_by_extension() {
        assert_eq!(
            syllabus_mime_type("course.pdf", "").unwrap(),
            "application/pdf"
        );
        assert_eq!(
            syllabus_mime_type("schedule.png", "application/octet-stream").unwrap(),
            "image/png"
        );
        assert!(syllabus_mime_type("course.docx", "").is_err());
        assert!(syllabus_mime_type("course.csv", "text/csv").is_err());
        assert!(syllabus_mime_type("archive.zip", "application/zip").is_err());
    }

    #[test]
    fn estimates_base64_size_without_decoding_secret_material() {
        assert_eq!(estimated_base64_bytes("YWJjZA=="), 6);
    }
}
