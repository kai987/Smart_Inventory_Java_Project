use smart_inventory_rust::{api, config::Config, store::Store};
use std::{net::SocketAddr, process::ExitCode};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env().map_err(std::io::Error::other)?;
    let address = SocketAddr::new(config.host, config.port);
    // Bind before opening/migrating data. A port conflict must not modify CSVs.
    let listener = TcpListener::bind(address).await.map_err(|error| {
        std::io::Error::new(
            error.kind(),
            format!(
                "Cannot listen on {address}: {error}. Stop the other server or set SMART_INVENTORY_PORT."
            ),
        )
    })?;
    let store = Store::open(&config.data_dir)?;
    if !config.static_dir.join("index.html").is_file() {
        tracing::warn!(
            directory = %config.static_dir.display(),
            "Frontend build not found; API is available. Use Vite or build the frontend to serve the UI."
        );
    }
    tracing::info!(
        url = %format!("http://{address}"),
        data_dir = %config.data_dir.display(),
        "Smart Inventory Rust backend started"
    );
    axum::serve(listener, api::router(store, config))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "Could not install Ctrl+C signal handler");
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::error!(%error, "Could not install SIGTERM signal handler"),
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("Shutting down Smart Inventory");
}
