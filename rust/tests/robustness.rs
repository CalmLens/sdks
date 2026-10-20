use calmlens::{blocking::ServerClient, models::*, Error};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::Duration,
};

/// Serves one connection: reads the request head, then lets `reply` misbehave.
fn serve_once(reply: impl FnOnce(TcpStream) + Send + 'static) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut head = Vec::new();
        let mut byte = [0];
        while !head.ends_with(b"\r\n\r\n") && stream.read(&mut byte).unwrap_or(0) == 1 {
            head.push(byte[0]);
        }
        reply(stream);
    });
    (url, worker)
}
fn client(url: &str, timeout: Duration) -> ServerClient {
    ServerClient::builder("key", "project")
        .base_url(url)
        .cdn_base_url(url)
        .timeout(timeout)
        .read_timeout(timeout)
        .max_retries(0)
        .build()
        .unwrap()
}
fn list_events(url: &str, timeout: Duration) -> Error {
    client(url, timeout)
        .events()
        .list(ListEvents::default())
        .unwrap_err()
}
fn assert_wrapped(error: &Error, code: &str) {
    assert_eq!(error.code(), &code, "{error}");
    assert!(error.to_string().starts_with("[calmlens] "));
    assert!(
        std::error::Error::source(error).is_some(),
        "cause preserved"
    );
}

#[test]
fn connection_closed_before_response_is_transport_error() {
    let (url, worker) = serve_once(drop);
    assert_wrapped(
        &list_events(&url, Duration::from_secs(5)),
        "sdk/transport-error",
    );
    worker.join().unwrap();
}

#[test]
fn malformed_http_response_is_transport_error() {
    let (url, worker) = serve_once(|mut stream| {
        stream.write_all(b"NOT-HTTP garbage\r\n\r\n").unwrap();
    });
    assert_wrapped(
        &list_events(&url, Duration::from_secs(5)),
        "sdk/transport-error",
    );
    worker.join().unwrap();
}

#[test]
fn truncated_body_is_transport_error() {
    let (url, worker) = serve_once(|mut stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"events\":")
            .unwrap();
    });
    assert_wrapped(
        &list_events(&url, Duration::from_secs(5)),
        "sdk/transport-error",
    );
    worker.join().unwrap();
}

#[test]
fn slow_response_is_timeout() {
    let (url, worker) = serve_once(|stream| {
        thread::sleep(Duration::from_millis(1500));
        drop(stream);
    });
    assert_wrapped(
        &list_events(&url, Duration::from_millis(200)),
        "sdk/timeout",
    );
    worker.join().unwrap();
}

#[test]
fn stalled_body_is_timeout() {
    let (url, worker) = serve_once(|mut stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{")
            .unwrap();
        thread::sleep(Duration::from_millis(1500));
    });
    assert_wrapped(
        &list_events(&url, Duration::from_millis(300)),
        "sdk/timeout",
    );
    worker.join().unwrap();
}

#[test]
fn tls_failure_is_transport_error() {
    // A plaintext server answering a TLS ClientHello fails the handshake.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("https://{}/v1", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    assert_wrapped(
        &list_events(&url, Duration::from_secs(5)),
        "sdk/transport-error",
    );
    worker.join().unwrap();
}

#[test]
fn refused_connection_is_transport_error() {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    assert_wrapped(
        &list_events(
            &format!("http://127.0.0.1:{port}/v1"),
            Duration::from_secs(5),
        ),
        "sdk/transport-error",
    );
}

#[test]
fn invalid_json_success_keeps_decode_cause() {
    let (url, worker) = serve_once(|mut stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n{nope")
            .unwrap();
    });
    let error = list_events(&url, Duration::from_secs(5));
    assert_wrapped(&error, "sdk/invalid-response");
    assert_eq!(error.status(), Some(200));
    worker.join().unwrap();
}

#[test]
fn truncated_cdn_stream_is_transport_error() {
    let (url, worker) = serve_once(|mut stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial")
            .unwrap();
    });
    let response = client(&url, Duration::from_secs(5))
        .cdn()
        .serve(CdnRequest {
            asset_identifier: "asset".into(),
            ..Default::default()
        })
        .unwrap();
    assert_wrapped(&response.bytes().unwrap_err(), "sdk/transport-error");
    worker.join().unwrap();
}

#[test]
fn stalled_cdn_stream_is_timeout() {
    let (url, worker) = serve_once(|mut stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial")
            .unwrap();
        thread::sleep(Duration::from_millis(1500));
    });
    let response = client(&url, Duration::from_millis(300))
        .cdn()
        .serve(CdnRequest {
            asset_identifier: "asset".into(),
            ..Default::default()
        })
        .unwrap();
    assert_wrapped(&response.bytes().unwrap_err(), "sdk/timeout");
    worker.join().unwrap();
}
