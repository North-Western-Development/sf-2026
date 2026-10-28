//! Updates for the desktop app itself, from its publisher (subspace.click/downloads/desktop),
//! signed with the publisher's updater key: an update that is not signed with it is refused.
//!
//! Like Discord: an update found while the app is starting is installed straight away. One found
//! later is downloaded quietly and waits for "Restart to Update" in the tray menu, so nobody is
//! pulled out of a call. Debug builds never update.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Manager, Wry,
};
use tauri_plugin_updater::{Update, UpdaterExt};

const RECHECK: Duration = Duration::from_secs(4 * 60 * 60);
/// Found this soon after launch, it installs at once instead of waiting for the tray.
const AT_STARTUP: Duration = Duration::from_secs(60);
pub const MENU_ID: &str = "update";

/// The tray menu (to add "Restart to Update" to) and a downloaded update waiting for it.
pub struct Updates {
    pub menu: Menu<Wry>,
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

impl Updates {
    pub fn new(menu: Menu<Wry>) -> Self {
        Updates { menu, ready: Mutex::new(None) }
    }
}

pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let launched = Instant::now();
        loop {
            match fetch(&app).await {
                Ok(Some((update, bytes))) => {
                    if launched.elapsed() < AT_STARTUP {
                        install(&app, update, bytes);
                    } else {
                        offer(&app, update, bytes);
                    }
                    return;
                }
                Ok(None) => {}
                Err(err) => eprintln!("[updates] {err}"),
            }
            tokio::time::sleep(RECHECK).await;
        }
    });
}

async fn fetch(app: &AppHandle) -> Result<Option<(Update, Vec<u8>)>, tauri_plugin_updater::Error> {
    let Some(update) = app.updater()?.check().await? else { return Ok(None) };
    let bytes = update.download(|_, _| {}, || {}).await?;
    Ok(Some((update, bytes)))
}

fn offer(app: &AppHandle, update: Update, bytes: Vec<u8>) {
    let Some(state) = app.try_state::<Updates>() else { return };
    let label = format!("Restart to Update ({})", update.version);
    if let Ok(item) = MenuItem::with_id(app, MENU_ID, label, true, None::<&str>) {
        let _ = state.menu.insert(&item, 0);
    }
    if let Ok(mut ready) = state.ready.lock() {
        *ready = Some((update, bytes));
    };
}

/// "Restart to Update" from the tray.
pub fn install_ready(app: &AppHandle) {
    let Some(state) = app.try_state::<Updates>() else { return };
    let ready = match state.ready.lock() {
        Ok(mut ready) => ready.take(),
        Err(_) => None,
    };
    if let Some((update, bytes)) = ready {
        install(app, update, bytes);
    }
}

fn install(app: &AppHandle, update: Update, bytes: Vec<u8>) {
    // On Windows the installer takes over from here and starts the new version when it is done.
    match update.install(bytes) {
        Ok(()) => app.restart(),
        Err(err) => eprintln!("[updates] install failed: {err}"),
    }
}
