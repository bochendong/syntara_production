fn main() {
    println!("cargo:rerun-if-env-changed=SYNTARA_NATIVE_API_BASE_URL");

    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let api_base_url = std::env::var("SYNTARA_NATIVE_API_BASE_URL")
            .expect("release builds require SYNTARA_NATIVE_API_BASE_URL");
        assert!(
            api_base_url.trim().starts_with("https://"),
            "release builds require an HTTPS SYNTARA_NATIVE_API_BASE_URL"
        );
    }

    tauri_build::build()
}
