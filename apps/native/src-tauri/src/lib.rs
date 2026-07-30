mod ai;
mod assets;
mod auth_store;
mod platform_api;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_local_learning_core",
            sql: include_str!("../migrations/0001_core.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_local_learning_content",
            sql: include_str!("../migrations/0002_learning_content.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_local_learning_assets",
            sql: include_str!("../migrations/0003_assets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "move_assets_to_app_data_files",
            sql: include_str!("../migrations/0004_asset_file_storage.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_local_course_search",
            sql: include_str!("../migrations/0005_local_course_search.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_local_app_metadata",
            sql: include_str!("../migrations/0006_app_metadata.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_course_events_and_lectures",
            sql: include_str!("../migrations/0007_course_events_and_lectures.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_message_metadata",
            sql: include_str!("../migrations/0008_message_metadata.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ai::get_ai_settings,
            ai::parse_syllabus_document,
            ai::stream_ai_response,
            auth_store::load_native_auth_session,
            auth_store::save_native_auth_session,
            auth_store::clear_native_auth_session,
            platform_api::native_start_device_auth,
            platform_api::native_poll_device_auth,
            platform_api::native_refresh_device_auth,
            platform_api::native_get_current_user,
            platform_api::native_logout_device,
            platform_api::native_get_capabilities,
            platform_api::native_teaching_turn,
            platform_api::native_create_mini_lecture,
            platform_api::native_create_review_plan,
            platform_api::native_grade_answer,
            platform_api::native_transcribe_audio,
            platform_api::native_parse_syllabus,
            assets::persist_archive_assets,
            assets::read_local_asset,
            assets::verify_local_assets,
            assets::delete_local_asset_files
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:syntara-local.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("failed to start Syntara");
}
