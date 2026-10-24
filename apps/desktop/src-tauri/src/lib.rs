//! Subspace Frequency for the desktop: a native window around the user's Subspace instance.
//!
//! The first run shows a local "Connect to Subspace" page; the chosen address is remembered in
//! the app's config directory and opened in the main window from then on. The instance's own
//! pages never get access to native commands (no remote capability is granted). Links to other
//! sites open in the system browser. Closing the window keeps the app in the tray.

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MAIN: &str = "main";

/// The instance the main window is allowed to stay on.
struct Server(Mutex<Option<Url>>);

#[derive(Serialize, Deserialize)]
struct Saved {
    url: String,
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("server.json"))
}

fn load_server(app: &AppHandle) -> Option<Url> {
    let raw = fs::read_to_string(config_file(app)?).ok()?;
    let saved: Saved = serde_json::from_str(&raw).ok()?;
    parse_server(&saved.url).ok()
}

/// An instance address: https, or http only for this machine. Reduced to its origin.
fn parse_server(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "That is not a valid address".to_string())?;
    let local = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("Use an https:// address".into()),
    }
    let mut origin = url.clone();
    origin.set_path("/");
    origin.set_query(None);
    origin.set_fragment(None);
    Ok(origin)
}

/// The bundled connect page (tauri://localhost on macOS/Linux, http://tauri.localhost on Windows).
fn connect_page() -> Url {
    let base = if cfg!(windows) { "http://tauri.localhost/index.html" } else { "tauri://localhost/index.html" };
    Url::parse(base).expect("static URL")
}

fn is_app_page(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn show(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn current_server(state: tauri::State<'_, Server>) -> Option<String> {
    state.0.lock().ok()?.as_ref().map(|u| u.as_str().trim_end_matches('/').to_string())
}

/// Called by the connect page: remember the instance and open it.
#[tauri::command]
fn set_server(app: AppHandle, state: tauri::State<'_, Server>, url: String) -> Result<(), String> {
    let server = parse_server(&url)?;
    let file = config_file(&app).ok_or("No config directory")?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let saved = serde_json::to_string(&Saved { url: server.to_string() }).map_err(|e| e.to_string())?;
    fs::write(&file, saved).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "Locked")? = Some(server.clone());
    if let Some(window) = main_window(&app) {
        window.navigate(server).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // A second launch focuses the running app instead of opening another copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![current_server, set_server])
        .setup(|app| {
            let handle = app.handle().clone();
            let server = load_server(&handle);
            app.manage(Server(Mutex::new(server.clone())));

            let start = match &server {
                Some(url) => WebviewUrl::External(url.clone()),
                None => WebviewUrl::App("index.html".into()),
            };
            let nav_handle = handle.clone();
            WebviewWindowBuilder::new(app, MAIN, start)
                .title("Subspace Frequency")
                .inner_size(1280.0, 800.0)
                .min_inner_size(940.0, 560.0)
                .background_color(tauri::window::Color(3, 3, 5, 255))
                .on_navigation(move |url| {
                    // Stay on the connect page or the chosen instance; anything else goes to the browser.
                    if is_app_page(url) || url.scheme() == "about" {
                        return true;
                    }
                    let current = nav_handle.state::<Server>().0.lock().ok().and_then(|s| s.clone());
                    if current.as_ref().is_some_and(|server| same_origin(server, url)) {
                        return true;
                    }
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;

            if let Some(window) = main_window(&handle) {
                let to_hide = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Like Discord: closing keeps Subspace running in the tray.
                        api.prevent_close();
                        let _ = to_hide.hide();
                    }
                });
            }

            let open = MenuItem::with_id(app, "open", "Open Subspace", true, None::<&str>)?;
            let change = MenuItem::with_id(app, "change", "Change Server", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Subspace", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &change, &PredefinedMenuItem::separator(app)?, &quit])?;
            TrayIconBuilder::with_id("tray")
                .tooltip("Subspace Frequency")
                .icon(app.default_window_icon().cloned().ok_or("missing icon")?)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "change" => {
                        show(app);
                        if let Some(window) = main_window(app) {
                            let _ = window.navigate(connect_page());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Subspace Frequency");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_and_local_http_only() {
        assert_eq!(parse_server("https://subspace.example.com/channels/@me?x=1").unwrap().as_str(), "https://subspace.example.com/");
        assert!(parse_server("http://localhost:5173").is_ok());
        assert!(parse_server("http://subspace.example.com").is_err());
        assert!(parse_server("file:///etc/passwd").is_err());
        assert!(parse_server("javascript:alert(1)").is_err());
        assert!(parse_server("not a url").is_err());
    }

    #[test]
    fn same_origin_compares_scheme_host_and_port() {
        let a = Url::parse("https://subspace.example.com/").unwrap();
        assert!(same_origin(&a, &Url::parse("https://subspace.example.com/channels/@me").unwrap()));
        assert!(same_origin(&a, &Url::parse("https://subspace.example.com:443/x").unwrap()));
        assert!(!same_origin(&a, &Url::parse("https://evil.example.com/").unwrap()));
        assert!(!same_origin(&a, &Url::parse("http://subspace.example.com/").unwrap()));
        assert!(!same_origin(&a, &Url::parse("https://subspace.example.com.evil.net/").unwrap()));
    }
}
