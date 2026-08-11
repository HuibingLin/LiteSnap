use std::{
    borrow::Cow,
    fs,
    io::Cursor,
    path::PathBuf,
    process::Command,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use arboard::{Clipboard, ImageData};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use directories::BaseDirs;
use image::{
    ColorType, ImageEncoder, RgbaImage,
    codecs::png::{CompressionType, FilterType as PngFilterType, PngEncoder},
    imageops::{self, FilterType as ResizeFilter},
};
use screenshots::Screen;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use tauri::Monitor;
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const DEFAULT_SHORTCUT_MAC: &str = "Alt+A";
const DEFAULT_SHORTCUT_WINDOWS: &str = "Control+Shift+A";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    language: String,
    capture_shortcut: String,
    #[serde(default = "default_launch_at_startup")]
    launch_at_startup: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "en".into(),
            capture_shortcut: if cfg!(target_os = "windows") {
                DEFAULT_SHORTCUT_WINDOWS.into()
            } else {
                DEFAULT_SHORTCUT_MAC.into()
            },
            launch_at_startup: default_launch_at_startup(),
        }
    }
}

fn default_launch_at_startup() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone)]
struct CaptureData {
    png: Vec<u8>,
    bounds: Rect,
    image_width: u32,
    image_height: u32,
    scale_factor: f64,
    screen_id: u32,
    #[cfg(target_os = "windows")]
    physical_origin_x: i32,
    #[cfg(target_os = "windows")]
    physical_origin_y: i32,
    #[cfg(target_os = "windows")]
    physical_width: u32,
    #[cfg(target_os = "windows")]
    physical_height: u32,
}

struct AppState {
    settings: Mutex<AppSettings>,
    capture: Mutex<Option<CaptureData>>,
    pin_data: Mutex<Option<Vec<u8>>>,
    registered_shortcut: Mutex<Option<String>>,
    shortcut_suspended: AtomicBool,
    scroll_rect: Mutex<Option<Rect>>,
    scroll_pipeline: Mutex<Option<ScrollPipeline>>,
    scroll_generation: AtomicU64,
    scroll_control_ready: AtomicBool,
    screen_permission_requested: AtomicBool,
    capture_in_progress: AtomicBool,
}

#[derive(Debug)]
enum StartCaptureError {
    PermissionPrompted,
    PermissionDenied,
    PermissionRestartRequired,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FullScreenshot {
    base64: String,
    display_width: f64,
    display_height: f64,
    image_width: u32,
    image_height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetShortcutResult {
    ok: bool,
    settings: AppSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct ScrollPreview {
    base64: String,
    width: u32,
    height: u32,
}

struct NativeScrollSession {
    width: u32,
    viewport_height: u32,
    total_height: u32,
    last_frame: RgbaImage,
    segments: Vec<RgbaImage>,
    preview_width: u32,
    preview_height: u32,
    preview_segments: Vec<RgbaImage>,
    last_observed_scrollbar: Option<VerticalScrollbar>,
    pending_scroll_delta: u32,
    last_scroll_delta: Option<u32>,
}

enum ScrollFrameMessage {
    Frame(RgbaImage),
    Finish,
    Cancel,
}

struct ScrollPipeline {
    frames: SyncSender<ScrollFrameMessage>,
    finished: Receiver<NativeScrollSession>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrollResult {
    base64: String,
    image_width: u32,
    image_height: u32,
}

fn settings_path() -> PathBuf {
    // Electron's `app.getPath("userData")` used this location. Keeping it
    // makes the Tauri migration retain the user's language and shortcut.
    BaseDirs::new()
        .map(|dirs| dirs.config_dir().join("LiteSnap").join("settings.json"))
        .unwrap_or_else(|| PathBuf::from("settings.json"))
}

fn default_shortcut() -> &'static str {
    if cfg!(target_os = "windows") {
        DEFAULT_SHORTCUT_WINDOWS
    } else {
        DEFAULT_SHORTCUT_MAC
    }
}

fn normalize_shortcut(raw: &str) -> String {
    raw.split('+')
        .filter(|part| !part.is_empty())
        .map(|part| match part {
            "Cmd" | "Meta" | "Super" => "Command".into(),
            "Ctrl" => "Control".into(),
            "Option" => "Alt".into(),
            value if value.len() == 1 => value.to_uppercase(),
            value => value.into(),
        })
        .collect::<Vec<String>>()
        .join("+")
}

fn is_valid_shortcut(value: &str) -> bool {
    let parts = value
        .split('+')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.len() < 2 {
        return false;
    }
    parts[..parts.len() - 1].iter().all(|part| {
        matches!(
            *part,
            "Command" | "Control" | "Alt" | "Shift" | "CommandOrControl" | "Meta" | "Super"
        )
    })
}

fn tauri_shortcut(value: &str) -> String {
    value
        .replace("CommandOrControl", "CmdOrCtrl")
        .replace("Command", "Cmd")
}

fn load_settings() -> AppSettings {
    let Ok(data) = fs::read_to_string(settings_path()) else {
        return AppSettings::default();
    };
    let Ok(mut settings) = serde_json::from_str::<AppSettings>(&data) else {
        return AppSettings::default();
    };
    if !matches!(settings.language.as_str(), "en" | "zh" | "zh-TW") {
        settings.language = "en".into();
    }
    settings.capture_shortcut = normalize_shortcut(&settings.capture_shortcut);
    if !is_valid_shortcut(&settings.capture_shortcut) {
        settings.capture_shortcut = default_shortcut().into();
    }
    settings
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn png_bytes(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, PngFilterType::Adaptive)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgba8,
        )
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn image_is_blank(image: &RgbaImage) -> bool {
    if image.width() < 2 || image.height() < 2 {
        return true;
    }
    let first = image.get_pixel(0, 0);
    let step_x = (image.width() / 30).max(1);
    let step_y = (image.height() / 20).max(1);
    let mut varied = 0;
    for y in (0..image.height()).step_by(step_y as usize) {
        for x in (0..image.width()).step_by(step_x as usize) {
            let pixel = image.get_pixel(x, y);
            let difference = (pixel[0] as i16 - first[0] as i16).unsigned_abs()
                + (pixel[1] as i16 - first[1] as i16).unsigned_abs()
                + (pixel[2] as i16 - first[2] as i16).unsigned_abs();
            if difference > 36 {
                varied += 1;
                if varied > 6 {
                    return false;
                }
            }
        }
    }
    true
}

fn active_screen(app: &AppHandle) -> Result<Screen, String> {
    let raw_cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let screens = Screen::all().map_err(|error| error.to_string())?;
    // `screenshots` reports CoreGraphics display bounds in logical desktop
    // points on macOS. Tao's global cursor is a physical position expressed
    // using the primary display scale, so normalize it with the same native
    // scale before doing any hit-testing. On Windows/Linux both APIs use the
    // physical desktop coordinate space and no conversion is needed.
    #[cfg(target_os = "macos")]
    let cursor = {
        let scale = screens
            .iter()
            .find(|screen| screen.display_info.is_primary)
            .map(|screen| screen.display_info.scale_factor as f64)
            .filter(|scale| scale.is_finite() && *scale > 0.0)
            .unwrap_or(1.0);
        (raw_cursor.x / scale, raw_cursor.y / scale)
    };
    #[cfg(not(target_os = "macos"))]
    let cursor = (raw_cursor.x, raw_cursor.y);

    // Prefer the Tauri monitor geometry when available. This avoids the
    // screenshots crate's `from_point` helper, which can interpret a mixed-DPI
    // cursor using a different coordinate space and occasionally select the
    // adjacent display. Geometry matching is tolerant of either logical or
    // physical monitor coordinates because Windows reports the two depending
    // on the process DPI-awareness mode.
    let monitor = app
        .monitor_from_point(cursor.0, cursor.1)
        .map_err(|error| error.to_string())?;
    let monitor_geometry = monitor.map(|monitor| {
        let scale = monitor.scale_factor().max(1.0);
        let position = monitor.position();
        let size = monitor.size();
        (
            Rect {
                x: position.x as f64 / scale,
                y: position.y as f64 / scale,
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
            },
            Rect {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
            },
        )
    });
    #[cfg(target_os = "windows")]
    let selected = monitor_geometry
        .as_ref()
        .and_then(|(logical, physical)| {
            screens
                .iter()
                .min_by(|left, right| {
                    screen_geometry_score(left, logical, physical)
                        .total_cmp(&screen_geometry_score(right, logical, physical))
                })
                .copied()
        })
        .or_else(|| select_screen_containing_point(&screens, cursor));
    #[cfg(not(target_os = "windows"))]
    let selected = select_screen_containing_point(&screens, cursor).or_else(|| {
        monitor_geometry.as_ref().and_then(|(logical, physical)| {
            screens
                .iter()
                .min_by(|left, right| {
                    screen_geometry_score(left, logical, physical)
                        .total_cmp(&screen_geometry_score(right, logical, physical))
                })
                .copied()
        })
    });
    let selected = selected
        // A cursor can be sampled on the one-pixel seam between two displays.
        // Choose the nearest display rather than silently falling back to the
        // first enumerated display (which is often the primary screen).
        .or_else(|| nearest_screen(&screens, cursor));
    selected.ok_or_else(|| "No screen is available".into())
}

fn screen_rect(screen: &Screen) -> Rect {
    let info = screen.display_info;
    Rect {
        x: info.x as f64,
        y: info.y as f64,
        width: info.width as f64,
        height: info.height as f64,
    }
}

fn rect_distance_squared(rect: Rect, point: (f64, f64)) -> f64 {
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    let dx = if point.0 < rect.x {
        rect.x - point.0
    } else if point.0 > right {
        point.0 - right
    } else {
        0.0
    };
    let dy = if point.1 < rect.y {
        rect.y - point.1
    } else if point.1 > bottom {
        point.1 - bottom
    } else {
        0.0
    };
    dx * dx + dy * dy
}

fn select_screen_containing_point(screens: &[Screen], point: (f64, f64)) -> Option<Screen> {
    screens
        .iter()
        .filter(|screen| {
            let rect = screen_rect(screen);
            // Use half-open bounds so a cursor exactly on a shared edge is
            // assigned to one monitor deterministically instead of making two
            // displays look like one oversized capture surface.
            point.0 >= rect.x
                && point.0 < rect.x + rect.width
                && point.1 >= rect.y
                && point.1 < rect.y + rect.height
        })
        // If two coordinate spaces overlap at a mixed-DPI boundary, prefer the
        // smallest matching display so the cursor never leaks into its sibling.
        .min_by_key(|screen| {
            let rect = screen_rect(screen);
            (rect.width * rect.height) as u64
        })
        .copied()
}

fn nearest_screen(screens: &[Screen], point: (f64, f64)) -> Option<Screen> {
    screens
        .iter()
        .min_by(|left, right| {
            rect_distance_squared(screen_rect(left), point)
                .total_cmp(&rect_distance_squared(screen_rect(right), point))
        })
        .copied()
}

fn screen_geometry_score(screen: &Screen, logical: &Rect, physical: &Rect) -> f64 {
    let info = screen_rect(screen);
    let score = |expected: &Rect| {
        let position = (info.x - expected.x).abs() + (info.y - expected.y).abs();
        let size = (info.width - expected.width).abs() + (info.height - expected.height).abs();
        position + size
    };
    score(logical).min(score(physical))
}

#[cfg(target_os = "windows")]
fn monitor_screen_score(screen: &Screen, monitor: &Monitor) -> f64 {
    let scale = monitor.scale_factor().max(1.0);
    let position = monitor.position();
    let size = monitor.size();
    let logical = Rect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    };
    let physical = Rect {
        x: position.x as f64,
        y: position.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    };
    screen_geometry_score(screen, &logical, &physical)
}

fn capture_active_screen(app: &AppHandle) -> Result<CaptureData, String> {
    let screen = active_screen(app)?;
    let info = screen.display_info;
    #[cfg(target_os = "windows")]
    let (image, bounds, physical_origin_x, physical_origin_y) = {
        // Tao/Tauri makes the process Per-Monitor-V2 DPI aware. `screenshots`
        // also multiplies DisplayInfo dimensions by its detected scale factor,
        // which can scale an already-physical Windows desktop a second time.
        // Capture the monitor's real backing-pixel size directly instead.
        // Resolve the native monitor from the already-selected `Screen`, not
        // from a second cursor sample. The cursor can cross a display while
        // the capture worker is starting; mixing the first screen with the
        // second monitor's size was the source of occasional cross-display
        // captures on Windows.
        let monitor = app
            .available_monitors()
            .map_err(|error| error.to_string())?
            .into_iter()
            .min_by(|left, right| {
                monitor_screen_score(&screen, left).total_cmp(&monitor_screen_score(&screen, right))
            })
            .or_else(|| app.primary_monitor().ok().flatten())
            .ok_or_else(|| "No Windows monitor is available".to_string())?;
        let physical_size = monitor.size();
        let scale = monitor.scale_factor().max(1.0);
        let image = screen
            .capture_area_ignore_area_check(0, 0, physical_size.width, physical_size.height)
            .map_err(|error| error.to_string())?;
        let position = monitor.position();
        (
            image,
            Rect {
                x: position.x as f64 / scale,
                y: position.y as f64 / scale,
                width: physical_size.width as f64 / scale,
                height: physical_size.height as f64 / scale,
            },
            position.x,
            position.y,
        )
    };
    #[cfg(not(target_os = "windows"))]
    let (image, bounds) = {
        let image = screen.capture().map_err(|error| error.to_string())?;
        (
            image,
            Rect {
                x: info.x as f64,
                y: info.y as f64,
                width: info.width as f64,
                height: info.height as f64,
            },
        )
    };
    if image_is_blank(&image) {
        return Err("Screen capture returned a blank image (permission denied?)".into());
    }
    let (image_width, image_height) = image.dimensions();
    let scale_factor = image_width as f64 / bounds.width.max(1.0);
    Ok(CaptureData {
        png: png_bytes(&image)?,
        bounds,
        image_width,
        image_height,
        scale_factor,
        screen_id: info.id,
        #[cfg(target_os = "windows")]
        physical_origin_x,
        #[cfg(target_os = "windows")]
        physical_origin_y,
        #[cfg(target_os = "windows")]
        physical_width: image_width,
        #[cfg(target_os = "windows")]
        physical_height: image_height,
    })
}

fn capture_region_image(app: &AppHandle, rect: Rect) -> Result<RgbaImage, String> {
    let previous = app
        .state::<AppState>()
        .capture
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No capture display is available".to_string())?;
    let screen = Screen::all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|screen| screen.display_info.id == previous.screen_id)
        .ok_or_else(|| "The capture display is no longer available".to_string())?;
    // Capture only the selected logical region. The screenshots crate returns
    // its native backing pixels (Retina on macOS, DPI-scaled pixels on Windows),
    // so this is both substantially faster than capturing the full display and
    // preserves every source pixel without an intermediate resize.
    let x = rect.x.floor().max(0.0) as i32;
    let y = rect.y.floor().max(0.0) as i32;
    let right = (rect.x + rect.width)
        .ceil()
        .min(previous.bounds.width)
        .max(x as f64 + 1.0) as u32;
    let bottom = (rect.y + rect.height)
        .ceil()
        .min(previous.bounds.height)
        .max(y as f64 + 1.0) as u32;
    let width = right.saturating_sub(x as u32).max(1);
    let height = bottom.saturating_sub(y as u32).max(1);
    #[cfg(target_os = "windows")]
    let image = {
        let scale = previous.scale_factor.max(1.0);
        let physical_x = (x as f64 * scale).floor() as i32;
        let physical_y = (y as f64 * scale).floor() as i32;
        let physical_right = ((x as f64 + width as f64) * scale).ceil() as u32;
        let physical_bottom = ((y as f64 + height as f64) * scale).ceil() as u32;
        screen
            .capture_area_ignore_area_check(
                physical_x,
                physical_y,
                physical_right
                    .saturating_sub(physical_x.max(0) as u32)
                    .max(1),
                physical_bottom
                    .saturating_sub(physical_y.max(0) as u32)
                    .max(1),
            )
            .map_err(|error| error.to_string())?
    };
    #[cfg(not(target_os = "windows"))]
    let image = screen
        .capture_area(x, y, width, height)
        .map_err(|error| error.to_string())?;
    Ok(image)
}

const SCROLL_MIN_NEW_CONTENT: u32 = 4;
const SCROLL_MIN_OVERLAP: u32 = 12;
const SCROLL_MAX_MATCH_SCORE: f64 = 0.10;
const SCROLL_MAX_INFORMATIVE_SCORE: f64 = 0.16;
const SCROLL_DUPLICATE_SCORE: f64 = 0.018;
const SCROLL_DUPLICATE_INFORMATIVE_SCORE: f64 = 0.04;
const SCROLL_MIN_CONFIDENT_COLUMNS: usize = 3;
// Raw captures are lossless RGBA frames. Keep enough short-term headroom for
// Windows GDI capture and the native matcher to run at different speeds, while
// remaining memory-bounded for Retina/4K selections.
const SCROLL_FRAME_BUFFER_BYTES: usize = 256 * 1024 * 1024;
const SCROLL_IDLE_REFRESH_INTERVAL: Duration = Duration::from_millis(300);

#[derive(Clone, Copy)]
struct ScrollFeature {
    x: u32,
    y: u32,
    strength: f64,
}

#[derive(Clone, Copy, Debug)]
struct VerticalOverlap {
    overlap: u32,
    fixed_top: u32,
    fixed_bottom: u32,
}

#[derive(Clone, Copy, Debug)]
struct VerticalScrollbar {
    top: u32,
    length: u32,
    from_right: bool,
}

fn rgb_difference(a: image::Rgba<u8>, b: image::Rgba<u8>) -> f64 {
    (a[0].abs_diff(b[0]) as f64 + a[1].abs_diff(b[1]) as f64 + a[2].abs_diff(b[2]) as f64)
        / (255.0 * 3.0)
}

fn scroll_frame_fingerprint(image: &RgbaImage) -> u64 {
    // Screen capture frequently returns many byte-identical frames between
    // wheel events. Sending all of them through the expensive seam matcher can
    // fill the queue before real movement arrives, especially on Windows.
    // Sample a dense deterministic grid to cheaply suppress those duplicates;
    // a periodic forced refresh still captures lazy-loaded local changes that
    // happen between sample points.
    const SAMPLE_COLUMNS: u32 = 64;
    const SAMPLE_ROWS: u32 = 48;
    let width = image.width().max(1);
    let height = image.height().max(1);
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut mix = |value: u64| {
        hash ^= value;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    };
    mix(width as u64);
    mix(height as u64);
    for row in 0..SAMPLE_ROWS.min(height) {
        let y =
            (((row as u64 * 2 + 1) * height as u64) / (SAMPLE_ROWS.min(height) as u64 * 2)) as u32;
        for column in 0..SAMPLE_COLUMNS.min(width) {
            let x = (((column as u64 * 2 + 1) * width as u64)
                / (SAMPLE_COLUMNS.min(width) as u64 * 2)) as u32;
            let pixel = image.get_pixel(x.min(width - 1), y.min(height - 1)).0;
            mix(u32::from_le_bytes(pixel) as u64);
        }
    }
    hash
}

fn feature_strength(image: &RgbaImage, x: u32, y: u32, width: u32, height: u32) -> f64 {
    let mut strength = 0.0;
    let mut samples = 0_u32;
    for yy in (y..y + height - 1).step_by(3) {
        for xx in (x..x + width - 1).step_by(3) {
            strength += rgb_difference(*image.get_pixel(xx, yy), *image.get_pixel(xx + 1, yy));
            strength += rgb_difference(*image.get_pixel(xx, yy), *image.get_pixel(xx, yy + 1));
            samples += 2;
        }
    }
    strength / samples.max(1) as f64
}

fn patch_difference(
    previous: &RgbaImage,
    next: &RgbaImage,
    x: u32,
    previous_y: u32,
    next_y: u32,
    width: u32,
    height: u32,
) -> f64 {
    let mut scores = Vec::new();
    for yy in (0..height).step_by(3) {
        for xx in (0..width).step_by(3) {
            scores.push(rgb_difference(
                *previous.get_pixel(x + xx, previous_y + yy),
                *next.get_pixel(x + xx, next_y + yy),
            ));
        }
    }
    // Ignore the noisiest quarter of a patch so caret blinking and small
    // animations do not invalidate an otherwise exact text/edge match.
    scores.sort_by(f64::total_cmp);
    let retained = ((scores.len() as f64) * 0.75).ceil() as usize;
    scores.iter().take(retained).sum::<f64>() / retained.max(1) as f64
}

fn feature_scroll_deltas(previous: &RgbaImage, next: &RgbaImage, fixed_top: u32) -> Vec<u32> {
    const PATCH_WIDTH: u32 = 30;
    const PATCH_HEIGHT: u32 = 18;
    let width = previous.width().min(next.width());
    let height = previous.height().min(next.height());
    if width < PATCH_WIDTH + 8 || height < PATCH_HEIGHT + SCROLL_MIN_NEW_CONTENT + 8 {
        return Vec::new();
    }

    let mut features = Vec::new();
    for y in ((fixed_top + 4)..height.saturating_sub(PATCH_HEIGHT + 4)).step_by(30) {
        for x in (4..width.saturating_sub(PATCH_WIDTH + 4)).step_by(36) {
            let strength = feature_strength(previous, x, y, PATCH_WIDTH, PATCH_HEIGHT);
            if strength < 0.025 {
                continue;
            }
            let activity = patch_difference(previous, next, x, y, y, PATCH_WIDTH, PATCH_HEIGHT);
            if activity > 0.025 {
                features.push(ScrollFeature {
                    x,
                    y,
                    strength: strength * activity,
                });
            }
        }
    }
    features.sort_by(|a, b| b.strength.total_cmp(&a.strength));
    // Keep features across the full viewport. Large scroll steps can only be
    // measured by features that started near the bottom; selecting only the
    // globally strongest few biases the vote toward small, incorrect shifts.
    features.truncate(72);

    let mut votes = Vec::new();
    for feature in features {
        let max_delta = feature
            .y
            .saturating_sub(fixed_top)
            .min(height - SCROLL_MIN_OVERLAP);
        if max_delta < SCROLL_MIN_NEW_CONTENT {
            continue;
        }
        let mut best_delta = 0;
        let mut best_score = f64::INFINITY;
        let mut scored = Vec::new();
        for delta in SCROLL_MIN_NEW_CONTENT..=max_delta {
            let score = patch_difference(
                previous,
                next,
                feature.x,
                feature.y,
                feature.y - delta,
                PATCH_WIDTH,
                PATCH_HEIGHT,
            );
            scored.push((delta, score));
            if score < best_score {
                best_score = score;
                best_delta = delta;
            }
        }
        let second_score = scored
            .iter()
            .filter(|(delta, _)| delta.abs_diff(best_delta) > 2)
            .map(|(_, score)| *score)
            .fold(f64::INFINITY, f64::min);
        if best_score <= 0.065 && (best_score <= 0.008 || second_score - best_score >= 0.008) {
            votes.push(best_delta);
        }
    }

    if votes.len() < 2 {
        return Vec::new();
    }
    let mut candidates = Vec::new();
    for &candidate in &votes {
        let mut cluster = votes
            .iter()
            .copied()
            .filter(|vote| vote.abs_diff(candidate) <= 2)
            .collect::<Vec<_>>();
        if cluster.len() >= 2 {
            cluster.sort_unstable();
            let median = cluster[cluster.len() / 2];
            if !candidates
                .iter()
                .any(|existing: &u32| existing.abs_diff(median) <= 2)
            {
                candidates.push(median);
            }
        }
    }
    candidates
}

fn scroll_active_columns(previous: &RgbaImage, next: &RgbaImage) -> Vec<u32> {
    let width = previous.width().min(next.width());
    let left = width * 5 / 100;
    let right = (width * 95 / 100).max(left + 1);
    let step = ((right - left) / 64).max(1);
    let height = previous.height().min(next.height());
    let top = height * 10 / 100;
    let bottom = (height * 90 / 100).max(top + 1);
    let y_step = ((bottom - top) / 18).max(1);
    let mut active = Vec::new();
    for x in (left..right).step_by(step as usize) {
        let mut differences = Vec::new();
        for y in (top..bottom).step_by(y_step as usize) {
            let a = previous.get_pixel(x, y).0;
            let b = next.get_pixel(x, y).0;
            differences.push(
                (a[0].abs_diff(b[0]) as f64
                    + a[1].abs_diff(b[1]) as f64
                    + a[2].abs_diff(b[2]) as f64)
                    / (255.0 * 3.0),
            );
        }
        differences.sort_by(|a, b| b.total_cmp(a));
        let retained = 3_usize.max(differences.len() / 3).min(differences.len());
        let activity = differences.iter().take(retained).sum::<f64>() / retained.max(1) as f64;
        if activity > 0.018 {
            active.push(x);
        }
    }
    active
}

fn scroll_sample_columns(width: u32) -> Vec<u32> {
    if width == 0 {
        return Vec::new();
    }
    let left = width * 5 / 100;
    let right = (width * 95 / 100).max(left + 1);
    let samples = 72_u32.min((right - left).max(1));
    (0..samples)
        .map(|index| {
            left + (((index as f64 + 0.5) * (right - left) as f64) / samples as f64) as u32
        })
        .map(|x| x.min(width - 1))
        .collect()
}

fn detect_vertical_scrollbar(image: &RgbaImage) -> Option<VerticalScrollbar> {
    let width = image.width();
    let height = image.height();
    if width < 40 || height < 80 {
        return None;
    }
    let band = 14_u32.min(width / 4);
    let reference_gap = 8_u32;
    let mut best: Option<(VerticalScrollbar, u32)> = None;

    for from_right in [true, false] {
        let reference_x = if from_right {
            width.saturating_sub(band + reference_gap + 1)
        } else {
            (band + reference_gap).min(width - 1)
        };
        let mut active_rows = Vec::with_capacity(height as usize);
        for y in 0..height {
            let reference = *image.get_pixel(reference_x, y);
            let changed = (0..band)
                .filter(|offset| {
                    let x = if from_right {
                        width - 1 - offset
                    } else {
                        *offset
                    };
                    rgb_difference(*image.get_pixel(x, y), reference) >= 0.045
                })
                .count() as u32;
            // Scrollbar thumbs occupy a narrow edge strip. Reject full-width
            // edge colour changes from page sections, dialogs and borders.
            active_rows.push(changed >= 2 && changed <= band.saturating_sub(2));
        }

        let mut start = 0_u32;
        while start < height {
            while start < height && !active_rows[start as usize] {
                start += 1;
            }
            if start >= height {
                break;
            }
            let mut end = start;
            let mut last_active = start;
            let mut gap = 0_u32;
            while end < height {
                if active_rows[end as usize] {
                    last_active = end;
                    gap = 0;
                } else {
                    gap += 1;
                    if gap > 2 {
                        break;
                    }
                }
                end += 1;
            }
            let length = last_active + 1 - start;
            if length >= 12 && length <= height * 80 / 100 {
                let candidate = VerticalScrollbar {
                    top: start,
                    length,
                    from_right,
                };
                let score = length;
                if best
                    .map(|(_, best_score)| score > best_score)
                    .unwrap_or(true)
                {
                    best = Some((candidate, score));
                }
            }
            start = end.max(start + 1);
        }
    }
    best.map(|(scrollbar, _)| scrollbar)
}

fn scrollbar_scroll_delta(
    previous: VerticalScrollbar,
    next: VerticalScrollbar,
    viewport_height: u32,
) -> Option<u32> {
    if previous.from_right != next.from_right || next.top <= previous.top {
        return None;
    }
    let average_length = (previous.length + next.length) / 2;
    if average_length < 8 || previous.length.abs_diff(next.length) > average_length / 3 {
        return None;
    }
    let delta = next
        .top
        .saturating_sub(previous.top)
        .saturating_mul(viewport_height)
        / average_length.max(1);
    (delta >= SCROLL_MIN_NEW_CONTENT).then_some(delta)
}

fn same_row_score(previous: &RgbaImage, next: &RgbaImage, y: u32, columns: &[u32]) -> f64 {
    let mut differences = Vec::with_capacity(columns.len());
    for &x in columns {
        let a = previous.get_pixel(x, y).0;
        let b = next.get_pixel(x, y).0;
        differences.push(
            (a[0].abs_diff(b[0]) as f64 + a[1].abs_diff(b[1]) as f64 + a[2].abs_diff(b[2]) as f64)
                / (255.0 * 3.0),
        );
    }
    differences.sort_by(f64::total_cmp);
    let retained = 3_usize
        .max(((differences.len() as f64) * 0.75).ceil() as usize)
        .min(differences.len());
    differences.iter().take(retained).sum::<f64>() / retained.max(1) as f64
}

fn stable_edge_height(
    previous: &RgbaImage,
    next: &RgbaImage,
    from_top: bool,
    columns: &[u32],
) -> u32 {
    let height = previous.height().min(next.height());
    let limit = height * 45 / 100;
    let mut last_stable = 0;
    let mut misses = 0;
    for offset in 0..limit {
        let y = if from_top {
            offset
        } else {
            height - 1 - offset
        };
        if same_row_score(previous, next, y, columns) <= 0.025 {
            last_stable = offset + 1;
            misses = 0;
        } else {
            misses += 1;
            if misses >= 4 {
                break;
            }
        }
    }
    if last_stable >= 8 { last_stable } else { 0 }
}

fn native_overlap_score(
    previous: &RgbaImage,
    next: &RgbaImage,
    overlap: u32,
    fixed_top: u32,
    fixed_bottom: u32,
    columns: &[u32],
) -> f64 {
    // Ignore stable top/bottom chrome (sticky navigation, cookie bars, media
    // controls) and small safety margins. Only actual scrolling content should
    // decide the vertical offset.
    let top_guard = fixed_top
        .max(previous.height() * 12 / 100)
        .min(overlap.saturating_sub(12));
    let after_top = overlap.saturating_sub(top_guard);
    let bottom_guard = fixed_bottom
        .max(previous.height() * 6 / 100)
        .min(after_top.saturating_sub(8))
        .min(after_top / 3);
    let usable = overlap.saturating_sub(top_guard + bottom_guard).max(1);
    let rows = 24_u32.min(8_u32.max(usable / 10));
    let mut row_scores = Vec::with_capacity(rows as usize);

    for row in 0..rows {
        let offset = top_guard
            + (((row as f64 + 0.5) * usable as f64) / rows as f64)
                .floor()
                .min((usable - 1) as f64) as u32;
        let previous_y = previous.height() - overlap + offset;
        let next_y = offset;
        let mut column_scores = Vec::with_capacity(columns.len());
        for &x in columns {
            let a = previous.get_pixel(x, previous_y).0;
            let b = next.get_pixel(x, next_y).0;
            column_scores.push(
                (a[0].abs_diff(b[0]) as f64
                    + a[1].abs_diff(b[1]) as f64
                    + a[2].abs_diff(b[2]) as f64)
                    / (255.0 * 3.0),
            );
        }
        column_scores.sort_by(f64::total_cmp);
        let retained_columns = 3_usize
            .max(((column_scores.len() as f64) * 0.75).ceil() as usize)
            .min(column_scores.len());
        row_scores.push(
            column_scores.iter().take(retained_columns).sum::<f64>()
                / retained_columns.max(1) as f64,
        );
    }

    row_scores.sort_by(f64::total_cmp);
    let retained = 5_usize.max(((row_scores.len() as f64) * 0.7).ceil() as usize);
    row_scores.iter().take(retained).sum::<f64>() / retained as f64
}

fn pixel_edge_activity(image: &RgbaImage, x: u32, y: u32) -> f64 {
    let left = x.saturating_sub(1);
    let right = (x + 1).min(image.width() - 1);
    let top = y.saturating_sub(1);
    let bottom = (y + 1).min(image.height() - 1);
    let pixel = *image.get_pixel(x, y);
    rgb_difference(pixel, *image.get_pixel(left, y))
        .max(rgb_difference(pixel, *image.get_pixel(right, y)))
        .max(rgb_difference(pixel, *image.get_pixel(x, top)))
        .max(rgb_difference(pixel, *image.get_pixel(x, bottom)))
}

fn informative_overlap_score(
    previous: &RgbaImage,
    next: &RgbaImage,
    overlap: u32,
    fixed_top: u32,
    fixed_bottom: u32,
    columns: &[u32],
) -> Option<f64> {
    // Product/review pages contain many repeated white rows, separators and
    // rating bars. A broad average can align the wrong review perfectly while
    // ignoring the few rows that contain its unique text. Validate candidates
    // again using only actual edges (glyphs, icons and image detail).
    let top_guard = fixed_top
        .max(previous.height() * 12 / 100)
        .min(overlap.saturating_sub(12));
    let after_top = overlap.saturating_sub(top_guard);
    let bottom_guard = fixed_bottom
        .max(previous.height() * 6 / 100)
        .min(after_top.saturating_sub(8))
        .min(after_top / 3);
    let usable = overlap.saturating_sub(top_guard + bottom_guard);
    if usable == 0 || columns.is_empty() {
        return None;
    }

    let rows = 96_u32.min(usable).max(1);
    let mut differences = Vec::with_capacity(rows as usize * columns.len());
    for row in 0..rows {
        let offset = top_guard
            + (((row as f64 + 0.5) * usable as f64) / rows as f64)
                .floor()
                .min((usable - 1) as f64) as u32;
        let previous_y = previous.height() - overlap + offset;
        let next_y = offset;
        for &x in columns {
            let x = x.min(previous.width() - 1).min(next.width() - 1);
            let activity = pixel_edge_activity(previous, x, previous_y)
                .max(pixel_edge_activity(next, x, next_y));
            if activity >= 0.035 {
                differences.push(rgb_difference(
                    *previous.get_pixel(x, previous_y),
                    *next.get_pixel(x, next_y),
                ));
            }
        }
    }
    if differences.len() < columns.len().max(24) {
        return None;
    }
    differences.sort_by(f64::total_cmp);
    // Ignore only a small noisy tail for GIFs/carets. Unlike the broad score,
    // keep nearly all text edges so repeated card templates cannot win by
    // matching their blank background and common rating bar.
    let retained = ((differences.len() as f64) * 0.92).ceil() as usize;
    Some(differences.iter().take(retained).sum::<f64>() / retained.max(1) as f64)
}

fn robust_overlap_score(
    previous: &RgbaImage,
    next: &RgbaImage,
    overlap: u32,
    fixed_top: u32,
    fixed_bottom: u32,
    columns: &[u32],
    broad_score: f64,
) -> f64 {
    informative_overlap_score(previous, next, overlap, fixed_top, fixed_bottom, columns)
        .map(|informative| broad_score * 0.35 + informative * 0.65)
        .unwrap_or(broad_score)
}

fn overlap_match_rank(score: f64, delta: u32, viewport: u32, expected: Option<u32>) -> f64 {
    let distance = expected
        .map(|expected| delta.abs_diff(expected))
        // The first changed frame is sampled immediately after the baseline;
        // prefer the nearer valid seam when repeated list rows are otherwise
        // similarly convincing.
        .unwrap_or(delta);
    let weight = if expected.is_some() { 0.08 } else { 0.012 };
    score + distance as f64 / viewport.max(1) as f64 * weight
}

#[cfg(test)]
fn native_vertical_overlap(previous: &RgbaImage, next: &RgbaImage) -> Option<VerticalOverlap> {
    native_vertical_overlap_with_hint(previous, next, None)
}

fn native_vertical_overlap_with_hint(
    previous: &RgbaImage,
    next: &RgbaImage,
    expected_delta: Option<u32>,
) -> Option<VerticalOverlap> {
    if previous.dimensions() != next.dimensions() {
        return None;
    }
    let viewport = previous.height();
    let max_overlap = viewport.checked_sub(SCROLL_MIN_NEW_CONTENT)?;
    if max_overlap < SCROLL_MIN_OVERLAP {
        return None;
    }

    let active_columns = scroll_active_columns(previous, next);
    let sample_columns;
    let columns = if active_columns.len() >= SCROLL_MIN_CONFIDENT_COLUMNS {
        active_columns.as_slice()
    } else {
        // Low-texture pages can scroll with only a few changing columns. Do
        // not call those frames duplicates by default; use broad sampling so
        // blank margins and sparse layouts still have a chance to align.
        sample_columns = scroll_sample_columns(previous.width().min(next.width()));
        sample_columns.as_slice()
    };

    let fixed_top = stable_edge_height(previous, next, true, &columns);
    let fixed_bottom = stable_edge_height(previous, next, false, &columns);

    let full_score =
        native_overlap_score(previous, next, viewport, fixed_top, fixed_bottom, &columns);
    let full_robust_score = robust_overlap_score(
        previous,
        next,
        viewport,
        fixed_top,
        fixed_bottom,
        &columns,
        full_score,
    );
    if full_score <= SCROLL_DUPLICATE_SCORE
        && full_robust_score <= SCROLL_DUPLICATE_INFORMATIVE_SCORE
    {
        return Some(VerticalOverlap {
            overlap: viewport,
            fixed_top,
            fixed_bottom,
        });
    }

    // Feature patches propose possible shifts; validate every consensus with
    // the wider scrolling region so repeated text/patterns cannot select a
    // locally convincing but globally incorrect seam.
    let mut feature_match: Option<(u32, f64, f64, f64)> = None;
    for delta in feature_scroll_deltas(previous, next, fixed_top) {
        let overlap = viewport - delta;
        let broad_score =
            native_overlap_score(previous, next, overlap, fixed_top, fixed_bottom, &columns);
        let robust_score = robust_overlap_score(
            previous,
            next,
            overlap,
            fixed_top,
            fixed_bottom,
            &columns,
            broad_score,
        );
        let rank = overlap_match_rank(robust_score, delta, viewport, expected_delta);
        if feature_match
            .map(|(_, _, _, best_rank)| rank < best_rank)
            .unwrap_or(true)
        {
            feature_match = Some((overlap, broad_score, robust_score, rank));
        }
    }
    if let Some((overlap, broad_score, robust_score, _)) = feature_match {
        if broad_score <= SCROLL_MAX_MATCH_SCORE && robust_score <= SCROLL_MAX_INFORMATIVE_SCORE {
            return Some(VerticalOverlap {
                overlap,
                fixed_top,
                fixed_bottom,
            });
        }
    }

    // When substantial unchanged bands remain at both edges but no textured
    // feature can prove a translation, the page changed in place (most often a
    // lazy-loaded image, web font or skeleton). Requiring both edges avoids
    // dropping real scroll progress on pages with a tall sticky header or a
    // large fixed footer.
    if fixed_top >= 8 && fixed_bottom >= 8 && fixed_top + fixed_bottom >= viewport * 35 / 100 {
        return Some(VerticalOverlap {
            overlap: viewport,
            fixed_top,
            fixed_bottom,
        });
    }

    let mut candidates = Vec::new();
    for overlap in (SCROLL_MIN_OVERLAP..=max_overlap).rev() {
        let score =
            native_overlap_score(previous, next, overlap, fixed_top, fixed_bottom, &columns);
        if score <= SCROLL_MAX_MATCH_SCORE {
            candidates.push((overlap, score));
        }
    }
    if candidates.is_empty() {
        return None;
    }

    // Broad scoring intentionally tolerates animation, but that also produces
    // several deceptively good offsets on repeated review cards. Validate both
    // the globally best broad candidates and the candidates nearest the recent
    // physical movement, then choose by text/detail score plus continuity.
    candidates.sort_by(|a, b| a.1.total_cmp(&b.1));
    let mut shortlist = candidates.iter().take(32).copied().collect::<Vec<_>>();
    candidates.sort_by_key(|(overlap, _)| {
        let delta = viewport - *overlap;
        expected_delta
            .map(|expected| delta.abs_diff(expected))
            .unwrap_or(delta)
    });
    for candidate in candidates.iter().take(16).copied() {
        if !shortlist.iter().any(|(overlap, _)| *overlap == candidate.0) {
            shortlist.push(candidate);
        }
    }

    let mut best: Option<(u32, f64)> = None;
    for (overlap, broad_score) in shortlist {
        let robust_score = robust_overlap_score(
            previous,
            next,
            overlap,
            fixed_top,
            fixed_bottom,
            &columns,
            broad_score,
        );
        if robust_score > SCROLL_MAX_INFORMATIVE_SCORE {
            continue;
        }
        let delta = viewport - overlap;
        let rank = overlap_match_rank(robust_score, delta, viewport, expected_delta);
        if best.map(|(_, best_rank)| rank < best_rank).unwrap_or(true) {
            best = Some((overlap, rank));
        }
    }
    let (best_overlap, _) = best?;
    Some(VerticalOverlap {
        overlap: best_overlap,
        fixed_top,
        fixed_bottom,
    })
}

fn native_overlap_near_scroll_delta(
    previous: &RgbaImage,
    next: &RgbaImage,
    predicted_delta: u32,
) -> Option<VerticalOverlap> {
    if previous.dimensions() != next.dimensions() {
        return None;
    }
    let viewport = previous.height();
    let max_delta = viewport.saturating_sub(SCROLL_MIN_NEW_CONTENT);
    if predicted_delta < SCROLL_MIN_NEW_CONTENT || max_delta < SCROLL_MIN_OVERLAP {
        return None;
    }

    let active_columns = scroll_active_columns(previous, next);
    let sample_columns;
    let columns = if active_columns.len() >= SCROLL_MIN_CONFIDENT_COLUMNS {
        active_columns.as_slice()
    } else {
        sample_columns = scroll_sample_columns(previous.width().min(next.width()));
        sample_columns.as_slice()
    };
    let fixed_top = stable_edge_height(previous, next, true, columns);
    let fixed_bottom = stable_edge_height(previous, next, false, columns);
    let radius = 24_u32.max(predicted_delta / 8);
    let start = predicted_delta
        .saturating_sub(radius)
        .max(SCROLL_MIN_NEW_CONTENT);
    let end = predicted_delta.saturating_add(radius).min(max_delta);
    if start > end {
        return None;
    }

    let mut best: Option<(u32, f64, f64)> = None;
    for delta in start..=end {
        let overlap = viewport - delta;
        let broad_score =
            native_overlap_score(previous, next, overlap, fixed_top, fixed_bottom, &columns);
        let robust_score = robust_overlap_score(
            previous,
            next,
            overlap,
            fixed_top,
            fixed_bottom,
            &columns,
            broad_score,
        );
        let rank = overlap_match_rank(robust_score, delta, viewport, Some(predicted_delta));
        if best
            .map(|(_, _, best_rank)| rank < best_rank)
            .unwrap_or(true)
        {
            best = Some((delta, broad_score, rank));
        }
    }
    let (delta, broad_score, _) = best?;
    let overlap = viewport - delta;
    let robust_score = robust_overlap_score(
        previous,
        next,
        overlap,
        fixed_top,
        fixed_bottom,
        &columns,
        broad_score,
    );
    (broad_score <= SCROLL_MAX_MATCH_SCORE && robust_score <= SCROLL_MAX_INFORMATIVE_SCORE)
        .then_some(VerticalOverlap {
            overlap: viewport - delta,
            fixed_top,
            fixed_bottom,
        })
}

fn stationary_refresh_overlap(previous: &RgbaImage, next: &RgbaImage) -> Option<VerticalOverlap> {
    if previous.dimensions() != next.dimensions() {
        return None;
    }
    let viewport = previous.height();
    let active_columns = scroll_active_columns(previous, next);
    let sample_columns;
    let columns = if active_columns.len() >= SCROLL_MIN_CONFIDENT_COLUMNS {
        active_columns.as_slice()
    } else {
        sample_columns = scroll_sample_columns(previous.width().min(next.width()));
        sample_columns.as_slice()
    };
    let fixed_top = stable_edge_height(previous, next, true, columns);
    let fixed_bottom = stable_edge_height(previous, next, false, columns);
    // A single fixed edge is not enough evidence that the page stayed still:
    // product pages commonly have a tall sticky header or footer while the
    // content underneath continues to move. Only refresh the committed frame
    // when either both edges are stable, or most sampled rows in the actually
    // changing columns remain aligned at the same coordinates. The latter
    // covers lazy-loaded images without turning a sticky header into a false
    // "stationary" result.
    let stable_same_position = if active_columns.len() >= SCROLL_MIN_CONFIDENT_COLUMNS {
        let top = viewport * 5 / 100;
        let bottom = (viewport * 95 / 100).max(top + 1);
        let rows = 36_u32.min((bottom - top).max(1));
        let stable_rows = (0..rows)
            .filter(|row| {
                let y = top + (((*row as f64 + 0.5) * (bottom - top) as f64) / rows as f64) as u32;
                same_row_score(previous, next, y.min(viewport - 1), columns) <= 0.025
            })
            .count();
        stable_rows * 100 >= rows as usize * 55
    } else {
        false
    };
    if (fixed_top >= 8 && fixed_bottom >= 8 && fixed_top + fixed_bottom >= viewport * 35 / 100)
        || stable_same_position
    {
        return Some(VerticalOverlap {
            overlap: viewport,
            fixed_top,
            fixed_bottom,
        });
    }
    None
}

impl NativeScrollSession {
    fn new(initial: RgbaImage) -> Self {
        // Keep the live preview substantially larger than the control window.
        // The final image always uses the original frames; this only prevents
        // small review/comment text from becoming unreadable in the preview.
        let preview_width = initial.width().min(720).max(1);
        let preview_height = ((initial.height() as f64 * preview_width as f64)
            / initial.width().max(1) as f64)
            .round()
            .max(1.0) as u32;
        let preview = imageops::resize(
            &initial,
            preview_width,
            preview_height,
            ResizeFilter::Triangle,
        );
        let last_observed_scrollbar = detect_vertical_scrollbar(&initial);
        Self {
            width: initial.width(),
            viewport_height: initial.height(),
            total_height: initial.height(),
            last_frame: initial.clone(),
            segments: vec![initial],
            preview_width,
            preview_height,
            preview_segments: vec![preview],
            last_observed_scrollbar,
            pending_scroll_delta: 0,
            last_scroll_delta: None,
        }
    }

    fn refresh_overlap(&mut self, next: &RgbaImage, matched: VerticalOverlap) {
        // A later frame can contain images/fonts that finished loading after
        // their placeholder was first appended. Refresh the already-stitched
        // overlap from the newest frame instead of discarding it as a
        // duplicate. Fixed chrome is excluded so sticky headers are still kept
        // only once at the top of the long screenshot.
        let overlap = matched.overlap.min(self.viewport_height);
        let source_start = matched.fixed_top.min(overlap);
        let source_end = overlap.min(self.viewport_height.saturating_sub(matched.fixed_bottom));
        if source_end <= source_start || self.total_height < overlap {
            return;
        }
        let copy_x = 0;
        let copy_width = self.width;

        let destination_start = self.total_height - overlap + source_start;
        let destination_end = self.total_height - overlap + source_end;
        let mut segment_start = 0_u32;
        for segment in &mut self.segments {
            let segment_end = segment_start + segment.height();
            let copy_start = segment_start.max(destination_start);
            let copy_end = segment_end.min(destination_end);
            if copy_end > copy_start {
                let source_y = source_start + copy_start - destination_start;
                let source =
                    imageops::crop_imm(next, copy_x, source_y, copy_width, copy_end - copy_start)
                        .to_image();
                imageops::replace(
                    segment,
                    &source,
                    copy_x as i64,
                    (copy_start - segment_start) as i64,
                );
            }
            segment_start = segment_end;
            if segment_start >= destination_end {
                break;
            }
        }
    }

    fn append(&mut self, next: RgbaImage) -> bool {
        let next_scrollbar = detect_vertical_scrollbar(&next);
        if let (Some(previous), Some(current)) = (self.last_observed_scrollbar, next_scrollbar) {
            if let Some(delta) = scrollbar_scroll_delta(previous, current, self.viewport_height) {
                self.pending_scroll_delta = self.pending_scroll_delta.saturating_add(delta);
            }
        }
        if next_scrollbar.is_some() {
            self.last_observed_scrollbar = next_scrollbar;
        }

        let matched =
            native_vertical_overlap_with_hint(&self.last_frame, &next, self.last_scroll_delta);
        // When an on-screen scrollbar is visible, its thumb displacement is an
        // independent measurement of the actual scroll position. It is the
        // source of truth for the seam: repeated review rows, animated GIFs
        // and large flat colour blocks can produce a plausible but incorrect
        // pixel overlap, while the scrollbar still reports the exact movement.
        if self.pending_scroll_delta >= SCROLL_MIN_NEW_CONTENT {
            let scrollbar_delta = self.pending_scroll_delta;
            // Scrollbar thumb positions are quantized on long documents. Use
            // them to constrain the search, then snap to the best actual pixel
            // seam within a small neighbourhood so text is never split and
            // rendered twice at an inaccurate boundary.
            let refined =
                native_overlap_near_scroll_delta(&self.last_frame, &next, scrollbar_delta);
            let overlap = refined.map(|matched| matched.overlap).unwrap_or_else(|| {
                self.viewport_height
                    .saturating_sub(scrollbar_delta.min(self.viewport_height))
            });
            self.last_frame = next.clone();
            self.pending_scroll_delta = 0;
            // There is no pixel seam to refresh when the page is animated;
            // append exactly the rows implied by the physical movement.
            return self.append_tail(next, overlap);
        }

        let Some(matched) = matched else {
            // Animated GIFs and video-like product panels may have no stable
            // pixels to align. If the scrollbar moved only a small amount and
            // the visual matcher also failed, keep the committed anchor so a
            // later frame can still recover the complete distance.
            if let Some(refresh) = stationary_refresh_overlap(&self.last_frame, &next) {
                self.refresh_overlap(&next, refresh);
                // The frame is known to represent the same scroll position, so
                // it is safe to make its newly loaded pixels the committed
                // stitching anchor.
                self.last_frame = next;
            }
            // If movement cannot be proven, keep the last frame that actually
            // corresponds to the tail of `segments`. Advancing the anchor here
            // would discard the unmeasured distance; a later successful match
            // would then append only the newest part and leave a permanent gap.
            return false;
        };
        self.refresh_overlap(&next, matched);
        self.last_frame = next.clone();
        self.pending_scroll_delta = 0;
        self.append_tail(next, matched.overlap)
    }

    fn append_tail(&mut self, next: RgbaImage, overlap: u32) -> bool {
        let new_height = self.viewport_height.saturating_sub(overlap);
        if new_height < SCROLL_MIN_NEW_CONTENT {
            return false;
        }
        self.last_scroll_delta = Some(new_height);
        // Keep every horizontal pixel that was visible in the viewport. Pages
        // such as YouTube can lazy-load or animate independent columns; trying
        // to infer one "moving" column blanks genuine left/right content.
        let segment = imageops::crop_imm(&next, 0, overlap, self.width, new_height).to_image();
        let preview_height = ((new_height as f64 * self.preview_width as f64)
            / self.width.max(1) as f64)
            .round()
            .max(1.0) as u32;
        self.preview_segments.push(imageops::resize(
            &segment,
            self.preview_width,
            preview_height,
            ResizeFilter::Triangle,
        ));
        self.preview_height += preview_height;
        self.segments.push(segment);
        self.total_height += new_height;
        true
    }

    fn render(&self) -> RgbaImage {
        let mut output = RgbaImage::new(self.width, self.total_height);
        let mut y = 0_i64;
        for segment in &self.segments {
            imageops::replace(&mut output, segment, 0, y);
            y += segment.height() as i64;
        }
        output
    }

    fn preview_snapshot(&self) -> (RgbaImage, u32, u32) {
        let mut output = RgbaImage::new(self.preview_width, self.preview_height);
        let mut y = 0_i64;
        for segment in &self.preview_segments {
            imageops::replace(&mut output, segment, 0, y);
            y += segment.height() as i64;
        }
        (output, self.preview_width, self.preview_height)
    }
}

fn encode_scroll_preview(snapshot: (RgbaImage, u32, u32)) -> Result<ScrollPreview, String> {
    Ok(ScrollPreview {
        base64: BASE64.encode(png_bytes(&snapshot.0)?),
        width: snapshot.1,
        height: snapshot.2,
    })
}

fn build_overlay_window(app: &AppHandle, width: f64, height: f64) -> Result<(), String> {
    WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("index.html".into()))
        .title("LiteSnap")
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .content_protected(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn open_overlay(app: &AppHandle, capture: &CaptureData) -> Result<(), String> {
    let existed = app.get_webview_window("overlay").is_some();
    if !existed {
        build_overlay_window(app, capture.bounds.width, capture.bounds.height)?;
    }
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "Capture overlay is unavailable".to_string())?;
    window.hide().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    {
        // The builder accepts logical dimensions and may initially create the
        // hidden WebView using the primary monitor's DPI. After moving it to
        // the cursor's monitor, force its exact physical bounds so Windows
        // cannot bitmap-scale the overlay (the visible zoom/blur symptom).
        window
            .set_position(tauri::PhysicalPosition::new(
                capture.physical_origin_x,
                capture.physical_origin_y,
            ))
            .map_err(|error| error.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(
                capture.physical_width,
                capture.physical_height,
            ))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        window
            .set_position(tauri::LogicalPosition::new(
                capture.bounds.x,
                capture.bounds.y,
            ))
            .map_err(|error| error.to_string())?;
        window
            .set_size(tauri::LogicalSize::new(
                capture.bounds.width,
                capture.bounds.height,
            ))
            .map_err(|error| error.to_string())?;
    }
    if existed {
        // Reuse the already-created WebView and its warm renderer process while
        // resetting all editor state for the newly captured frame.
        window
            .eval("window.location.reload()")
            .map_err(|error| error.to_string())?;
    }
    // The renderer shows the window only after the captured image has decoded
    // and painted. Showing a transparent WebView earlier causes a brief desktop
    // double-image/ghost while its backing surface is still empty.
    Ok(())
}

fn prewarm_overlay(app: &AppHandle) {
    if app.get_webview_window("overlay").is_none() {
        if let Err(error) = build_overlay_window(app, 1.0, 1.0) {
            eprintln!("Unable to prewarm capture overlay: {error}");
        }
    }
}

fn build_pin_window(
    app: &AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    WebviewWindowBuilder::new(app, "pin", WebviewUrl::App("index.html?view=pin".into()))
        .title("LiteSnap")
        .position(x, y)
        .inner_size(width, height)
        .min_inner_size(60.0, 60.0)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .resizable(true)
        .always_on_top(true)
        .visible(false)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn prewarm_pin_window(app: &AppHandle) {
    if app.get_webview_window("pin").is_none() {
        if let Err(error) = build_pin_window(app, 0.0, 0.0, 60.0, 60.0) {
            eprintln!("Unable to prewarm pin window: {error}");
        }
    }
}

#[cfg(target_os = "macos")]
fn screen_permission_granted() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
fn screen_permission_granted() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn request_screen_permission() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    unsafe { CGRequestScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
fn request_screen_permission() -> bool {
    true
}

fn ensure_screen_permission(app: &AppHandle) -> Result<(), StartCaptureError> {
    let permission_was_requested = app
        .state::<AppState>()
        .screen_permission_requested
        .load(Ordering::SeqCst);
    if permission_was_requested {
        return if screen_permission_granted() {
            Err(StartCaptureError::PermissionRestartRequired)
        } else {
            Err(StartCaptureError::PermissionDenied)
        };
    }

    if screen_permission_granted() {
        return Ok(());
    }

    app.state::<AppState>()
        .screen_permission_requested
        .store(true, Ordering::SeqCst);
    let _ = request_screen_permission();
    // Never capture in the same process that requested access. macOS can
    // briefly report access while the TCC change still requires an application
    // restart; capturing then produces a wallpaper-only frame.
    Err(StartCaptureError::PermissionPrompted)
}

fn open_screen_settings() {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn();
}

fn show_capture_error(app: &AppHandle, detail: &str) {
    eprintln!("LiteSnap capture failed: {detail}");
    let _ = app.emit("capture-error", detail.to_string());
    let _ = rfd::MessageDialog::new()
        .set_title("Cannot capture screen")
        .set_description(format!(
            "LiteSnap could not capture the screen. Check Screen Recording permission, fully quit LiteSnap, and open it again.\n\n{detail}"
        ))
        .set_level(rfd::MessageLevel::Error)
        .show();
}

fn show_screen_permission_help() {
    let _ = rfd::MessageDialog::new()
        .set_title("Screen Recording permission required")
        .set_description(
            "Enable LiteSnap in System Settings > Privacy & Security > Screen Recording. Then fully quit LiteSnap and open it again.",
        )
        .set_level(rfd::MessageLevel::Info)
        .show();
    // Open Settings only after the explanatory dialog has closed, so macOS
    // never stacks it together with a capture overlay or another prompt.
    open_screen_settings();
}

fn show_screen_permission_restart() {
    let _ = rfd::MessageDialog::new()
        .set_title("Restart LiteSnap")
        .set_description(
            "Screen Recording permission is enabled. Fully quit LiteSnap from its tray menu, then open it again before taking a screenshot.",
        )
        .set_level(rfd::MessageLevel::Info)
        .show();
}

fn handle_start_capture(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    if app
        .state::<AppState>()
        .scroll_rect
        .lock()
        .unwrap()
        .is_some()
    {
        // The Windows controller is intentionally non-focusable so wheel input
        // stays with the browser. If WebView2 is delayed or the panel is hidden
        // by a mixed-DPI desktop, the same capture hotkey remains a reliable
        // keyboard fallback for Done instead of leaving the session stuck.
        finish_scroll_impl(app);
        return;
    }
    match ensure_screen_permission(app) {
        Ok(()) => {}
        Err(StartCaptureError::PermissionPrompted) => return,
        Err(StartCaptureError::PermissionDenied) => {
            show_screen_permission_help();
            return;
        }
        Err(StartCaptureError::PermissionRestartRequired) => {
            show_screen_permission_restart();
            return;
        }
    }
    let state = app.state::<AppState>();
    if state.capture_in_progress.swap(true, Ordering::SeqCst) {
        return;
    }
    // A shortcut can arrive while the previous WebView is still painting
    // (most visible on the first Windows launch). Hide it before the native
    // capture so LiteSnap never captures its own transparent surface together
    // with the desktop.
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
    let worker_app = app.clone();
    thread::spawn(move || {
        #[cfg(target_os = "windows")]
        // `hide` is dispatched asynchronously by the Windows compositor; wait
        // one frame before taking the screenshot to avoid a desktop double.
        thread::sleep(Duration::from_millis(24));
        let result = capture_active_screen(&worker_app);
        let ui_app = worker_app.clone();
        if let Err(error) = worker_app.run_on_main_thread(move || {
            match result {
                Ok(capture) => {
                    *ui_app.state::<AppState>().capture.lock().unwrap() = Some(capture.clone());
                    if let Err(error) = open_overlay(&ui_app, &capture) {
                        show_capture_error(&ui_app, &error);
                    }
                }
                Err(error) => show_capture_error(&ui_app, &error),
            }
            ui_app
                .state::<AppState>()
                .capture_in_progress
                .store(false, Ordering::SeqCst);
        }) {
            worker_app
                .state::<AppState>()
                .capture_in_progress
                .store(false, Ordering::SeqCst);
            eprintln!("Unable to display capture overlay: {error}");
        }
    });
}

fn close_overlay_impl(app: &AppHandle) {
    cancel_scroll_impl(app);
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
    *app.state::<AppState>().capture.lock().unwrap() = None;
}

fn write_clipboard_png(data: &[u8]) -> Result<(), String> {
    let rgba = image::load_from_memory(data)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = rgba.dimensions();
    Clipboard::new()
        .map_err(|error| error.to_string())?
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(rgba.into_raw()),
        })
        .map_err(|error| error.to_string())
}

fn open_shortcut_window(app: &AppHandle) -> Result<(), String> {
    suspend_shortcut(app);
    if let Some(window) = app.get_webview_window("shortcut") {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    let window = WebviewWindowBuilder::new(
        app,
        "shortcut",
        WebviewUrl::App("index.html?view=shortcut".into()),
    )
    .title("LiteSnap")
    .inner_size(400.0, 272.0)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    let close_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            resume_shortcut(&close_app);
        }
    });
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn scroll_control_position(bounds: Rect, selection: Rect, width: f64, height: f64) -> (f64, f64) {
    const MARGIN: f64 = 12.0;
    let selection_left = bounds.x + selection.x;
    let selection_right = selection_left + selection.width;
    let selection_top = bounds.y + selection.y;
    let selection_bottom = selection_top + selection.height;
    let screen_right = bounds.x + bounds.width;
    let screen_bottom = bounds.y + bounds.height;

    let centered_y = (selection_top + (selection.height - height) / 2.0).clamp(
        bounds.y + MARGIN,
        (screen_bottom - height - MARGIN).max(bounds.y + MARGIN),
    );
    if screen_right - selection_right >= width + MARGIN * 2.0 {
        return (selection_right + MARGIN, centered_y);
    }
    if selection_left - bounds.x >= width + MARGIN * 2.0 {
        return (selection_left - width - MARGIN, centered_y);
    }

    let centered_x = (selection_left + (selection.width - width) / 2.0).clamp(
        bounds.x + MARGIN,
        (screen_right - width - MARGIN).max(bounds.x + MARGIN),
    );
    if screen_bottom - selection_bottom >= height + MARGIN * 2.0 {
        return (centered_x, selection_bottom + MARGIN);
    }
    if selection_top - bounds.y >= height + MARGIN * 2.0 {
        return (centered_x, selection_top - height - MARGIN);
    }

    // A near-full-screen selection leaves no safe outside space. Keep the
    // controller on-screen and rely on content protection for that case.
    (
        (screen_right - width - 20.0).max(bounds.x + MARGIN),
        (bounds.y + (bounds.height - height) / 2.0).clamp(
            bounds.y + MARGIN,
            (screen_bottom - height - MARGIN).max(bounds.y + MARGIN),
        ),
    )
}

#[cfg(any(target_os = "windows", test))]
fn scroll_control_physical_geometry(
    bounds: Rect,
    selection: Rect,
    width: f64,
    height: f64,
    physical_origin_x: i32,
    physical_origin_y: i32,
    scale_factor: f64,
) -> (i32, i32, u32, u32) {
    let (logical_x, logical_y) = scroll_control_position(bounds, selection, width, height);
    let scale = scale_factor.max(1.0);
    (
        physical_origin_x + ((logical_x - bounds.x) * scale).round() as i32,
        physical_origin_y + ((logical_y - bounds.y) * scale).round() as i32,
        (width * scale).round().max(1.0) as u32,
        (height * scale).round().max(1.0) as u32,
    )
}

#[cfg(target_os = "windows")]
fn prewarm_scroll_control(app: &AppHandle) {
    if app.get_webview_window("scroll-control").is_some() {
        return;
    }
    app.state::<AppState>()
        .scroll_control_ready
        .store(false, Ordering::SeqCst);
    let result = WebviewWindowBuilder::new(
        app,
        "scroll-control",
        WebviewUrl::App("index.html?view=scroll-capture".into()),
    )
    .title("LiteSnap")
    .inner_size(300.0, 420.0)
    .decorations(false)
    .transparent(false)
    .background_color(tauri::window::Color(22, 22, 30, 255))
    .shadow(true)
    .resizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .content_protected(true)
    .focusable(false)
    .visible(false)
    .build();
    match result {
        Ok(window) => {
            let _ = window.set_ignore_cursor_events(false);
            let _ = window.hide();
        }
        Err(error) => eprintln!("Unable to prewarm Windows scroll control: {error}"),
    }
}

fn open_scroll_control(app: &AppHandle, selection: Rect) -> Result<(), String> {
    let capture = app
        .state::<AppState>()
        .capture
        .lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| "No capture display is available".to_string())?;
    let bounds = capture.bounds;
    let width = 300.0;
    let height = 420.0;
    let (x, y) = scroll_control_position(bounds, selection, width, height);
    if let Some(window) = app.get_webview_window("scroll-control") {
        #[cfg(not(target_os = "windows"))]
        window
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        #[cfg(target_os = "windows")]
        {
            let (physical_x, physical_y, physical_width, physical_height) =
                scroll_control_physical_geometry(
                    bounds,
                    selection,
                    width,
                    height,
                    capture.physical_origin_x,
                    capture.physical_origin_y,
                    capture.scale_factor,
                );
            // Windows uses one global physical desktop coordinate space, while
            // Tauri logical positions are converted using the window's current
            // monitor. On mixed-DPI secondary displays that conversion can put
            // this panel completely off-screen. Always pin it to the selected
            // monitor using native physical coordinates and dimensions.
            window
                .set_position(tauri::PhysicalPosition::new(physical_x, physical_y))
                .map_err(|error| error.to_string())?;
            window
                .set_size(tauri::PhysicalSize::new(physical_width, physical_height))
                .map_err(|error| error.to_string())?;
            // Keep wheel input on the browser below the cursor, but explicitly
            // keep mouse hit-testing enabled so Done/Cancel remain clickable.
            window
                .set_focusable(false)
                .map_err(|error| error.to_string())?;
            window
                .set_ignore_cursor_events(false)
                .map_err(|error| error.to_string())?;
            window
                .set_always_on_top(true)
                .map_err(|error| error.to_string())?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            window.show().map_err(|error| error.to_string())?;
            return window.set_focus().map_err(|error| error.to_string());
        }
        #[cfg(target_os = "windows")]
        {
            // Do not reveal a blank WebView2 surface. The ready worker below
            // shows this already-positioned window only after React has
            // registered Preview and Done/Cancel handlers.
            if app
                .state::<AppState>()
                .scroll_control_ready
                .load(Ordering::SeqCst)
            {
                window.show().map_err(|error| error.to_string())?;
            }
            return Ok(());
        }
    }
    let builder = WebviewWindowBuilder::new(
        app,
        "scroll-control",
        WebviewUrl::App("index.html?view=scroll-capture".into()),
    )
    .title("LiteSnap")
    .position(x, y)
    .inner_size(width, height)
    .decorations(false)
    .shadow(true)
    .resizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .content_protected(true)
    .visible(false);
    #[cfg(target_os = "windows")]
    let builder = builder
        // An opaque WebView host avoids a Windows/WebView2 composition race
        // where a transparent, non-activating top-level window stays visually
        // absent until it receives focus. The panel itself remains translucent
        // through its CSS over this dark background.
        .transparent(false)
        .background_color(tauri::window::Color(22, 22, 30, 255))
        .focusable(false);
    #[cfg(not(target_os = "windows"))]
    let builder = builder.transparent(true);
    #[cfg(target_os = "windows")]
    app.state::<AppState>()
        .scroll_control_ready
        .store(false, Ordering::SeqCst);
    let window = builder.build().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    {
        let (physical_x, physical_y, physical_width, physical_height) =
            scroll_control_physical_geometry(
                bounds,
                selection,
                width,
                height,
                capture.physical_origin_x,
                capture.physical_origin_y,
                capture.scale_factor,
            );
        window
            .set_position(tauri::PhysicalPosition::new(physical_x, physical_y))
            .map_err(|error| error.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(physical_width, physical_height))
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "windows")]
    return Ok(());
    #[cfg(not(target_os = "windows"))]
    window.show().map_err(|error| error.to_string())
}

fn stop_scroll(state: &AppState) {
    state.scroll_generation.fetch_add(1, Ordering::SeqCst);
    *state.scroll_rect.lock().unwrap() = None;
}

fn cancel_scroll_impl(app: &AppHandle) {
    let state = app.state::<AppState>();
    stop_scroll(&state);
    if let Some(pipeline) = state.scroll_pipeline.lock().unwrap().take() {
        let _ = pipeline.frames.try_send(ScrollFrameMessage::Cancel);
    }
    if let Some(window) = app.get_webview_window("scroll-control") {
        let _ = window.hide();
    }
    let _ = app.emit_to("overlay", "scroll-capture-cancelled", ());
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.show();
    }
}

fn finish_scroll_impl(app: &AppHandle) {
    let state = app.state::<AppState>();
    let final_rect = *state.scroll_rect.lock().unwrap();
    stop_scroll(&state);
    let pipeline = state.scroll_pipeline.lock().unwrap().take();
    if let Some(window) = app.get_webview_window("scroll-control") {
        let _ = window.hide();
    }
    let worker_app = app.clone();
    thread::spawn(move || {
        // Stop producing first, then enqueue one final raw frame behind all
        // frames already captured. Waiting for the stitcher to drain preserves
        // both fast intermediate movement and the tail visible when Done was
        // clicked.
        let session = pipeline.and_then(|pipeline| {
            if let Some(rect) = final_rect {
                if let Ok(frame) = capture_region_image(&worker_app, rect) {
                    let _ = pipeline.frames.send(ScrollFrameMessage::Frame(frame));
                }
            }
            let _ = pipeline.frames.send(ScrollFrameMessage::Finish);
            pipeline.finished.recv().ok()
        });
        if let Some(session) = session {
            let image = session.render();
            if let Ok(png) = png_bytes(&image) {
                let result = ScrollResult {
                    base64: BASE64.encode(png),
                    image_width: image.width(),
                    image_height: image.height(),
                };
                let _ = worker_app.emit_to("overlay", "scroll-capture-result", result);
            }
        }
        let _ = worker_app.emit_to("overlay", "scroll-capture-finished", ());
    });
}

fn suspend_shortcut(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.shortcut_suspended.store(true, Ordering::SeqCst);
    if let Some(shortcut) = state.registered_shortcut.lock().unwrap().take() {
        let _ = app
            .global_shortcut()
            .unregister(tauri_shortcut(&shortcut).as_str());
    }
}

fn register_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.shortcut_suspended.load(Ordering::SeqCst) {
        return Ok(());
    }
    if let Some(old) = state.registered_shortcut.lock().unwrap().take() {
        let _ = app
            .global_shortcut()
            .unregister(tauri_shortcut(&old).as_str());
    }
    app.global_shortcut()
        .register(tauri_shortcut(shortcut).as_str())
        .map_err(|error| error.to_string())?;
    *state.registered_shortcut.lock().unwrap() = Some(shortcut.into());
    Ok(())
}

fn resume_shortcut(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.shortcut_suspended.store(false, Ordering::SeqCst);
    let shortcut = state.settings.lock().unwrap().capture_shortcut.clone();
    if let Err(error) = register_shortcut(app, &shortcut) {
        eprintln!("Unable to resume shortcut {shortcut}: {error}");
    }
}

fn tray_strings(language: &str) -> [&'static str; 9] {
    match language {
        "zh" => [
            "截图",
            "更改快捷键…",
            "语言",
            "English",
            "中文（简体）",
            "中文（繁體）",
            "打开屏幕录制权限…",
            "开机自动启动",
            "退出",
        ],
        "zh-TW" => [
            "截圖",
            "變更快捷鍵…",
            "語言",
            "English",
            "中文（简体）",
            "中文（繁體）",
            "開啟螢幕錄製權限…",
            "開機自動啟動",
            "結束",
        ],
        _ => [
            "Capture",
            "Change Shortcut…",
            "Language",
            "English",
            "中文（简体）",
            "中文（繁體）",
            "Open Screen Permission…",
            "Launch at Startup",
            "Quit",
        ],
    }
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = app.state::<AppState>().settings.lock().unwrap().clone();
    let labels = tray_strings(&settings.language);
    let capture = MenuItem::with_id(
        app,
        "capture",
        format!("{} ({})", labels[0], settings.capture_shortcut),
        true,
        None::<&str>,
    )?;
    let shortcut = MenuItem::with_id(app, "shortcut", labels[1], true, None::<&str>)?;
    let en = CheckMenuItem::with_id(
        app,
        "language-en",
        labels[3],
        true,
        settings.language == "en",
        None::<&str>,
    )?;
    let zh = CheckMenuItem::with_id(
        app,
        "language-zh",
        labels[4],
        true,
        settings.language == "zh",
        None::<&str>,
    )?;
    let zh_tw = CheckMenuItem::with_id(
        app,
        "language-zh-TW",
        labels[5],
        true,
        settings.language == "zh-TW",
        None::<&str>,
    )?;
    let language = Submenu::with_items(app, labels[2], true, &[&en, &zh, &zh_tw])?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        labels[7],
        true,
        settings.launch_at_startup,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", labels[8], true, None::<&str>)?;
    #[cfg(target_os = "macos")]
    {
        let permission =
            MenuItem::with_id(app, "screen-permission", labels[6], true, None::<&str>)?;
        Menu::with_items(
            app,
            &[
                &capture,
                &shortcut,
                &language,
                &permission,
                &autostart,
                &separator,
                &quit,
            ],
        )
    }
    #[cfg(not(target_os = "macos"))]
    Menu::with_items(
        app,
        &[
            &capture, &shortcut, &language, &autostart, &separator, &quit,
        ],
    )
}

fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), build_tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn change_language(app: &AppHandle, language: &str) -> AppSettings {
    let state = app.state::<AppState>();
    let settings = {
        let mut settings = state.settings.lock().unwrap();
        if matches!(language, "en" | "zh" | "zh-TW") {
            settings.language = language.into();
            let _ = persist_settings(&settings);
        }
        settings.clone()
    };
    refresh_tray(app);
    let _ = app.emit("settings-changed", settings.clone());
    settings
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())
    } else {
        manager.disable().map_err(|error| error.to_string())
    }
}

fn toggle_autostart(app: &AppHandle) -> Result<(), String> {
    let enabled = !app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .launch_at_startup;
    apply_autostart(app, enabled)?;
    {
        let state = app.state::<AppState>();
        let mut settings = state.settings.lock().unwrap();
        settings.launch_at_startup = enabled;
        if let Err(error) = persist_settings(&settings) {
            settings.launch_at_startup = !enabled;
            let _ = apply_autostart(app, !enabled);
            return Err(error);
        }
    }
    refresh_tray(app);
    let settings = app.state::<AppState>().settings.lock().unwrap().clone();
    let _ = app.emit("settings-changed", settings);
    Ok(())
}

#[tauri::command]
fn close_overlay(app: AppHandle) {
    close_overlay_impl(&app);
}

#[tauri::command]
fn show_capture_overlay(app: AppHandle) -> Result<bool, String> {
    if app.state::<AppState>().capture.lock().unwrap().is_none() {
        return Err("No screenshot is available".into());
    }
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "Capture overlay is unavailable".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn scroll_control_ready(state: State<AppState>) {
    // The first scroll-control WebView is created lazily. Its renderer must
    // register the preview listeners before native capture emits the baseline;
    // otherwise Windows can load the WebView slowly enough to lose the only
    // initial preview event.
    state.scroll_control_ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn get_full_screenshot(state: State<AppState>) -> Result<FullScreenshot, String> {
    let capture = state
        .capture
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No screenshot is available".to_string())?;
    Ok(FullScreenshot {
        base64: BASE64.encode(&capture.png),
        display_width: capture.bounds.width,
        display_height: capture.bounds.height,
        image_width: capture.image_width,
        image_height: capture.image_height,
    })
}

#[tauri::command]
fn begin_scroll_capture(
    app: AppHandle,
    state: State<AppState>,
    rect: Rect,
) -> Result<bool, String> {
    if state.scroll_rect.lock().unwrap().is_some() {
        return Err("Scroll capture already in progress".into());
    }
    *state.scroll_rect.lock().unwrap() = Some(rect);
    let generation = state.scroll_generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(window) = app.get_webview_window("overlay") {
        window.hide().map_err(|error| error.to_string())?;
    }
    // Capture the baseline immediately after hiding the selection overlay.
    // Waiting for the controller window to open first allowed an eager wheel
    // gesture to move the target before its first frame was recorded, which
    // made the beginning of the long screenshot disappear. The controller is
    // content-protected, so it can safely be shown after this baseline.
    let initial = match capture_region_image(&app, rect) {
        Ok(initial) => initial,
        Err(error) => {
            cancel_scroll_impl(&app);
            return Err(error);
        }
    };
    if let Err(error) = open_scroll_control(&app, rect) {
        cancel_scroll_impl(&app);
        return Err(error);
    }
    // Allow the protected control window to finish compositing without
    // delaying the baseline that was already captured above.
    thread::sleep(Duration::from_millis(24));
    let frame_bytes = (initial.width() as usize)
        .saturating_mul(initial.height() as usize)
        .saturating_mul(4)
        .max(1);
    let frame_capacity = (SCROLL_FRAME_BUFFER_BYTES / frame_bytes).clamp(6, 64);
    let initial_fingerprint = scroll_frame_fingerprint(&initial);
    let session = NativeScrollSession::new(initial);
    let initial_preview = encode_scroll_preview(session.preview_snapshot()).ok();
    let ready_app = app.clone();
    thread::spawn(move || {
        // The WebView is created on demand. Wait for its renderer-side ready
        // signal before sending the start/reset and baseline preview events.
        // This removes the Windows-only race where the control appeared with
        // an empty preview because both events were emitted during navigation.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let ready_state = ready_app.state::<AppState>();
            if ready_state.scroll_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            if ready_state.scroll_control_ready.load(Ordering::SeqCst) || Instant::now() >= deadline
            {
                #[cfg(target_os = "windows")]
                if let Some(window) = ready_app.get_webview_window("scroll-control") {
                    // Positioning is completed before this worker starts. Show
                    // only now so Windows never exposes the empty WebView2 host
                    // that looked like a stray layer and had no working Done.
                    let _ = window.show();
                }
                let _ = ready_app.emit_to("scroll-control", "scroll-capture-started", ());
                if let Some(preview) = initial_preview {
                    let _ = ready_app.emit_to("scroll-control", "scroll-capture-preview", preview);
                }
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
    });

    // Native overlap detection is intentionally thorough and can take longer
    // than a screen capture on dense/Retina pages. Keep capture and stitching
    // on separate threads and size the raw-frame queue by memory, so ordinary
    // pages can absorb a burst of fast trackpad scrolling without pausing the
    // capture loop. Very large/Retina selections still remain memory-bounded.
    let (frame_tx, frame_rx) = mpsc::sync_channel::<ScrollFrameMessage>(frame_capacity);
    let (finished_tx, finished_rx) = mpsc::sync_channel::<NativeScrollSession>(1);
    let stitch_app = app.clone();
    let preview_encoding = Arc::new(AtomicBool::new(false));
    let stitch_preview_encoding = preview_encoding.clone();
    thread::spawn(move || {
        let mut session = session;
        let mut last_preview = Instant::now();
        while let Ok(message) = frame_rx.recv() {
            match message {
                ScrollFrameMessage::Frame(frame) => {
                    if session.append(frame) && last_preview.elapsed() >= Duration::from_millis(600)
                    {
                        last_preview = Instant::now();
                        // PNG encoding an ever-growing preview can be much
                        // slower than matching one viewport. Encode it off the
                        // stitching thread so live preview cannot make the raw
                        // frame queue fall behind and lose intermediate rows.
                        if !stitch_preview_encoding.swap(true, Ordering::SeqCst) {
                            let snapshot = session.preview_snapshot();
                            let preview_app = stitch_app.clone();
                            let encoding = stitch_preview_encoding.clone();
                            thread::spawn(move || {
                                if let Ok(preview) = encode_scroll_preview(snapshot) {
                                    // A tall preview may finish encoding after
                                    // Done/Cancel or even after a new session
                                    // starts. Never let that stale image replace
                                    // the next capture's baseline preview.
                                    if preview_app
                                        .state::<AppState>()
                                        .scroll_generation
                                        .load(Ordering::SeqCst)
                                        == generation
                                    {
                                        let _ = preview_app.emit_to(
                                            "scroll-control",
                                            "scroll-capture-preview",
                                            preview,
                                        );
                                    }
                                }
                                encoding.store(false, Ordering::SeqCst);
                            });
                        }
                    }
                }
                ScrollFrameMessage::Finish => {
                    let _ = finished_tx.send(session);
                    break;
                }
                ScrollFrameMessage::Cancel => break,
            }
        }
    });
    *state.scroll_pipeline.lock().unwrap() = Some(ScrollPipeline {
        frames: frame_tx.clone(),
        finished: finished_rx,
    });

    let poll_app = app.clone();
    thread::spawn(move || {
        // The baseline was just captured; wait until the next sampling slot so
        // the first queued frame represents user movement rather than a second
        // copy of the initial viewport.
        thread::sleep(Duration::from_millis(24));
        // Start in high-rate mode so the first wheel/trackpad gesture cannot
        // jump past the available overlap before movement has been detected.
        let mut moving_until = Instant::now() + Duration::from_secs(1);
        let mut last_queued_fingerprint = initial_fingerprint;
        let mut last_queued_at = Instant::now();
        loop {
            let frame_started = Instant::now();
            let state = poll_app.state::<AppState>();
            if state.scroll_generation.load(Ordering::SeqCst) != generation {
                break;
            }
            let rect = *state.scroll_rect.lock().unwrap();
            let Some(rect) = rect else { break };
            match capture_region_image(&poll_app, rect) {
                Ok(frame) => {
                    // Done/cancel may have happened while native capture was in
                    // progress. Never append that stale frame after finalizing.
                    if state.scroll_generation.load(Ordering::SeqCst) != generation {
                        break;
                    }
                    let fingerprint = scroll_frame_fingerprint(&frame);
                    let frame_changed = fingerprint != last_queued_fingerprint;
                    let force_refresh = last_queued_at.elapsed() >= SCROLL_IDLE_REFRESH_INTERVAL;
                    if !frame_changed && !force_refresh {
                        let interval = if Instant::now() < moving_until {
                            Duration::from_millis(16)
                        } else {
                            Duration::from_millis(24)
                        };
                        if let Some(remaining) = interval.checked_sub(frame_started.elapsed()) {
                            thread::sleep(remaining);
                        }
                        continue;
                    }
                    let mut message = ScrollFrameMessage::Frame(frame);
                    loop {
                        match frame_tx.try_send(message) {
                            Ok(()) => {
                                last_queued_fingerprint = fingerprint;
                                last_queued_at = Instant::now();
                                if frame_changed {
                                    moving_until = Instant::now() + Duration::from_millis(350);
                                }
                                break;
                            }
                            Err(TrySendError::Full(returned)) => {
                                if state.scroll_generation.load(Ordering::SeqCst) != generation {
                                    return;
                                }
                                message = returned;
                                thread::sleep(Duration::from_millis(2));
                            }
                            Err(TrySendError::Disconnected(_)) => return,
                        }
                    }
                }
                Err(error) => eprintln!("Scroll capture poll failed: {error}"),
            }
            // Sample at 60 fps while movement is active to preserve overlap,
            // then back off while idle so screen capture does not waste CPU.
            let interval = if Instant::now() < moving_until {
                Duration::from_millis(16)
            } else {
                Duration::from_millis(24)
            };
            if let Some(remaining) = interval.checked_sub(frame_started.elapsed()) {
                thread::sleep(remaining);
            }
        }
    });
    Ok(true)
}

#[tauri::command]
fn finish_scroll_capture(app: AppHandle) -> bool {
    finish_scroll_impl(&app);
    true
}

#[tauri::command]
fn cancel_scroll_capture(app: AppHandle) -> bool {
    cancel_scroll_impl(&app);
    true
}

#[tauri::command]
fn check_screen_permission() -> serde_json::Value {
    let granted = screen_permission_granted();
    serde_json::json!({ "granted": granted, "status": if granted { "granted" } else { "denied" } })
}

#[tauri::command]
fn copy_image(app: AppHandle, data: Vec<u8>) -> Result<bool, String> {
    write_clipboard_png(&data)?;
    close_overlay_impl(&app);
    Ok(true)
}

#[tauri::command]
fn save_image(app: AppHandle, data: Vec<u8>) -> Result<bool, String> {
    write_clipboard_png(&data)?;
    close_overlay_impl(&app);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let Some(path) = rfd::FileDialog::new()
        .set_title("Save Screenshot")
        .set_file_name(format!("LiteSnap-{stamp}.png"))
        .add_filter("PNG Image", &["png"])
        .save_file()
    else {
        return Ok(false);
    };
    fs::write(path, data).map_err(|error| error.to_string())?;
    Ok(true)
}

fn pin_image_impl(app: AppHandle, data: Vec<u8>) -> Result<bool, String> {
    // Reading the PNG header is enough to size the native window. Fully
    // decoding a large/long screenshot on Tauri's IPC thread can starve the
    // Windows event loop, which also prevents Cancel and the global shortcut
    // from being processed.
    let (pixel_width, pixel_height) = image::io::Reader::new(Cursor::new(&data))
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .into_dimensions()
        .map_err(|error| error.to_string())?;
    let capture = app.state::<AppState>().capture.lock().unwrap().clone();
    let scale = capture
        .as_ref()
        .map(|capture| capture.scale_factor)
        .unwrap_or(1.0)
        .max(1.0);
    let natural_width = pixel_width as f64 / scale;
    let natural_height = pixel_height as f64 / scale;
    let screen_bounds = if let Some(capture) = capture.as_ref() {
        capture.bounds
    } else {
        let info = active_screen(&app)?.display_info;
        Rect {
            x: info.x as f64,
            y: info.y as f64,
            width: info.width as f64,
            height: info.height as f64,
        }
    };
    let max_width = (screen_bounds.width - 40.0).max(160.0);
    let max_height = (screen_bounds.height - 40.0).max(160.0);
    let fit = (max_width / natural_width)
        .min(max_height / natural_height)
        .min(1.0);
    let window_width = (natural_width * fit).max(60.0);
    let window_height = (natural_height * fit).max(60.0);
    let window_x = screen_bounds.x + (screen_bounds.width - window_width) / 2.0;
    let window_y = screen_bounds.y + (screen_bounds.height - window_height) / 2.0;
    #[cfg(target_os = "windows")]
    let physical_geometry = capture.as_ref().map(|capture| {
        let scale = capture.scale_factor.max(1.0);
        (
            capture.physical_origin_x + ((window_x - capture.bounds.x) * scale).round() as i32,
            capture.physical_origin_y + ((window_y - capture.bounds.y) * scale).round() as i32,
            (window_width * scale).round().max(1.0) as u32,
            (window_height * scale).round().max(1.0) as u32,
        )
    });
    *app.state::<AppState>().pin_data.lock().unwrap() = Some(data);

    #[cfg(target_os = "windows")]
    if app.get_webview_window("pin").is_none() {
        build_pin_window(&app, window_x, window_y, window_width, window_height)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(window) = app.get_webview_window("pin") {
            let _ = window.close();
        }
        build_pin_window(&app, window_x, window_y, window_width, window_height)?;
    }

    let window = app
        .get_webview_window("pin")
        .ok_or_else(|| "Pin window is unavailable".to_string())?;
    #[cfg(target_os = "windows")]
    {
        // Reuse the renderer created during startup. Destroying a WebView2 and
        // immediately rebuilding another with the same label can deadlock the
        // Windows UI thread and leave the capture session permanently busy.
        window.hide().map_err(|error| error.to_string())?;
        if let Some((x, y, width, height)) = physical_geometry {
            // A physical window pixel now maps to one captured image pixel.
            // This also avoids sizing the reused WebView with the DPI of the
            // monitor where it was prewarmed instead of the capture monitor.
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|error| error.to_string())?;
            window
                .set_size(tauri::PhysicalSize::new(width, height))
                .map_err(|error| error.to_string())?;
        } else {
            window
                .set_position(tauri::LogicalPosition::new(window_x, window_y))
                .map_err(|error| error.to_string())?;
            window
                .set_size(tauri::LogicalSize::new(window_width, window_height))
                .map_err(|error| error.to_string())?;
        }
        let _ = window.emit("pin-image-updated", ());
    }
    window.show().map_err(|error| error.to_string())?;
    close_overlay_impl(&app);
    Ok(true)
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn pin_image(app: AppHandle, data_base64: String) -> Result<bool, String> {
    // Decode away from the WebView2/UI thread. Large screenshots must not hold
    // up Cancel, window events, or the global screenshot shortcut.
    let data = tauri::async_runtime::spawn_blocking(move || {
        BASE64
            .decode(data_base64)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    pin_image_impl(app, data)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn pin_image(app: AppHandle, data: Vec<u8>) -> Result<bool, String> {
    pin_image_impl(app, data)
}

#[tauri::command]
fn get_pin_image(state: State<AppState>) -> Result<String, String> {
    state
        .pin_data
        .lock()
        .unwrap()
        .as_ref()
        .map(|data| BASE64.encode(data))
        .ok_or_else(|| "No pinned image is available".into())
}

#[tauri::command]
fn close_pin_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("pin") {
        #[cfg(target_os = "windows")]
        let _ = window.hide();
        #[cfg(not(target_os = "windows"))]
        let _ = window.destroy();
    }
    *app.state::<AppState>().pin_data.lock().unwrap() = None;
}

#[tauri::command]
fn open_url(url: String) -> Result<bool, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only HTTP(S) URLs are allowed".into());
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", &url]).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(&url).status();
    status.map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_language(app: AppHandle, language: String) -> AppSettings {
    change_language(&app, &language)
}

#[tauri::command]
fn set_capture_shortcut(app: AppHandle, shortcut: String) -> SetShortcutResult {
    let normalized = normalize_shortcut(shortcut.trim());
    let state = app.state::<AppState>();
    if !is_valid_shortcut(&normalized) {
        return SetShortcutResult {
            ok: false,
            settings: state.settings.lock().unwrap().clone(),
            error: Some("shortcutInvalid".into()),
        };
    }
    state.shortcut_suspended.store(false, Ordering::SeqCst);
    if register_shortcut(&app, &normalized).is_err() {
        let current = state.settings.lock().unwrap().clone();
        let _ = register_shortcut(&app, &current.capture_shortcut);
        return SetShortcutResult {
            ok: false,
            settings: current,
            error: Some("shortcutInUse".into()),
        };
    }
    let settings = {
        let mut settings = state.settings.lock().unwrap();
        settings.capture_shortcut = normalized;
        let _ = persist_settings(&settings);
        settings.clone()
    };
    refresh_tray(&app);
    let _ = app.emit("settings-changed", settings.clone());
    SetShortcutResult {
        ok: true,
        settings,
        error: None,
    }
}

#[tauri::command]
fn begin_shortcut_recording(app: AppHandle) {
    suspend_shortcut(&app);
}

#[tauri::command]
fn end_shortcut_recording(app: AppHandle) {
    resume_shortcut(&app);
}

#[tauri::command]
fn close_shortcut_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("shortcut") {
        let _ = window.close();
    }
    resume_shortcut(&app);
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        handle_start_capture(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            settings: Mutex::new(load_settings()),
            capture: Mutex::new(None),
            pin_data: Mutex::new(None),
            registered_shortcut: Mutex::new(None),
            shortcut_suspended: AtomicBool::new(false),
            scroll_rect: Mutex::new(None),
            scroll_pipeline: Mutex::new(None),
            scroll_generation: AtomicU64::new(0),
            scroll_control_ready: AtomicBool::new(false),
            screen_permission_requested: AtomicBool::new(false),
            capture_in_progress: AtomicBool::new(false),
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let launch_at_startup = app
                .state::<AppState>()
                .settings
                .lock()
                .unwrap()
                .launch_at_startup;
            if let Err(error) = apply_autostart(app.handle(), launch_at_startup) {
                eprintln!("Unable to update launch-at-startup setting: {error}");
            }

            let menu = build_tray_menu(app.handle())?;
            let tray_icon = Image::from_bytes(include_bytes!("../../resources/tray.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                // The bundled icon is full-colour and fully opaque. Marking it
                // as a macOS template turns its entire canvas into a solid
                // square instead of drawing the LiteSnap glyph.
                .icon_as_template(false)
                .tooltip("LiteSnap")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "capture" => {
                        handle_start_capture(app);
                    }
                    "shortcut" => {
                        if let Err(error) = open_shortcut_window(app) {
                            eprintln!("Unable to open shortcut window: {error}");
                        }
                    }
                    "language-en" => { change_language(app, "en"); }
                    "language-zh" => { change_language(app, "zh"); }
                    "language-zh-TW" => { change_language(app, "zh-TW"); }
                    "screen-permission" => open_screen_settings(),
                    "autostart" => {
                        if let Err(error) = toggle_autostart(app) {
                            let _ = rfd::MessageDialog::new()
                                .set_title("Unable to update startup setting")
                                .set_description(error)
                                .set_level(rfd::MessageLevel::Error)
                                .show();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Keep a hidden WebView ready so the first shortcut press only has
            // to capture pixels and resize/show the existing native window.
            prewarm_overlay(app.handle());
            #[cfg(target_os = "windows")]
            {
                prewarm_scroll_control(app.handle());
                prewarm_pin_window(app.handle());
            }

            let shortcut = app.state::<AppState>().settings.lock().unwrap().capture_shortcut.clone();
            eprintln!("LiteSnap capture shortcut: {shortcut}");
            if let Err(error) = register_shortcut(app.handle(), &shortcut) {
                eprintln!("Unable to register {shortcut}: {error}");
                if shortcut != default_shortcut() {
                    if register_shortcut(app.handle(), default_shortcut()).is_ok() {
                        let state = app.state::<AppState>();
                        {
                            let mut settings = state.settings.lock().unwrap();
                            settings.capture_shortcut = default_shortcut().into();
                            let _ = persist_settings(&settings);
                        }
                        refresh_tray(app.handle());
                    } else {
                        let _ = rfd::MessageDialog::new()
                            .set_title("Shortcut unavailable")
                            .set_description("LiteSnap could not register the capture shortcut. Choose another shortcut from the tray menu.")
                            .set_level(rfd::MessageLevel::Warning)
                            .show();
                        let _ = open_shortcut_window(app.handle());
                    }
                } else {
                    let _ = rfd::MessageDialog::new()
                        .set_title("Shortcut unavailable")
                        .set_description("LiteSnap could not register the capture shortcut. Choose another shortcut from the tray menu.")
                        .set_level(rfd::MessageLevel::Warning)
                        .show();
                    let _ = open_shortcut_window(app.handle());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            close_overlay,
            show_capture_overlay,
            scroll_control_ready,
            get_full_screenshot,
            begin_scroll_capture,
            finish_scroll_capture,
            cancel_scroll_capture,
            check_screen_permission,
            copy_image,
            save_image,
            pin_image,
            get_pin_image,
            close_pin_window,
            open_url,
            get_settings,
            set_language,
            set_capture_shortcut,
            begin_shortcut_recording,
            end_shortcut_recording,
            close_shortcut_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building LiteSnap");

    app.run(|_app, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            // Closing the capture, settings, or pinned-image window must not
            // terminate this tray application. Programmatic exits (the tray
            // menu's Quit action) include an exit code and remain allowed.
            api.prevent_exit();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_document(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_fn(width, height, |x, y| {
            let seed = x.wrapping_mul(73_856_093) ^ y.wrapping_mul(19_349_663);
            image::Rgba([
                (seed & 0xff) as u8,
                ((seed >> 8) & 0xff) as u8,
                ((seed >> 16) & 0xff) as u8,
                255,
            ])
        })
    }

    fn sticky_header_frame(header: &RgbaImage, content: &RgbaImage, offset: u32) -> RgbaImage {
        let mut frame = RgbaImage::new(content.width(), 300);
        imageops::replace(&mut frame, header, 0, 0);
        let visible = imageops::crop_imm(content, 0, offset, content.width(), 240).to_image();
        imageops::replace(&mut frame, &visible, 0, 60);
        frame
    }

    fn fixed_sidebar_frame(sidebar: &RgbaImage, content: &RgbaImage, offset: u32) -> RgbaImage {
        let mut frame = RgbaImage::new(400, 300);
        imageops::replace(&mut frame, sidebar, 0, 0);
        let visible = imageops::crop_imm(content, 0, offset, 120, 300).to_image();
        imageops::replace(&mut frame, &visible, 280, 0);
        frame
    }

    fn tall_fixed_header_frame(header: &RgbaImage, content: &RgbaImage, offset: u32) -> RgbaImage {
        let mut frame = RgbaImage::new(content.width(), 300);
        imageops::replace(&mut frame, header, 0, 0);
        let visible = imageops::crop_imm(content, 0, offset, content.width(), 160).to_image();
        imageops::replace(&mut frame, &visible, 0, 140);
        frame
    }

    fn animated_panel_with_scrollbar(color: [u8; 4], thumb_top: u32) -> RgbaImage {
        let mut frame = RgbaImage::from_pixel(240, 300, image::Rgba([255, 255, 255, 255]));
        for y in 0..300 {
            for x in 0..200 {
                frame.put_pixel(x, y, image::Rgba(color));
            }
        }
        for y in thumb_top..thumb_top + 30 {
            for x in 235..239 {
                frame.put_pixel(x, y, image::Rgba([145, 145, 145, 255]));
            }
        }
        frame
    }

    fn document_frame_with_scrollbar(
        document: &RgbaImage,
        offset: u32,
        thumb_top: u32,
    ) -> RgbaImage {
        let mut frame = imageops::crop_imm(document, 0, offset, 240, 300).to_image();
        for y in 0..300 {
            for x in 200..240 {
                frame.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
            }
        }
        for y in thumb_top..thumb_top + 30 {
            for x in 235..239 {
                frame.put_pixel(x, y, image::Rgba([145, 145, 145, 255]));
            }
        }
        frame
    }

    fn repeated_review_document(width: u32, height: u32) -> RgbaImage {
        let mut document = RgbaImage::from_pixel(width, height, image::Rgba([255, 255, 255, 255]));
        for (card, top) in (0..height).step_by(180).enumerate() {
            for x in 12..width - 12 {
                document.put_pixel(x, top, image::Rgba([220, 224, 228, 255]));
            }
            for star in 0..5 {
                for y in top + 18..(top + 26).min(height) {
                    for x in 18 + star * 12..26 + star * 12 {
                        document.put_pixel(x, y, image::Rgba([255, 76, 70, 255]));
                    }
                }
            }
            for y in top + 48..(top + 70).min(height) {
                for x in 18..width - 22 {
                    document.put_pixel(x, y, image::Rgba([241, 243, 246, 255]));
                }
            }
            // Each review has text at a slightly different position/length,
            // while the large separator/rating template remains identical.
            let text_top = top + 92 + (card as u32 % 4) * 5;
            for line in 0..3_u32 {
                let length = 80 + ((card as u32 * 37 + line * 29) % 105);
                for y in text_top + line * 15..(text_top + line * 15 + 4).min(height) {
                    for x in 18..(18 + length).min(width - 18) {
                        if (x + y + card as u32) % 7 != 0 {
                            document.put_pixel(x, y, image::Rgba([52, 56, 61, 255]));
                        }
                    }
                }
            }
        }
        document
    }

    #[test]
    fn native_scroll_stitch_preserves_all_content() {
        let document = test_document(240, 1_200);
        let offsets = [0, 60, 140, 250, 400, 600, 780, 900];
        let initial = imageops::crop_imm(&document, 0, offsets[0], 240, 300).to_image();
        let mut session = NativeScrollSession::new(initial);
        for offset in offsets.into_iter().skip(1) {
            let frame = imageops::crop_imm(&document, 0, offset, 240, 300).to_image();
            let overlap =
                native_vertical_overlap(&session.last_frame, &frame).map(|matched| matched.overlap);
            assert!(
                session.append(frame),
                "frame at {offset} was not appended; overlap={overlap:?}"
            );
        }
        assert_eq!(session.total_height, 1_200);
        assert_eq!(session.render(), document);
    }

    #[test]
    fn native_scroll_stitch_preserves_full_multi_column_width() {
        let document = test_document(600, 1_200);
        let offsets = [0, 90, 210, 360, 540, 720, 900];
        let initial = imageops::crop_imm(&document, 0, offsets[0], 600, 300).to_image();
        let mut session = NativeScrollSession::new(initial);
        for offset in offsets.into_iter().skip(1) {
            let frame = imageops::crop_imm(&document, 0, offset, 600, 300).to_image();
            assert!(session.append(frame), "frame at {offset} was not appended");
        }

        let rendered = session.render();
        assert_eq!(rendered, document);
        assert_eq!(
            imageops::crop_imm(&rendered, 0, 0, 180, rendered.height()).to_image(),
            imageops::crop_imm(&document, 0, 0, 180, document.height()).to_image()
        );
        assert_eq!(
            imageops::crop_imm(&rendered, 420, 0, 180, rendered.height()).to_image(),
            imageops::crop_imm(&document, 420, 0, 180, document.height()).to_image()
        );
    }

    #[test]
    fn native_overlap_uses_unique_text_edges_between_repeated_review_cards() {
        let document = repeated_review_document(240, 1_400);
        let previous = imageops::crop_imm(&document, 0, 260, 240, 300).to_image();
        let mut next = imageops::crop_imm(&document, 0, 340, 240, 300).to_image();
        // Simulate a small font/compositor colour change. The unique glyph
        // edges remain in place, but repeated solid rating bars alone would
        // favour the wrong review-card interval.
        for pixel in next.pixels_mut() {
            if pixel[0] < 90 && pixel[1] < 90 && pixel[2] < 90 {
                pixel[0] = pixel[0].saturating_add(24);
                pixel[1] = pixel[1].saturating_add(24);
                pixel[2] = pixel[2].saturating_add(24);
            }
        }
        let matched = native_vertical_overlap_with_hint(&previous, &next, Some(80))
            .expect("repeated review cards should still align");
        assert_eq!(matched.overlap, 220);
    }

    #[test]
    fn native_scroll_stitch_preserves_small_smooth_scroll_steps() {
        let document = test_document(240, 340);
        let initial = imageops::crop_imm(&document, 0, 0, 240, 300).to_image();
        let mut session = NativeScrollSession::new(initial);
        for offset in (4..=40).step_by(4) {
            let frame = imageops::crop_imm(&document, 0, offset, 240, 300).to_image();
            assert!(
                session.append(frame),
                "4px step ending at {offset} was lost"
            );
        }
        assert_eq!(session.total_height, 340);
        assert_eq!(session.render(), document);
    }

    #[test]
    fn scroll_frame_fingerprint_filters_only_unchanged_frames() {
        let frame = test_document(240, 300);
        let unchanged = frame.clone();
        assert_eq!(
            scroll_frame_fingerprint(&frame),
            scroll_frame_fingerprint(&unchanged)
        );

        // Change a sampled text-sized patch. The poller must treat small local
        // lazy-load/font updates as a new frame, rather than discarding them as
        // another idle capture.
        let mut changed = frame.clone();
        for y in 145..155 {
            for x in 115..125 {
                changed.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
            }
        }
        assert_ne!(
            scroll_frame_fingerprint(&frame),
            scroll_frame_fingerprint(&changed)
        );
    }

    #[test]
    fn scroll_control_prefers_space_outside_capture_selection() {
        let bounds = Rect {
            x: 1_920.0,
            y: 0.0,
            width: 1_920.0,
            height: 1_080.0,
        };
        let selection = Rect {
            x: 120.0,
            y: 100.0,
            width: 1_000.0,
            height: 800.0,
        };
        let (x, y) = scroll_control_position(bounds, selection, 300.0, 420.0);
        assert!(x >= bounds.x + selection.x + selection.width);
        assert!(y >= bounds.y);
        assert!(y + 420.0 <= bounds.y + bounds.height);
    }

    #[test]
    fn windows_scroll_control_geometry_uses_target_monitor_dpi() {
        let bounds = Rect {
            x: -1_706.666_666_7,
            y: 0.0,
            width: 1_706.666_666_7,
            height: 960.0,
        };
        let selection = Rect {
            x: 160.0,
            y: 100.0,
            width: 1_000.0,
            height: 700.0,
        };
        let (x, y, width, height) =
            scroll_control_physical_geometry(bounds, selection, 300.0, 420.0, -2_560, 0, 1.5);
        assert!((-2_560..=-450).contains(&x));
        assert!((0..=810).contains(&y));
        assert_eq!(width, 450);
        assert_eq!(height, 630);
        assert!(x + width as i32 <= 0);
        assert!(y + height as i32 <= 1_440);
    }

    #[test]
    fn native_scroll_stitch_preserves_fast_scroll_with_duplicate_samples() {
        let document = test_document(240, 1_200);
        let offsets = [0, 60, 140, 250, 400, 600, 780, 900];
        let initial = imageops::crop_imm(&document, 0, offsets[0], 240, 300).to_image();
        let mut session = NativeScrollSession::new(initial);

        // Real capture commonly observes the same compositor frame more than
        // once between wheel events. Interleaving those samples must neither
        // duplicate the opening viewport nor make a later fast-moving frame
        // lose its seam anchor.
        for offset in offsets.into_iter().skip(1) {
            let frame = imageops::crop_imm(&document, 0, offset, 240, 300).to_image();
            assert!(!session.append(session.last_frame.clone()));
            assert!(session.append(frame), "frame at {offset} was not appended");
        }
        assert_eq!(session.total_height, 1_200);
        assert_eq!(session.render(), document);
    }

    #[test]
    fn native_scroll_stitch_rejects_stationary_dynamic_frame() {
        let document = test_document(240, 300);
        let mut changed = document.clone();
        for y in 40..46 {
            for x in 40..46 {
                changed.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
            }
        }
        let mut session = NativeScrollSession::new(document);
        assert!(!session.append(changed));
        assert_eq!(session.total_height, 300);
    }

    #[test]
    fn native_scroll_stitch_recovers_after_unmatched_frame() {
        let document = test_document(240, 600);
        let initial = imageops::crop_imm(&document, 0, 0, 240, 300).to_image();
        let mut transient = initial.clone();
        for y in 140..146 {
            for x in 110..116 {
                transient.put_pixel(x, y, image::Rgba([17, 29, 43, 255]));
            }
        }
        let next = imageops::crop_imm(&document, 0, 100, 240, 300).to_image();
        let mut session = NativeScrollSession::new(initial);
        let _ = session.append(transient);
        assert!(session.append(next));
        assert_eq!(session.total_height, 400);
    }

    #[test]
    fn native_scroll_stitch_does_not_lose_distance_after_unmatched_moving_frame() {
        let document = test_document(240, 700);
        let initial = imageops::crop_imm(&document, 0, 0, 240, 300).to_image();
        let mut obscured = imageops::crop_imm(&document, 0, 80, 240, 300).to_image();
        // Simulate a large product image/skeleton changing while the page is
        // moving. This frame cannot be aligned reliably and must not become
        // the committed stitching anchor.
        for pixel in obscured.pixels_mut() {
            *pixel = image::Rgba([247, 247, 247, 255]);
        }
        let recovered = imageops::crop_imm(&document, 0, 160, 240, 300).to_image();

        let mut session = NativeScrollSession::new(initial);
        assert!(!session.append(obscured));
        assert!(session.append(recovered));
        assert_eq!(session.total_height, 460);
        assert_eq!(
            session.render(),
            imageops::crop_imm(&document, 0, 0, 240, 460).to_image()
        );
    }

    #[test]
    fn native_scroll_stitch_uses_scrollbar_for_animated_long_panels() {
        let first = animated_panel_with_scrollbar([255, 0, 0, 255], 20);
        let settling = animated_panel_with_scrollbar([0, 0, 0, 255], 20);
        let second = animated_panel_with_scrollbar([0, 255, 0, 255], 30);
        let third = animated_panel_with_scrollbar([0, 0, 255, 255], 40);
        assert_eq!(
            detect_vertical_scrollbar(&first).map(|bar| (bar.top, bar.length)),
            Some((20, 30))
        );
        assert!(native_vertical_overlap(&first, &second).is_none());

        let mut session = NativeScrollSession::new(first);
        assert!(!session.append(settling));
        assert_eq!(session.total_height, 300);
        assert!(session.append(second));
        assert_eq!(session.total_height, 400);
        assert!(session.append(third));
        assert_eq!(session.total_height, 500);
    }

    #[test]
    fn native_scroll_stitch_refines_quantized_scrollbar_seam() {
        let document = test_document(240, 700);
        let first = document_frame_with_scrollbar(&document, 0, 20);
        // The thumb suggests 100px (10px * 300 / 30), while the actual page
        // moved 110px. The local pixel refinement must choose 110px so a text
        // row at the seam is not duplicated.
        let second = document_frame_with_scrollbar(&document, 110, 30);
        let mut session = NativeScrollSession::new(first);
        assert!(session.append(second));
        assert_eq!(session.total_height, 410);
        let rendered = imageops::crop_imm(&session.render(), 0, 0, 200, 410).to_image();
        let expected = imageops::crop_imm(&document, 0, 0, 200, 410).to_image();
        assert_eq!(rendered, expected);
    }

    #[test]
    fn native_scroll_stitch_refreshes_lazy_loaded_content() {
        let loaded = test_document(240, 300);
        let mut placeholder = loaded.clone();
        for y in 80..220 {
            for x in 20..220 {
                placeholder.put_pixel(x, y, image::Rgba([245, 245, 245, 255]));
            }
        }

        let mut session = NativeScrollSession::new(placeholder);
        let matched = native_vertical_overlap(&session.last_frame, &loaded);
        assert!(
            matched
                .map(|matched| matched.overlap == session.viewport_height)
                .unwrap_or(false),
            "lazy-loaded content was mistaken for scrolling: {matched:?}"
        );
        assert!(!session.append(loaded.clone()));
        assert_eq!(session.total_height, 300);
        assert_eq!(session.render(), loaded);
    }

    #[test]
    fn native_scroll_stitch_refreshes_lazy_loaded_tail_after_scrolling() {
        let document = test_document(240, 500);
        let initial = imageops::crop_imm(&document, 0, 0, 240, 300).to_image();
        let loaded = imageops::crop_imm(&document, 0, 100, 240, 300).to_image();
        let mut placeholder = loaded.clone();
        for y in 200..300 {
            for x in 0..240 {
                placeholder.put_pixel(x, y, image::Rgba([245, 245, 245, 255]));
            }
        }

        let mut session = NativeScrollSession::new(initial);
        assert!(session.append(placeholder));
        assert_eq!(session.total_height, 400);
        let matched = native_vertical_overlap(&session.last_frame, &loaded);
        assert!(!session.append(loaded));
        let expected = imageops::crop_imm(&document, 0, 0, 240, 400).to_image();
        let rendered = session.render();
        let first_difference = rendered
            .enumerate_pixels()
            .find(|(x, y, pixel)| **pixel != *expected.get_pixel(*x, *y))
            .map(|(x, y, _)| (x, y));
        assert_eq!(
            first_difference, None,
            "lazy tail was not refreshed; match={matched:?}"
        );
    }

    #[test]
    fn native_scroll_stitch_ignores_sticky_header() {
        let header = test_document(240, 60);
        let content = test_document(240, 1_140);
        let offsets = [0, 60, 140, 250, 400, 600, 780, 900];
        let mut session = NativeScrollSession::new(sticky_header_frame(&header, &content, 0));
        for offset in offsets.into_iter().skip(1) {
            let frame = sticky_header_frame(&header, &content, offset);
            let overlap =
                native_vertical_overlap(&session.last_frame, &frame).map(|matched| matched.overlap);
            assert!(
                session.append(frame),
                "sticky frame at {offset} was rejected; overlap={overlap:?}"
            );
        }
        let mut expected = RgbaImage::new(240, 1_200);
        imageops::replace(&mut expected, &header, 0, 0);
        imageops::replace(&mut expected, &content, 0, 60);
        assert_eq!(session.total_height, 1_200);
        assert_eq!(session.render(), expected);
    }

    #[test]
    fn native_scroll_stitch_uses_narrow_scrolling_column() {
        let sidebar = test_document(280, 300);
        let content = test_document(120, 900);
        let first = fixed_sidebar_frame(&sidebar, &content, 0);
        let second = fixed_sidebar_frame(&sidebar, &content, 150);
        assert_eq!(
            native_vertical_overlap(&first, &second).map(|matched| matched.overlap),
            Some(150)
        );

        let mut session = NativeScrollSession::new(first);
        assert!(session.append(second));
        assert_eq!(session.total_height, 450);
        let rendered = session.render();
        let rendered_content = imageops::crop_imm(&rendered, 280, 0, 120, 450).to_image();
        let expected_content = imageops::crop_imm(&content, 0, 0, 120, 450).to_image();
        assert_eq!(rendered_content, expected_content);
    }

    #[test]
    fn native_scroll_stitch_keeps_progress_below_tall_fixed_header() {
        let header = test_document(240, 140);
        let content = test_document(240, 560);
        let first = tall_fixed_header_frame(&header, &content, 0);
        let second = tall_fixed_header_frame(&header, &content, 80);
        let matched = native_vertical_overlap(&first, &second);
        assert_eq!(matched.map(|matched| matched.overlap), Some(220));

        let mut session = NativeScrollSession::new(first);
        assert!(session.append(second));
        assert_eq!(session.total_height, 380);
    }
}
