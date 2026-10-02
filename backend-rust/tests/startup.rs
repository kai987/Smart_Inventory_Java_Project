use std::{net::TcpListener, process::Command};

fn server() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_smart-inventory-server"));
    for key in [
        "PORT",
        "SMART_INVENTORY_DATA_DIR",
        "SMART_INVENTORY_STATIC_DIR",
        "SMART_INVENTORY_HOST",
        "SMART_INVENTORY_PORT",
        "SMART_INVENTORY_ALLOWED_ORIGINS",
        "SMART_INVENTORY_SECURE_COOKIE",
        "SMART_INVENTORY_SESSION_TIMEOUT_SECONDS",
        "SMART_INVENTORY_LOW_STOCK_THRESHOLD",
    ] {
        command.env_remove(key);
    }
    command.env("RUST_LOG", "info");
    command
}

#[test]
fn occupied_port_fails_before_creating_or_migrating_any_data() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("must-not-be-created");
    let output = server()
        .env(
            "SMART_INVENTORY_PORT",
            listener.local_addr().unwrap().port().to_string(),
        )
        .env("SMART_INVENTORY_DATA_DIR", &data)
        .output()
        .unwrap();
    assert!(!output.status.success());
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(log.contains("Cannot listen on"), "{log}");
    assert!(log.contains("SMART_INVENTORY_PORT"), "{log}");
    assert!(!data.exists());
}

#[test]
fn invalid_configuration_does_not_create_data() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("must-not-be-created");
    let output = server()
        .env("SMART_INVENTORY_ALLOWED_ORIGINS", "*")
        .env("SMART_INVENTORY_DATA_DIR", &data)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!data.exists());
}
