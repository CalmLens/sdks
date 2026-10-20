//! Calmlibrary: a private team media library demonstrating the CalmLens Rust SDK.
pub mod app;
pub mod config;
mod demo;
pub mod library;
pub mod messages;
mod page;
#[cfg(test)]
mod tests;

pub use app::{router, AppState, SharedState};
pub use config::{settings_from_env, Settings, StartupError, DEFAULT_PORT};
