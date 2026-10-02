use axum::http::{HeaderValue, Uri};
use std::{env, net::IpAddr, path::PathBuf, time::Duration};

#[derive(Clone, Debug)]
pub struct Config {
    pub data_dir: PathBuf,
    pub static_dir: PathBuf,
    pub host: IpAddr,
    pub port: u16,
    pub allowed_origins: Vec<String>,
    pub secure_cookie: bool,
    pub session_timeout: Duration,
    pub low_stock_threshold: i32,
}

impl Default for Config {
    fn default() -> Self {
        let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("Cargo manifest has a parent directory")
            .to_path_buf();
        Self {
            data_dir: repository.join("runtime-data-rust"),
            static_dir: repository.join("frontend/dist"),
            host: IpAddr::from([127, 0, 0, 1]),
            port: 8080,
            allowed_origins: vec!["http://localhost:5173".into()],
            secure_cookie: false,
            session_timeout: Duration::from_secs(1800),
            low_stock_threshold: 5,
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::from_values(|key| env::var(key).ok())
    }

    // Injecting the environment keeps configuration tests isolated and avoids
    // process-wide environment mutation during concurrent Rust tests.
    fn from_values(get: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let mut config = Self::default();
        for (key, destination) in [
            ("SMART_INVENTORY_DATA_DIR", &mut config.data_dir),
            ("SMART_INVENTORY_STATIC_DIR", &mut config.static_dir),
        ] {
            if let Some(value) = get(key) {
                if value.trim().is_empty() {
                    return Err(format!("{key} must not be empty"));
                }
                *destination = PathBuf::from(value);
            }
        }
        if let Some(value) = get("SMART_INVENTORY_HOST") {
            config.host = value.parse().map_err(|_| {
                "SMART_INVENTORY_HOST must be an IP address, such as 127.0.0.1 or 0.0.0.0"
                    .to_owned()
            })?;
        }
        if let Some(value) = get("SMART_INVENTORY_PORT").or_else(|| get("PORT")) {
            config.port = value
                .parse()
                .map_err(|_| "SMART_INVENTORY_PORT (or PORT) must be between 1 and 65535")?;
            if config.port == 0 {
                return Err("SMART_INVENTORY_PORT (or PORT) must be between 1 and 65535".into());
            }
        }
        if let Some(value) = get("SMART_INVENTORY_ALLOWED_ORIGINS") {
            config.allowed_origins = parse_origins(&value)?;
        }
        if let Some(value) = get("SMART_INVENTORY_SECURE_COOKIE") {
            config.secure_cookie = value
                .parse()
                .map_err(|_| "SMART_INVENTORY_SECURE_COOKIE must be true or false".to_owned())?;
        }
        if let Some(value) = get("SMART_INVENTORY_SESSION_TIMEOUT_SECONDS") {
            let seconds: u64 = value.parse().map_err(|_| {
                "SMART_INVENTORY_SESSION_TIMEOUT_SECONDS must be a positive integer".to_owned()
            })?;
            if seconds == 0 || seconds > 31_536_000 {
                return Err(
                    "SMART_INVENTORY_SESSION_TIMEOUT_SECONDS must be between 1 and 31536000".into(),
                );
            }
            config.session_timeout = Duration::from_secs(seconds);
        }
        if let Some(value) = get("SMART_INVENTORY_LOW_STOCK_THRESHOLD") {
            config.low_stock_threshold = value.parse().map_err(|_| {
                "SMART_INVENTORY_LOW_STOCK_THRESHOLD must be a nonnegative 32-bit integer"
                    .to_owned()
            })?;
            if config.low_stock_threshold < 0 {
                return Err("SMART_INVENTORY_LOW_STOCK_THRESHOLD must not be negative".into());
            }
        }
        Ok(config)
    }
}

fn parse_origins(value: &str) -> Result<Vec<String>, String> {
    let mut origins = Vec::new();
    for entry in value.split(',') {
        let origin = entry.trim().trim_end_matches('/');
        let valid = origin.parse::<Uri>().ok().is_some_and(|uri| {
            matches!(uri.scheme_str(), Some("http" | "https"))
                && uri.authority().is_some_and(|authority| {
                    !authority.as_str().contains('@') && !authority.host().is_empty()
                })
                && matches!(uri.path(), "" | "/")
                && uri.query().is_none()
                && HeaderValue::from_str(origin).is_ok()
                && !origin.contains(['#', '*'])
        });
        if !valid {
            return Err(
                "SMART_INVENTORY_ALLOWED_ORIGINS requires comma-separated explicit HTTP(S) origins (no wildcard, credentials, path, or query)"
                    .into(),
            );
        }
        if !origins.iter().any(|existing| existing == origin) {
            origins.push(origin.to_owned());
        }
    }
    Ok(origins)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(pairs: &[(&str, &str)]) -> Result<Config, String> {
        let values: HashMap<_, _> = pairs.iter().copied().collect();
        Config::from_values(|key| values.get(key).map(|value| (*value).into()))
    }

    #[test]
    fn defaults_keep_java_data_separate_and_bind_locally() {
        let config = config(&[]).unwrap();
        assert!(config.data_dir.ends_with("runtime-data-rust"));
        assert!(config.static_dir.ends_with("frontend/dist"));
        assert!(config.host.is_loopback());
        assert_eq!(config.port, 8080);
        assert_eq!(config.session_timeout, Duration::from_secs(1800));
        assert!(!config.secure_cookie);
    }

    #[test]
    fn overrides_and_explicit_origins_are_supported() {
        let config = config(&[
            ("SMART_INVENTORY_DATA_DIR", "./custom-data"),
            ("SMART_INVENTORY_STATIC_DIR", "./public"),
            ("SMART_INVENTORY_HOST", "0.0.0.0"),
            ("SMART_INVENTORY_PORT", "8081"),
            ("PORT", "8082"),
            (
                "SMART_INVENTORY_ALLOWED_ORIGINS",
                "https://example.com/, http://localhost:5173,https://example.com",
            ),
            ("SMART_INVENTORY_SECURE_COOKIE", "true"),
            ("SMART_INVENTORY_SESSION_TIMEOUT_SECONDS", "60"),
            ("SMART_INVENTORY_LOW_STOCK_THRESHOLD", "0"),
        ])
        .unwrap();
        assert_eq!(config.data_dir, PathBuf::from("./custom-data"));
        assert_eq!(config.static_dir, PathBuf::from("./public"));
        assert_eq!(config.port, 8081);
        assert_eq!(config.allowed_origins.len(), 2);
        assert_eq!(config.allowed_origins[0], "https://example.com");
        assert!(config.secure_cookie);
        assert_eq!(config.session_timeout, Duration::from_secs(60));
        assert_eq!(config.low_stock_threshold, 0);
        assert_eq!(self::config(&[("PORT", "8083")]).unwrap().port, 8083);
    }

    #[test]
    fn unsafe_or_invalid_configuration_fails_closed() {
        for origin in [
            "*",
            "https://*.example.com",
            "",
            "http://x/path",
            "http://user@x",
            "http://x?foo=bar",
            "ftp://x",
            "http://x#fragment",
            "https://x,",
        ] {
            assert!(config(&[("SMART_INVENTORY_ALLOWED_ORIGINS", origin)]).is_err());
        }
        for pair in [
            ("SMART_INVENTORY_HOST", "localhost"),
            ("SMART_INVENTORY_PORT", "0"),
            ("SMART_INVENTORY_PORT", "65536"),
            ("SMART_INVENTORY_DATA_DIR", " "),
            ("SMART_INVENTORY_SECURE_COOKIE", "yes"),
            ("SMART_INVENTORY_SESSION_TIMEOUT_SECONDS", "0"),
            (
                "SMART_INVENTORY_SESSION_TIMEOUT_SECONDS",
                "18446744073709551615",
            ),
            ("SMART_INVENTORY_LOW_STOCK_THRESHOLD", "-1"),
        ] {
            assert!(config(&[pair]).is_err(), "{pair:?}");
        }
    }
}
