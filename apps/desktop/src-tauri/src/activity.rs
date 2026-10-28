//! Activity status for the desktop app: which known game is running, and Rich Presence from games
//! that report their own over a local RPC server. The result is handed to the Subspace page in the
//! main window (`window.__subspaceActivity` and a `subspace:activity` event), which shares it as the
//! user's Activity Privacy allows. Nothing else about the processes on this PC leaves this module:
//! the page only ever learns the name of a game from the bundled list.
//!
//! RPC protocol (v1), for the SDK in packages/rich-presence and anyone writing their own client:
//!   connect   ws://127.0.0.1:<6473..6482>/?v=1&client_id=<Subspace application id>
//!   server -> {"evt":"READY","v":1}
//!   client -> {"cmd":"SET_ACTIVITY","nonce":"1","args":{"activity":{...}}}
//!   client -> {"cmd":"CLEAR_ACTIVITY","nonce":"2"}
//!   server -> {"nonce":"1","ok":true} | {"nonce":"1","ok":false,"error":"..."}
//! The activity ends when the connection closes. Browsers cannot connect (any request with an
//! Origin header is refused), so websites cannot set it.

use std::{
    collections::HashMap,
    ffi::OsStr,
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

/// Where state changes go: the main window's page in the app, a recorder in tests.
type Notify = Arc<dyn Fn(&ActivityHub) + Send + Sync>;
use tungstenite::{
    handshake::server::{ErrorResponse, Request, Response},
    http::StatusCode,
    protocol::WebSocketConfig,
    Message,
};

/// Where the RPC server listens: the first free port in this range, on loopback only.
pub const RPC_PORTS: std::ops::RangeInclusive<u16> = 6473..=6482;
const SCAN_EVERY: Duration = Duration::from_secs(15);
const MAX_CLIENTS: usize = 8;
const MAX_FRAME: usize = 16 * 1024;
/** A connection has this long to finish its handshake; after that it may sit idle as long as the game runs. */
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// At most this many commands per connection in RATE_WINDOW (each one reaches the page).
const RATE_LIMIT: usize = 20;
const RATE_WINDOW: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
struct Game {
    name: String,
    exe: Vec<String>,
}

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Detected {
    name: String,
    started_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcActivity {
    client_id: String,
    activity: Value,
}

#[derive(Default)]
struct Inner {
    detected: Option<Detected>,
    /// Connection id -> (when it last reported, what it reported).
    rpc: HashMap<u64, (u64, RpcActivity)>,
    clients: usize,
}

#[derive(Clone)]
pub struct ActivityHub {
    inner: Arc<Mutex<Inner>>,
    notify: Notify,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Executable name -> game name, lowercased. On Linux process names are cut to 15 characters.
fn game_index() -> HashMap<String, String> {
    let games: Vec<Game> = serde_json::from_str(include_str!("../../../../packages/constants/src/games.json")).expect("games.json");
    let mut index = HashMap::new();
    for game in games {
        for exe in game.exe {
            let exe = exe.to_lowercase();
            if cfg!(target_os = "linux") && exe.len() > 15 {
                index.insert(exe.chars().take(15).collect(), game.name.clone());
            }
            index.insert(exe, game.name.clone());
        }
    }
    index
}

fn match_game<'a>(index: &'a HashMap<String, String>, process_name: &OsStr) -> Option<&'a String> {
    index.get(&process_name.to_string_lossy().to_lowercase())
}

impl ActivityHub {
    pub fn start(app: &AppHandle) -> Self {
        let app = app.clone();
        let hub = ActivityHub::new(Arc::new(move |hub: &ActivityHub| hub.push_to(&app)));
        let scanner = hub.clone();
        thread::spawn(move || scanner.scan_forever());
        let server = hub.clone();
        thread::spawn(move || match bind(RPC_PORTS) {
            Some(listener) => server.serve_rpc(listener),
            None => eprintln!("[activity] no free port for Rich Presence in {:?}", RPC_PORTS),
        });
        hub
    }

    fn new(notify: Notify) -> Self {
        ActivityHub { inner: Arc::new(Mutex::new(Inner::default())), notify }
    }

    /// What the page sees: the detected game and the newest Rich Presence.
    fn snapshot(&self) -> Value {
        let inner = self.inner.lock().expect("activity state");
        let rpc = inner.rpc.values().max_by_key(|(at, _)| *at).map(|(_, a)| a.clone());
        json!({ "detected": inner.detected, "rpc": rpc })
    }

    /// Hand the current state on (to the page, after every change and every page load).
    pub fn push(&self) {
        (self.notify)(self);
    }

    fn push_to(&self, app: &AppHandle) {
        let Some(window) = app.get_webview_window(crate::MAIN) else { return };
        // serde_json output is a valid JavaScript literal.
        let script = format!(
            "window.__subspaceActivity={};window.dispatchEvent(new CustomEvent('subspace:activity',{{detail:window.__subspaceActivity}}));",
            self.snapshot()
        );
        let _ = window.eval(&script);
    }

    fn scan_forever(self) {
        let index = game_index();
        let mut system = System::new();
        loop {
            system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
            // The game that has been running longest wins when there are several.
            let found = system
                .processes()
                .values()
                .filter_map(|p| match_game(&index, p.name()).map(|name| (p.start_time(), name)))
                .min_by_key(|(start, _)| *start)
                .map(|(start, name)| Detected { name: name.clone(), started_at: start * 1000 });
            let changed = {
                let mut inner = self.inner.lock().expect("activity state");
                let changed = inner.detected != found;
                inner.detected = found;
                changed
            };
            if changed {
                self.push();
            }
            thread::sleep(SCAN_EVERY);
        }
    }

    fn serve_rpc(self, listener: TcpListener) {
        let next_id = Arc::new(AtomicU64::new(1));
        for stream in listener.incoming().flatten() {
            let id = next_id.fetch_add(1, Ordering::Relaxed);
            let hub = self.clone();
            thread::spawn(move || hub.client(id, stream));
        }
    }

    fn client(self, id: u64, stream: TcpStream) {
        {
            let mut inner = self.inner.lock().expect("activity state");
            if inner.clients >= MAX_CLIENTS {
                return;
            }
            inner.clients += 1;
        }
        let mut client_id = None;
        let callback = |req: &Request, res: Response| -> Result<Response, ErrorResponse> {
            match check_handshake(req) {
                Ok(app_id) => {
                    client_id = Some(app_id);
                    Ok(res)
                }
                Err((status, why)) => {
                    let mut err = ErrorResponse::new(Some(why.to_string()));
                    *err.status_mut() = status;
                    Err(err)
                }
            }
        };
        // A slot is taken before the handshake: a connection that never finishes it gives it back.
        let _ = stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
        // The protocol layer refuses anything far over MAX_FRAME before buffering it (a little over
        // still gets a "Message too large" answer from command(), and the connection stays).
        let mut config = WebSocketConfig::default();
        config.max_frame_size = Some(4 * MAX_FRAME);
        config.max_message_size = Some(4 * MAX_FRAME);
        if let Ok(mut ws) = tungstenite::accept_hdr_with_config(stream, callback, Some(config)) {
            let _ = ws.get_ref().set_read_timeout(None);
            let client_id = client_id.unwrap_or_default();
            let _ = ws.send(Message::text(json!({ "evt": "READY", "v": 1 }).to_string()));
            let mut recent: Vec<std::time::Instant> = Vec::new();
            loop {
                let text = match ws.read() {
                    Ok(Message::Text(t)) => t,
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => continue,
                    Ok(Message::Close(_)) | Ok(_) | Err(_) => break,
                };
                let now = std::time::Instant::now();
                recent.retain(|t| now.duration_since(*t) < RATE_WINDOW);
                let reply = if recent.len() >= RATE_LIMIT {
                    let nonce = serde_json::from_str::<Value>(text.as_str()).ok().and_then(|m| m.get("nonce").cloned()).unwrap_or(Value::Null);
                    json!({ "nonce": nonce, "ok": false, "error": "Too many updates" })
                } else {
                    recent.push(now);
                    self.command(id, &client_id, text.as_str())
                };
                if ws.send(Message::text(reply.to_string())).is_err() {
                    break;
                }
            }
        }
        let had_activity = {
            let mut inner = self.inner.lock().expect("activity state");
            inner.clients -= 1;
            inner.rpc.remove(&id).is_some()
        };
        if had_activity {
            self.push();
        }
    }

    fn command(&self, id: u64, client_id: &str, text: &str) -> Value {
        if text.len() > MAX_FRAME {
            return json!({ "ok": false, "error": "Message too large" });
        }
        let Ok(msg) = serde_json::from_str::<Value>(text) else {
            return json!({ "ok": false, "error": "Not JSON" });
        };
        let nonce = msg.get("nonce").cloned().unwrap_or(Value::Null);
        let result = match msg.get("cmd").and_then(Value::as_str) {
            Some("SET_ACTIVITY") => match msg.pointer("/args/activity") {
                Some(activity @ Value::Object(_)) => {
                    let entry = RpcActivity { client_id: client_id.to_string(), activity: activity.clone() };
                    self.inner.lock().expect("activity state").rpc.insert(id, (now_ms(), entry));
                    self.push();
                    Ok(())
                }
                Some(Value::Null) | None => self.clear(id),
                _ => Err("args.activity must be an object"),
            },
            Some("CLEAR_ACTIVITY") => self.clear(id),
            _ => Err("Unknown command"),
        };
        match result {
            Ok(()) => json!({ "nonce": nonce, "ok": true }),
            Err(error) => json!({ "nonce": nonce, "ok": false, "error": error }),
        }
    }

    fn clear(&self, id: u64) -> Result<(), &'static str> {
        if self.inner.lock().expect("activity state").rpc.remove(&id).is_some() {
            self.push();
        }
        Ok(())
    }
}

/// The first free loopback port in the range.
fn bind(ports: std::ops::RangeInclusive<u16>) -> Option<TcpListener> {
    ports.into_iter().find_map(|port| TcpListener::bind(("127.0.0.1", port)).ok())
}

/// Native clients only (no Origin header, which every browser sends) and a valid application id.
fn check_handshake(req: &Request) -> Result<String, (StatusCode, &'static str)> {
    if req.headers().contains_key("origin") {
        return Err((StatusCode::FORBIDDEN, "Browsers cannot set Rich Presence"));
    }
    let query = req.uri().query().unwrap_or("");
    let param = |key: &str| query.split('&').find_map(|kv| kv.strip_prefix(key).and_then(|v| v.strip_prefix('=')));
    if param("v") != Some("1") {
        return Err((StatusCode::BAD_REQUEST, "Unsupported protocol version"));
    }
    match param("client_id") {
        Some(id) if !id.is_empty() && id.len() <= 19 && id.bytes().all(|b| b.is_ascii_digit()) && !id.starts_with('0') => Ok(id.to_string()),
        _ => Err((StatusCode::BAD_REQUEST, "client_id must be a Subspace application id")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(uri: &str, origin: Option<&str>) -> Request {
        let mut builder = Request::builder().uri(uri);
        if let Some(origin) = origin {
            builder = builder.header("Origin", origin);
        }
        builder.body(()).unwrap()
    }

    #[test]
    fn handshake_needs_a_native_client_and_an_application_id() {
        assert_eq!(check_handshake(&request("/?v=1&client_id=1234567890", None)).unwrap(), "1234567890");
        assert!(check_handshake(&request("/?v=1&client_id=1234567890", Some("https://evil.example"))).is_err());
        assert!(check_handshake(&request("/?v=2&client_id=1234567890", None)).is_err());
        assert!(check_handshake(&request("/?v=1", None)).is_err());
        assert!(check_handshake(&request("/?v=1&client_id=abc", None)).is_err());
        assert!(check_handshake(&request("/?v=1&client_id=0123", None)).is_err());
    }

    /// A hub with its RPC server on a free port, recording every snapshot it hands on.
    fn test_hub() -> (ActivityHub, u16, Arc<Mutex<Vec<Value>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        let hub = ActivityHub::new(Arc::new(move |hub: &ActivityHub| record.lock().unwrap().push(hub.snapshot())));
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = hub.clone();
        thread::spawn(move || server.serve_rpc(listener));
        (hub, port, seen)
    }

    fn read_json(ws: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>) -> Value {
        serde_json::from_str(ws.read().unwrap().to_text().unwrap()).unwrap()
    }

    fn wait_for(seen: &Arc<Mutex<Vec<Value>>>, check: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..100 {
            if let Some(last) = seen.lock().unwrap().last().filter(|v| check(v)) {
                return last.clone();
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("no matching snapshot: {:?}", seen.lock().unwrap().last());
    }

    #[test]
    fn rpc_sets_activity_until_the_client_disconnects() {
        let (_hub, port, seen) = test_hub();
        let (mut ws, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}/?v=1&client_id=42")).unwrap();
        assert_eq!(read_json(&mut ws)["evt"], "READY");
        ws.send(Message::text(r#"{"cmd":"SET_ACTIVITY","nonce":"1","args":{"activity":{"details":"Ranked","state":"In a match"}}}"#)).unwrap();
        assert_eq!(read_json(&mut ws), json!({ "nonce": "1", "ok": true }));
        let snap = wait_for(&seen, |v| !v["rpc"].is_null());
        assert_eq!(snap["rpc"]["clientId"], "42");
        assert_eq!(snap["rpc"]["activity"]["details"], "Ranked");

        ws.send(Message::text(r#"{"cmd":"DANCE","nonce":"2"}"#)).unwrap();
        assert_eq!(read_json(&mut ws)["ok"], false);

        drop(ws);
        wait_for(&seen, |v| v["rpc"].is_null());
    }

    #[test]
    fn rpc_refuses_browsers() {
        let (_hub, port, _) = test_hub();
        let request = Request::builder()
            .uri(format!("ws://127.0.0.1:{port}/?v=1&client_id=42"))
            .header("Host", format!("127.0.0.1:{port}"))
            .header("Origin", "https://evil.example")
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key())
            .body(())
            .unwrap();
        assert!(tungstenite::connect(request).is_err());
    }

    #[test]
    fn games_match_by_executable_name_in_any_case() {
        let index = game_index();
        assert_eq!(match_game(&index, OsStr::new("CS2.exe")).map(String::as_str), Some("Counter-Strike 2"));
        assert_eq!(match_game(&index, OsStr::new("League of Legends.exe")).map(String::as_str), Some("League of Legends"));
        assert!(match_game(&index, OsStr::new("explorer.exe")).is_none());
    }

    #[test]
    fn bundled_game_list_has_no_duplicate_executables() {
        let games: Vec<Game> = serde_json::from_str(include_str!("../../../../packages/constants/src/games.json")).unwrap();
        let mut seen = std::collections::HashSet::new();
        for game in &games {
            for exe in &game.exe {
                assert!(seen.insert(exe.to_lowercase()), "{exe} is listed twice");
                assert_eq!(exe, &exe.to_lowercase(), "{exe} should be lowercase");
            }
        }
    }
}

/// Hardening tests for the local Rich Presence RPC server: the browser gate, client_id parsing,
/// frame limits, the connection cap and non-text / malformed input.
#[cfg(test)]
mod security_tests {
    use super::*;
    use std::io::{ErrorKind, Read, Write};

    fn request_with(uri: &str, origins: &[&str]) -> Request {
        let mut builder = Request::builder().uri(uri);
        for origin in origins {
            builder = builder.header("Origin", *origin);
        }
        builder.body(()).unwrap()
    }

    /// Some ids (non-ASCII, spaces) are not valid URI characters, so the http crate refuses them
    /// before check_handshake ever runs; those go over the wire to the real server instead.
    fn refuses_client_id(id: &str, port: u16) -> bool {
        let uri = format!("/?v=1&client_id={id}");
        match Request::builder().uri(uri.as_str()).body(()) {
            Ok(req) => check_handshake(&req).is_err_and(|e| e.0 == StatusCode::BAD_REQUEST),
            Err(_) => {
                let (_s, head) = raw_handshake(port, &format!("v=1&client_id={id}"), "");
                // An unparseable request line is dropped without a response: also a refusal.
                !head.starts_with("HTTP/1.1 101")
            }
        }
    }

    fn client_id(id: &str) -> Result<String, (StatusCode, &'static str)> {
        check_handshake(&request_with(&format!("/?v=1&client_id={id}"), &[]))
    }

    fn hub() -> (ActivityHub, u16, Arc<Mutex<Vec<Value>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        let hub = ActivityHub::new(Arc::new(move |hub: &ActivityHub| record.lock().unwrap().push(hub.snapshot())));
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = hub.clone();
        thread::spawn(move || server.serve_rpc(listener));
        (hub, port, seen)
    }

    fn wait_for(seen: &Arc<Mutex<Vec<Value>>>, check: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..150 {
            if let Some(last) = seen.lock().unwrap().last().filter(|v| check(v)) {
                return last.clone();
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("no matching snapshot: {:?}", seen.lock().unwrap().last());
    }

    fn clients(hub: &ActivityHub) -> usize {
        hub.inner.lock().unwrap().clients
    }

    fn wait_clients(hub: &ActivityHub, n: usize) {
        for _ in 0..150 {
            if clients(hub) == n {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("expected {n} clients, have {}", clients(hub));
    }

    /// Sends a raw HTTP upgrade request (header lines exactly as given) and returns the response head.
    fn raw_handshake(port: u16, query: &str, extra_headers: &str) -> (TcpStream, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(
            s,
            "GET /?{query} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\
             Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n{extra_headers}\r\n"
        )
        .unwrap();
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            match s.read(&mut byte) {
                Ok(1) => head.push(byte[0]),
                _ => break,
            }
        }
        (s, String::from_utf8_lossy(&head).into_owned())
    }

    /// A raw socket that has completed the WebSocket handshake and read READY.
    fn raw_ws(port: u16) -> TcpStream {
        let (mut s, head) = raw_handshake(port, "v=1&client_id=42", "");
        assert!(head.starts_with("HTTP/1.1 101"), "{head}");
        let (op, payload) = read_frame(&mut s).expect("READY");
        assert_eq!(op, 0x1);
        assert_eq!(serde_json::from_slice::<Value>(&payload).unwrap()["evt"], "READY");
        s
    }

    /// A masked client frame.
    fn frame(fin: bool, opcode: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![(if fin { 0x80 } else { 0 }) | opcode];
        let len = payload.len();
        if len < 126 {
            out.push(0x80 | len as u8);
        } else if len <= u16::MAX as usize {
            out.push(0x80 | 126);
            out.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            out.push(0x80 | 127);
            out.extend_from_slice(&(len as u64).to_be_bytes());
        }
        let mask = [0x11, 0x22, 0x33, 0x44];
        out.extend_from_slice(&mask);
        out.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        out
    }

    /// Only a masked header claiming `len` payload bytes, with no payload behind it.
    fn header_claiming(opcode: u8, len: u64) -> Vec<u8> {
        let mut out = vec![0x80 | opcode, 0x80 | 127];
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(&[1, 2, 3, 4]);
        out
    }

    /// Reads one (unmasked, server) frame. None when the connection is closed or errors.
    fn read_frame(s: &mut TcpStream) -> Option<(u8, Vec<u8>)> {
        let mut h = [0u8; 2];
        s.read_exact(&mut h).ok()?;
        let len = match h[1] & 0x7f {
            126 => {
                let mut b = [0u8; 2];
                s.read_exact(&mut b).ok()?;
                u16::from_be_bytes(b) as usize
            }
            127 => {
                let mut b = [0u8; 8];
                s.read_exact(&mut b).ok()?;
                u64::from_be_bytes(b) as usize
            }
            n => n as usize,
        };
        let mut payload = vec![0u8; len];
        s.read_exact(&mut payload).ok()?;
        Some((h[0] & 0x0f, payload))
    }

    /// Next text frame as JSON, skipping pongs. None if the connection ended.
    fn read_text(s: &mut TcpStream) -> Option<Value> {
        loop {
            let (op, payload) = read_frame(s)?;
            match op {
                0x1 => return Some(serde_json::from_slice(&payload).unwrap()),
                0xA => continue,
                _ => return None,
            }
        }
    }

    /// True when the server closes (EOF/reset, optionally after a close frame) within `within`.
    fn closed_within(s: &mut TcpStream, within: Duration) -> bool {
        s.set_read_timeout(Some(within)).unwrap();
        let mut buf = [0u8; 4096];
        loop {
            match s.read(&mut buf) {
                Ok(0) => return true,
                Ok(_) => continue,
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => return false,
                Err(_) => return true,
            }
        }
    }

    fn send(s: &mut TcpStream, text: &str) -> Option<Value> {
        s.write_all(&frame(true, 0x1, text.as_bytes())).ok()?;
        read_text(s)
    }

    const SET: &str = r#"{"cmd":"SET_ACTIVITY","nonce":"n","args":{"activity":{"details":"x"}}}"#;

    // ---------------------------------------------------------------- Origin

    /// Policy: there is no allow-list. Any Origin header at all (whatever its value) means a browser
    /// page, and is refused with 403. Only a request without one is a native client.
    #[test]
    fn every_origin_value_is_refused() {
        let origins = [
            // What our own pages would send: still refused, the page has no reason to use the RPC.
            "https://subspace.click",
            "tauri://localhost",
            "http://tauri.localhost",
            "http://127.0.0.1:6473",
            "http://localhost",
            // Case variants
            "HTTPS://SUBSPACE.CLICK",
            "https://SubSpace.Click",
            // Empty, opaque
            "",
            "null",
            " ",
            // Trailing slash, port, path
            "https://subspace.click/",
            "https://subspace.click:443",
            "https://subspace.click/path?x=1",
            // Look-alikes
            "https://subspace.click.evil.com",
            "https://evilsubspace.click",
            "https://subspace.click@evil.com",
            "file://",
            "chrome-extension://abcdefghijklmnop",
        ];
        for origin in origins {
            let err = check_handshake(&request_with("/?v=1&client_id=42", &[origin])).expect_err(origin);
            assert_eq!(err.0, StatusCode::FORBIDDEN, "{origin:?}");
        }
        // Several Origin headers
        let err = check_handshake(&request_with("/?v=1&client_id=42", &["null", "https://subspace.click"])).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
        // Origin is checked before anything else, so a browser learns nothing about the query rules.
        let err = check_handshake(&request_with("/?v=9", &["https://evil.example"])).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
        // Missing Origin: a native client.
        assert_eq!(check_handshake(&request_with("/?v=1&client_id=42", &[])).unwrap(), "42");
    }

    #[test]
    fn origin_header_name_in_any_case_is_refused_on_the_wire_and_frees_the_slot() {
        let (hub, port, _) = hub();
        for header in [
            "Origin: https://evil.example\r\n",
            "origin: https://evil.example\r\n",
            "ORIGIN: https://evil.example\r\n",
            "OrIgIn: null\r\n",
            "Origin:\r\n",
            "Origin: \r\n",
            "Origin: null\r\nOrigin: https://subspace.click\r\n",
            "Origin: https://subspace.click.evil.com\r\n",
        ] {
            let (_s, head) = raw_handshake(port, "v=1&client_id=42", header);
            assert!(head.starts_with("HTTP/1.1 403"), "{header:?} -> {head:?}");
        }
        // Refusals released their slots.
        wait_clients(&hub, 0);
        let (_s, head) = raw_handshake(port, "v=1&client_id=42", "");
        assert!(head.starts_with("HTTP/1.1 101"), "{head}");
    }

    // ---------------------------------------------------------------- client_id

    #[test]
    fn malformed_client_ids_are_refused() {
        let (_hub, port, _) = hub();
        for id in [
            "",
            "0",
            "00",
            "0123",
            "00000000000000000001",
            "12345678901234567890",  // 20 digits
            "18446744073709551616",  // u64::MAX + 1
            "99999999999999999999999",
            "\u{0663}",              // Arabic-Indic three
            "1\u{0663}",
            "\u{FF11}",              // fullwidth one
            "\u{FF11}\u{FF12}",
            "+1",
            "-1",
            " 1",
            "1 ",
            "1\t",
            "%31",                   // not percent-decoded: a literal '%'
            "1%00",
            "1.0",
            "1e3",
            "0x1",
            "1,2",
            "abc",
        ] {
            assert!(refuses_client_id(id, port), "{id:?} was accepted");
        }
        // Missing, or a different key that merely ends in client_id / v.
        assert!(check_handshake(&request_with("/?v=1", &[])).is_err());
        assert!(check_handshake(&request_with("/?v=1&xclient_id=5", &[])).is_err());
        assert!(check_handshake(&request_with("/?v=1&client_id", &[])).is_err());
        assert!(check_handshake(&request_with("/?v=1&client_id=", &[])).is_err());
        assert!(check_handshake(&request_with("/?vv=1&client_id=5", &[])).is_err());
        for v in ["01", "+1", "", "1.0", "1%20", "%31"] {
            assert!(check_handshake(&request_with(&format!("/?v={v}&client_id=5"), &[])).is_err(), "v={v:?}");
        }
    }

    #[test]
    fn accepted_client_ids_are_plain_u64_values() {
        for id in ["1", "9", "42", "1234567890123456789", "9223372036854775807", "9999999999999999999"] {
            let got = client_id(id).unwrap();
            assert_eq!(got, id);
            // Everything accepted round-trips as a u64 with no leading zeros.
            assert_eq!(got.parse::<u64>().unwrap().to_string(), got);
        }
        // Duplicate parameters: the first wins, and it is still validated.
        assert_eq!(check_handshake(&request_with("/?v=1&client_id=7&client_id=8", &[])).unwrap(), "7");
        assert!(check_handshake(&request_with("/?v=1&client_id=x&client_id=8", &[])).is_err());
    }

    // ---------------------------------------------------------------- frame sizes

    #[test]
    fn text_over_max_frame_is_answered_with_an_error_and_the_connection_survives() {
        let (_hub, port, _) = hub();
        let mut s = raw_ws(port);
        let big = format!(r#"{{"cmd":"SET_ACTIVITY","nonce":"1","args":{{"activity":{{"d":"{}"}}}}}}"#, "a".repeat(MAX_FRAME));
        assert!(big.len() > MAX_FRAME);
        assert_eq!(send(&mut s, &big).unwrap(), json!({ "ok": false, "error": "Message too large" }));
        // Exactly MAX_FRAME bytes is allowed.
        let head = r#"{"cmd":"SET_ACTIVITY","nonce":"2","args":{"activity":{"d":""#;
        let tail = r#""}}}"#;
        let exact = format!("{head}{}{tail}", "a".repeat(MAX_FRAME - head.len() - tail.len()));
        assert_eq!(exact.len(), MAX_FRAME);
        assert_eq!(send(&mut s, &exact).unwrap(), json!({ "nonce": "2", "ok": true }));
    }

    #[test]
    fn frame_header_claiming_4gb_is_refused_at_once() {
        let (hub, port, _) = hub();
        for len in [u32::MAX as u64 + 1, u64::MAX >> 1, u64::MAX] {
            let mut s = raw_ws(port);
            s.write_all(&header_claiming(0x1, len)).unwrap();
            assert!(closed_within(&mut s, Duration::from_secs(3)), "len {len} kept the connection open");
        }
        wait_clients(&hub, 0);
    }

    // Fixed (was a security bug): MAX_FRAME (16 KiB) is only checked after tungstenite has read the whole message.
    // The server uses tungstenite's default WebSocketConfig (max_frame_size 16 MiB, max_message_size
    // 64 MiB) and tungstenite reserves the full claimed frame length as soon as it parses a header.
    // So a header claiming 16 MiB with no payload makes the server reserve 16 MiB and wait forever.
    #[test]
    fn frame_header_far_above_max_frame_is_refused_at_once() {
        let (_hub, port, _) = hub();
        let mut s = raw_ws(port);
        s.write_all(&header_claiming(0x1, 16 << 20)).unwrap();
        assert!(closed_within(&mut s, Duration::from_secs(3)), "server is waiting for a 16 MiB frame");
    }

    // Fixed (was a security bug): a fragmented message far above MAX_FRAME (here 4 MiB, up to 64 MiB allowed) is
    // buffered in full before the 16 KiB check runs; 8 clients can pin ~512 MiB.
    #[test]
    fn message_far_above_max_frame_is_not_buffered() {
        let (_hub, port, _) = hub();
        let mut s = raw_ws(port);
        let chunk = vec![b'a'; 1 << 20];
        let mut closed_early = false;
        for i in 0..4 {
            let (fin, op) = (i == 3, if i == 0 { 0x1 } else { 0x0 });
            if s.write_all(&frame(fin, op, &chunk)).is_err() {
                closed_early = true;
                break;
            }
        }
        // Wanted: the server drops the connection once the message passes MAX_FRAME, instead of
        // reading all of it and answering {"error":"Message too large"}.
        if !closed_early {
            closed_early = read_text(&mut s).is_none();
        }
        assert!(closed_early, "server buffered a 4 MiB message");
    }

    // ---------------------------------------------------------------- connection cap

    #[test]
    fn ninth_client_is_refused_until_a_slot_frees() {
        let (hub, port, _) = hub();
        let mut open: Vec<TcpStream> = (0..MAX_CLIENTS).map(|_| raw_ws(port)).collect();
        wait_clients(&hub, MAX_CLIENTS);
        let (_s, head) = raw_handshake(port, "v=1&client_id=42", "");
        assert!(head.is_empty(), "ninth client got {head:?}");
        assert_eq!(clients(&hub), MAX_CLIENTS);
        drop(open.pop());
        wait_clients(&hub, MAX_CLIENTS - 1);
        let _ninth = raw_ws(port);
    }

    // Fixed (was a security bug): no handshake (or read) timeout. A slot is taken before the handshake, so any
    // local process can open MAX_CLIENTS idle TCP connections and lock every game out of Rich
    // Presence for as long as it likes.
    #[test]
    fn idle_connections_do_not_hold_slots_forever() {
        let (_hub, port, _) = hub();
        let _idle: Vec<TcpStream> = (0..MAX_CLIENTS).map(|_| TcpStream::connect(("127.0.0.1", port)).unwrap()).collect();
        thread::sleep(Duration::from_secs(12));
        let (_s, head) = raw_handshake(port, "v=1&client_id=42", "");
        assert!(head.starts_with("HTTP/1.1 101"), "a game was locked out: {head:?}");
    }

    #[test]
    fn refused_handshakes_never_count_toward_the_cap() {
        let (hub, port, _) = hub();
        for _ in 0..(MAX_CLIENTS * 3) {
            let (_s, head) = raw_handshake(port, "v=1&client_id=0", "");
            assert!(head.starts_with("HTTP/1.1 400"), "{head}");
        }
        wait_clients(&hub, 0);
    }

    // ---------------------------------------------------------------- non-text frames

    #[test]
    fn binary_frame_closes_the_connection_and_ends_the_activity() {
        let (hub, port, seen) = hub();
        let mut s = raw_ws(port);
        assert_eq!(send(&mut s, SET).unwrap()["ok"], true);
        wait_for(&seen, |v| !v["rpc"].is_null());
        s.write_all(&frame(true, 0x2, SET.as_bytes())).unwrap();
        assert!(closed_within(&mut s, Duration::from_secs(3)));
        wait_for(&seen, |v| v["rpc"].is_null());
        wait_clients(&hub, 0);
    }

    #[test]
    fn close_frame_ends_the_activity() {
        let (hub, port, seen) = hub();
        let mut s = raw_ws(port);
        assert_eq!(send(&mut s, SET).unwrap()["ok"], true);
        wait_for(&seen, |v| !v["rpc"].is_null());
        s.write_all(&frame(true, 0x8, &1000u16.to_be_bytes())).unwrap();
        assert!(closed_within(&mut s, Duration::from_secs(3)));
        wait_for(&seen, |v| v["rpc"].is_null());
        wait_clients(&hub, 0);
    }

    #[test]
    fn ping_flood_is_harmless() {
        let (hub, port, _) = hub();
        let mut s = raw_ws(port);
        let mut burst = Vec::new();
        for i in 0..5000u32 {
            burst.extend(frame(true, 0x9, &i.to_be_bytes()));
        }
        s.write_all(&burst).unwrap();
        // Still serving commands afterwards (pongs are skipped by read_text).
        assert_eq!(send(&mut s, SET).unwrap()["ok"], true);
        assert_eq!(hub.inner.lock().unwrap().rpc.len(), 1);
        // Oversized ping (control frames are capped at 125 bytes) is a protocol error.
        s.write_all(&frame(true, 0x9, &[0u8; 200])).unwrap();
        assert!(closed_within(&mut s, Duration::from_secs(3)));
    }

    #[test]
    fn protocol_violations_close_the_connection() {
        let (hub, port, _) = hub();
        let mut cases: Vec<(&str, Vec<u8>)> = vec![
            ("reserved data opcode", frame(true, 0x3, b"{}")),
            ("reserved control opcode", frame(true, 0xB, b"")),
            ("invalid UTF-8 text", frame(true, 0x1, &[0xff, 0xfe, 0xfd])),
            ("continuation with nothing to continue", frame(true, 0x0, b"{}")),
            ("fragmented ping", frame(false, 0x9, b"")),
        ];
        // Unmasked client frame
        cases.push(("unmasked frame", vec![0x81, 0x02, b'{', b'}']));
        // RSV bits set without an extension
        let mut rsv = frame(true, 0x1, b"{}");
        rsv[0] |= 0x40;
        cases.push(("RSV1 set", rsv));
        for (what, bytes) in cases {
            let mut s = raw_ws(port);
            s.write_all(&bytes).unwrap();
            assert!(closed_within(&mut s, Duration::from_secs(3)), "{what} kept the connection open");
        }
        wait_clients(&hub, 0);
    }

    // ---------------------------------------------------------------- malformed JSON

    #[test]
    fn malformed_commands_get_errors_and_change_nothing() {
        let (hub, _, seen) = hub();
        let deep = format!("{}{}", "[".repeat(10_000), "]".repeat(10_000));
        let deep_activity = format!(
            r#"{{"cmd":"SET_ACTIVITY","args":{{"activity":{{"a":{}{}}}}}}}"#,
            "[".repeat(5_000),
            "]".repeat(5_000)
        );
        assert!(deep_activity.len() <= MAX_FRAME);
        let cases: Vec<(String, &str)> = vec![
            ("".into(), "Not JSON"),
            ("not json".into(), "Not JSON"),
            ("{".into(), "Not JSON"),
            ("\u{0000}".into(), "Not JSON"),
            (deep, "Message too large"),
            (deep_activity, "Not JSON"), // serde_json's recursion limit, not a stack overflow
            ("[]".into(), "Unknown command"),
            ("null".into(), "Unknown command"),
            ("42".into(), "Unknown command"),
            (r#"{"cmd":1}"#.into(), "Unknown command"),
            (r#"{"cmd":"set_activity","args":{"activity":{}}}"#.into(), "Unknown command"),
            (r#"{"cmd":"SET_ACTIVITY ","args":{"activity":{}}}"#.into(), "Unknown command"),
            (r#"{"CMD":"SET_ACTIVITY","args":{"activity":{}}}"#.into(), "Unknown command"),
            (r#"{"cmd":"SET_ACTIVITY","args":{"activity":"x"}}"#.into(), "args.activity must be an object"),
            (r#"{"cmd":"SET_ACTIVITY","args":{"activity":[1]}}"#.into(), "args.activity must be an object"),
            (r#"{"cmd":"SET_ACTIVITY","args":{"activity":1}}"#.into(), "args.activity must be an object"),
        ];
        for (text, error) in &cases {
            let reply = hub.command(1, "42", text);
            assert_eq!(reply["ok"], false, "{:.60}", text);
            assert_eq!(reply["error"], *error, "{:.60}", text);
        }
        assert!(hub.inner.lock().unwrap().rpc.is_empty());
        assert!(seen.lock().unwrap().is_empty(), "malformed input must not push to the page");
        // The nonce is echoed back as given, whatever its type.
        let reply = hub.command(1, "42", r#"{"cmd":"NOPE","nonce":{"x":[1]}}"#);
        assert_eq!(reply["nonce"], json!({ "x": [1] }));
        // Duplicate keys: serde_json keeps the last one.
        assert_eq!(hub.command(1, "42", r#"{"cmd":"SET_ACTIVITY","cmd":"NOPE","args":{"activity":{}}}"#)["ok"], false);
    }

    #[test]
    fn a_client_can_only_clear_its_own_activity() {
        let (hub, _, _) = hub();
        assert_eq!(hub.command(1, "42", SET)["ok"], true);
        assert_eq!(hub.command(2, "43", r#"{"cmd":"CLEAR_ACTIVITY"}"#)["ok"], true);
        assert!(hub.inner.lock().unwrap().rpc.contains_key(&1));
        assert_eq!(hub.command(2, "43", r#"{"cmd":"SET_ACTIVITY","args":{"activity":null}}"#)["ok"], true);
        assert!(hub.inner.lock().unwrap().rpc.contains_key(&1));
    }

    #[test]
    fn page_script_is_a_single_statement_for_hostile_activity_text() {
        let (hub, _, _) = hub();
        let hostile = r#"{"cmd":"SET_ACTIVITY","args":{"activity":{"details":"\";alert(1);//</script>  '`${x}"}}}"#;
        assert_eq!(hub.command(1, "42", hostile)["ok"], true);
        let snap = hub.snapshot().to_string();
        // The serialized snapshot round-trips, so the injected text stays inside one string literal.
        let back: Value = serde_json::from_str(&snap).unwrap();
        assert_eq!(back["rpc"]["activity"]["details"], "\";alert(1);//</script>\u{2028}\u{2029}'`${x}");
        // serde_json leaves U+2028/U+2029 raw; legal inside JS string literals since ES2019 (WebView2/WebKit).
    }
}
