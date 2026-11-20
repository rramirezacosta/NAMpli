use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowControlsSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowControlsInfo {
    pub side: WindowControlsSide,
    /// Where the value came from: gnome/cinnamon/mate/xfce/macos/windows/default.
    pub source: &'static str,
    /// The raw desktop setting, when one was available (useful for debugging).
    pub layout: Option<String>,
}

impl WindowControlsInfo {
    fn new(side: WindowControlsSide, source: &'static str, layout: Option<String>) -> Self {
        Self {
            side,
            source,
            layout,
        }
    }
}

/// Tokens that represent actual window controls in a GTK-style `button-layout`.
/// `hide` is the GNOME/XFCE alias for minimize.
fn is_control(token: &str) -> bool {
    matches!(token, "close" | "minimize" | "maximize" | "hide")
}

/// Pick a side from the two groups. Close is the strongest signal — XFCE's
/// `C|HMO`, for example, puts only close on the left — so decide by close
/// first and fall back to where most controls are.
fn pick_side(
    left_close: bool,
    right_close: bool,
    left_count: usize,
    right_count: usize,
) -> Option<WindowControlsSide> {
    match (left_close, right_close) {
        (true, false) => Some(WindowControlsSide::Left),
        (false, true) => Some(WindowControlsSide::Right),
        _ => match (left_count, right_count) {
            (0, 0) => None,
            (left, right) if left > right => Some(WindowControlsSide::Left),
            (left, right) if right > left => Some(WindowControlsSide::Right),
            // Equal numbers on both sides: no meaningful preference.
            _ => None,
        },
    }
}

/// Parse the freedesktop/GTK format: `<left tokens>:<right tokens>`.
/// A string without a colon is treated as a single right-hand group.
fn parse_button_layout(layout: &str) -> Option<WindowControlsSide> {
    let (left, right) = match layout.split_once(':') {
        Some((left, right)) => (left, right),
        None => ("", layout),
    };
    let count = |part: &str| {
        part.split(',')
            .map(str::trim)
            .filter(|token| is_control(token))
            .count()
    };
    let has_close = |part: &str| part.split(',').map(str::trim).any(|t| t == "close");

    pick_side(has_close(left), has_close(right), count(left), count(right))
}

/// Parse xfwm4's format: letters before `|` are on the left, after it on the right.
/// H = hide (minimize), M = maximize, C = close, O = window menu.
fn parse_xfwm4_layout(layout: &str) -> Option<WindowControlsSide> {
    let (left, right) = match layout.split_once('|') {
        Some((left, right)) => (left, right),
        None => ("", layout),
    };
    let count = |part: &str| {
        part.chars()
            .filter(|c| matches!(c, 'H' | 'M' | 'C'))
            .count()
    };

    pick_side(
        left.contains('C'),
        right.contains('C'),
        count(left),
        count(right),
    )
}

fn run_command(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.to_string())
}

/// gsettings prints string values wrapped in quotes, e.g. `'close,minimize:appmenu'`.
fn gsettings_layout(schema: &str) -> Option<String> {
    let raw = run_command("gsettings", &["get", schema, "button-layout"])?;
    Some(raw.trim_matches(|c| c == '\'' || c == '"').to_string())
}

fn xfwm4_layout() -> Option<String> {
    run_command(
        "xfconf-query",
        &["-c", "xfwm4", "-p", "/general/button_layout"],
    )
}

/// Determine which side of the title bar the desktop places window controls on.
///
/// gsettings is D-Bus/dconf backed, so it works on both X11 and Wayland without
/// any X11 libraries. All known schemas are attempted regardless of
/// XDG_CURRENT_DESKTOP, since that variable is often unset or misleading.
pub fn detect() -> WindowControlsInfo {
    if cfg!(target_os = "macos") {
        // macOS traffic lights are always on the left.
        return WindowControlsInfo::new(WindowControlsSide::Left, "macos", None);
    }
    if cfg!(target_os = "windows") {
        // Windows has no standard setting to move the buttons off the right.
        return WindowControlsInfo::new(WindowControlsSide::Right, "windows", None);
    }

    if cfg!(target_os = "linux") {
        for (source, schema) in [
            ("gnome", "org.gnome.desktop.wm.preferences"),
            ("cinnamon", "org.cinnamon.desktop.wm.preferences"),
            ("mate", "org.mate.Marco.general"),
        ] {
            if let Some(layout) = gsettings_layout(schema) {
                if let Some(side) = parse_button_layout(&layout) {
                    return WindowControlsInfo::new(side, source, Some(layout));
                }
            }
        }

        if let Some(layout) = xfwm4_layout() {
            if let Some(side) = parse_xfwm4_layout(&layout) {
                return WindowControlsInfo::new(side, "xfce", Some(layout));
            }
        }

        // KDE Plasma exposes button order through kwinrc's `TitleButtons` list,
        // which is not a left/right layout string; its default is right, so we
        // leave it at the fallback rather than guess from an ambiguous format.
    }

    WindowControlsInfo::new(WindowControlsSide::Right, "default", None)
}

#[tauri::command]
pub fn get_window_controls_info() -> WindowControlsInfo {
    let info = detect();
    log::info!(
        "Window controls: side={:?}, source={}, layout={:?}",
        info.side,
        info.source,
        info.layout
    );
    info
}

#[cfg(test)]
mod tests {
    use super::WindowControlsSide::{Left, Right};
    use super::{parse_button_layout, parse_xfwm4_layout};

    #[test]
    fn parses_gtk_button_layouts() {
        let cases = [
            // Ubuntu GNOME default: close/minimize on the left, app menu right.
            ("close,minimize:appmenu", Some(Left)),
            ("close,minimize,maximize:", Some(Left)),
            // Stock GNOME / most desktops: controls on the right.
            ("appmenu:minimize,maximize,close", Some(Right)),
            (":minimize,maximize,close", Some(Right)),
            // No colon means a single right-hand group.
            ("minimize,maximize,close", Some(Right)),
            ("hide,maximize,close", Some(Right)),
            // Close is the deciding signal when it is split from the others.
            ("close:minimize", Some(Left)),
            // No controls on either side: no preference.
            ("appmenu:", None),
            ("", None),
        ];
        for (layout, expected) in cases {
            assert_eq!(parse_button_layout(layout), expected, "layout: {layout}");
        }
    }

    #[test]
    fn parses_xfwm4_button_layouts() {
        let cases = [
            ("O|HMC", Some(Right)),
            // Ubuntu-style XFCE: close left, remaining buttons right.
            ("C|HMO", Some(Left)),
            ("HMC|O", Some(Left)),
            ("HM|C", Some(Right)),
            ("H|M", None), // one control per side, no close: no preference
            ("HMC", Some(Right)),
            ("O|", None),
            ("", None),
        ];
        for (layout, expected) in cases {
            assert_eq!(parse_xfwm4_layout(layout), expected, "layout: {layout}");
        }
    }
}
