#![cfg_attr(
    all(windows, feature = "standalone", not(debug_assertions)),
    windows_subsystem = "windows"
)]
//! trace-viz-backend server — axum + static SPA serving.
//!
//! Standalone: embeds `frontend/dist` in a desktop window.
//! Regular builds serve `frontend/dist` from disk;
//! development: Vite dev server proxies /api to this port.
//!
//! Security note: binds 127.0.0.1 by default — this is a local developer
//! tool with filesystem access; never expose it beyond localhost.

#[cfg(not(feature = "standalone"))]
use std::path::PathBuf;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use tower_http::trace::TraceLayer;

use trace_viz_backend::api;

#[cfg(not(feature = "standalone"))]
const DEFAULT_HOST: &str = "127.0.0.1";
#[cfg(not(feature = "standalone"))]
const DEFAULT_PORT: u16 = 8601;

#[cfg(feature = "standalone")]
include!(concat!(env!("OUT_DIR"), "/frontend.rs"));

#[cfg(not(feature = "standalone"))]
fn dist_dir() -> PathBuf {
    std::env::var("DIST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist"))
}

fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "map" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Single catch-all: serve real frontend assets, SPA-fallback to index.html
/// for client routes, JSON 404 for unknown /api paths.
async fn fallback_handler(uri: Uri, req: Request<Body>) -> Response {
    if req.method() != axum::http::Method::GET && req.method() != axum::http::Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let path = uri.path();
    if path.starts_with("/api") {
        return (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "not_found", "message": "未知端点"})),
        )
            .into_response();
    }
    let relative = path.trim_start_matches('/');
    if let Some(body) = asset(relative).await {
        asset_response(relative, body)
    } else if let Some(body) = asset("index.html").await {
        asset_response("index.html", body)
    } else {
        (
            StatusCode::NOT_FOUND,
            "frontend not built — run `npm run build` in frontend/ or use the Vite dev server",
        )
            .into_response()
    }
}

fn asset_response(path: &str, body: Body) -> Response {
    Response::builder()
        .header("content-type", mime_for(path))
        .body(body)
        .unwrap()
}

#[cfg(not(feature = "standalone"))]
async fn asset(relative: &str) -> Option<Body> {
    let path = std::path::Path::new(relative);
    if !path
        .components()
        .all(|part| matches!(part, std::path::Component::Normal(_)))
        || relative.is_empty()
        || relative.contains(['\\', ':'])
    {
        return None;
    }
    tokio::fs::read(dist_dir().join(path))
        .await
        .ok()
        .map(Body::from)
}

#[cfg(feature = "standalone")]
async fn asset(relative: &str) -> Option<Body> {
    embedded_asset(relative).map(Body::from)
}

#[cfg(feature = "standalone")]
mod desktop;
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=warn".into()),
        )
        .init();

    // Traces can be hundreds of MB (upload mode); keep a generous limit.
    let app = Router::new()
        .merge(api::router())
        .fallback(fallback_handler)
        .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024))
        .layer(TraceLayer::new_for_http());

    #[cfg(not(feature = "standalone"))]
    let host = std::env::var("DASHBOARD_HOST").unwrap_or_else(|_| DEFAULT_HOST.into());
    #[cfg(not(feature = "standalone"))]
    let port: u16 = std::env::var("DASHBOARD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    #[cfg(feature = "standalone")]
    let addr = "127.0.0.1:0";
    #[cfg(not(feature = "standalone"))]
    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("无法绑定 {addr}: {e}"));
    let local_addr = listener
        .local_addr()
        .expect("bound listener has no address");
    let url = format!("http://{local_addr}/");
    tracing::info!("trace-viz backend listening on {url}");

    #[cfg(feature = "standalone")]
    tracing::info!("serving embedded frontend");
    #[cfg(not(feature = "standalone"))]
    {
        let dist = dist_dir();
        if dist.join("index.html").is_file() {
            tracing::info!("serving frontend from {}", dist.display());
        } else {
            tracing::warn!(
                "{} not found — API only; run `npm run build` in frontend/ or use the Vite dev proxy",
                dist.display()
            );
        }
    }
    #[cfg(not(feature = "standalone"))]
    axum::serve(listener, app).await.unwrap();
    #[cfg(feature = "standalone")]
    {
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        desktop::run(url);
    }
}
