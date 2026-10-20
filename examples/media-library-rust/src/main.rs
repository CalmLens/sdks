use calmlibrary::{router, settings_from_env, AppState, DEFAULT_PORT};
use std::net::Ipv4Addr;
use std::process::ExitCode;

const USAGE: &str = "Usage: cargo run -- [--port PORT] [--demo]";

#[tokio::main]
async fn main() -> ExitCode {
    let mut port = DEFAULT_PORT;
    let mut demo = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--demo" => demo = true,
            "--port" => match args.next().and_then(|value| value.parse().ok()) {
                Some(value) => port = value,
                None => {
                    eprintln!("{USAGE}");
                    return ExitCode::from(2);
                }
            },
            _ => {
                eprintln!("{USAGE}");
                return ExitCode::from(2);
            }
        }
    }
    let settings = match settings_from_env(|name| std::env::var(name).ok(), demo) {
        Ok(settings) => settings,
        Err(error) => {
            eprintln!("Calmlibrary: {}", error.message());
            return ExitCode::FAILURE;
        }
    };
    let mode = if settings.library.is_demo() {
        "demo"
    } else {
        "live"
    };
    let host = Ipv4Addr::LOCALHOST;
    let state = AppState::new(settings.library, settings.webhook_secret);
    let listener = match tokio::net::TcpListener::bind((host, port)).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Calmlibrary: could not listen on {host}:{port}: {error}");
            return ExitCode::FAILURE;
        }
    };
    println!("Calmlibrary: http://{host}:{port} ({mode})");
    if let Err(error) = axum::serve(listener, router(state)).await {
        eprintln!("Calmlibrary: the server stopped: {error}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
