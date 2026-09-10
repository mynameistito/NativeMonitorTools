use std::env;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use serde_json::{Value, json};
use slint::{ModelRc, SharedString, VecModel, Weak};

slint::include_modules!();

const IPC_VERSION: u64 = 1;
const MAX_IPC_MESSAGE_BYTES: usize = 64 * 1024;

type Response = Result<Value, String>;

struct PendingRequest {
    method: String,
    params: Value,
    response: Sender<Response>,
}

#[derive(Clone)]
struct BackendClient {
    requests: Sender<PendingRequest>,
}

struct BackendProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

enum TransactionError {
    Transport(String),
    Server(String),
}

impl BackendClient {
    fn start() -> Self {
        let (requests, receiver) = mpsc::channel::<PendingRequest>();
        thread::Builder::new()
            .name("slint-backend-ipc".to_string())
            .spawn(move || backend_worker(receiver))
            .expect("failed to start backend IPC worker");
        Self { requests }
    }

    fn request<F>(&self, method: &str, params: Value, on_response: F)
    where
        F: FnOnce(Response) + Send + 'static,
    {
        let (response, receiver) = mpsc::channel();
        let pending = PendingRequest {
            method: method.to_string(),
            params,
            response,
        };
        if let Err(error) = self.requests.send(pending) {
            on_response(Err(format!("backend IPC worker stopped: {error}")));
            return;
        }
        thread::spawn(move || {
            let result = receiver
                .recv()
                .unwrap_or_else(|error| Err(format!("backend response channel closed: {error}")));
            on_response(result);
        });
    }
}

fn backend_worker(receiver: Receiver<PendingRequest>) {
    let mut process = None;
    let mut request_number = 1usize;
    for pending in receiver {
        let request_id = format!("slint-ui-{request_number}");
        request_number += 1;
        let result = transact(&mut process, &request_id, &pending.method, &pending.params);
        let _ = pending.response.send(result);
    }
    if let Some(mut process) = process {
        let _ = process.child.kill();
    }
}

fn transact(
    process: &mut Option<BackendProcess>,
    request_id: &str,
    method: &str,
    params: &Value,
) -> Response {
    let mut current = match process.take() {
        Some(process) => process,
        None => match launch_backend() {
            Ok(process) => process,
            Err(error) => return Err(error),
        },
    };
    let request = json!({
        "id": request_id,
        "method": method,
        "params": params,
        "version": IPC_VERSION,
    });
    let result = transact_with_process(&mut current, request_id, &request);
    match result {
        Ok(value) => {
            *process = Some(current);
            Ok(value)
        }
        Err(TransactionError::Server(error)) => {
            *process = Some(current);
            Err(error)
        }
        Err(TransactionError::Transport(error)) => {
            let _ = current.child.kill();
            Err(error)
        }
    }
}

fn transact_with_process(
    process: &mut BackendProcess,
    request_id: &str,
    request: &Value,
) -> Result<Value, TransactionError> {
    let line = serde_json::to_string(request).map_err(|error| {
        TransactionError::Transport(format!("could not encode IPC request: {error}"))
    })?;
    writeln!(process.stdin, "{line}").map_err(|error| {
        TransactionError::Transport(format!("could not write IPC request: {error}"))
    })?;
    process.stdin.flush().map_err(|error| {
        TransactionError::Transport(format!("could not flush IPC request: {error}"))
    })?;

    let mut response_line = String::new();
    let bytes = process
        .stdout
        .read_line(&mut response_line)
        .map_err(|error| {
            TransactionError::Transport(format!("could not read IPC response: {error}"))
        })?;
    if bytes == 0 {
        return Err(TransactionError::Transport(
            "backend closed its stdout before responding".to_string(),
        ));
    }
    if response_line.trim_end_matches(['\r', '\n']).len() > MAX_IPC_MESSAGE_BYTES {
        return Err(TransactionError::Transport(
            "backend IPC response exceeded 64 KiB".to_string(),
        ));
    }
    let response: Value = serde_json::from_str(&response_line).map_err(|error| {
        TransactionError::Transport(format!("backend returned invalid JSON: {error}"))
    })?;
    validate_response(response, request_id).map_err(TransactionError::Server)
}

fn validate_response(response: Value, request_id: &str) -> Result<Value, String> {
    let object = response
        .as_object()
        .ok_or_else(|| "backend response was not a JSON object".to_string())?;
    if object.get("version") != Some(&json!(IPC_VERSION)) {
        return Err("backend response used an unsupported IPC version".to_string());
    }
    if object.get("id").and_then(Value::as_str) != Some(request_id) {
        return Err("backend response id did not match the pending request".to_string());
    }
    match object.get("ok").and_then(Value::as_bool) {
        Some(true) => object
            .get("result")
            .cloned()
            .ok_or_else(|| "successful backend response had no result".to_string()),
        Some(false) => {
            let error = object
                .get("error")
                .and_then(Value::as_object)
                .ok_or_else(|| "backend error response had no error payload".to_string())?;
            let code = error
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("BACKEND_ERROR");
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("The backend rejected the request");
            Err(format!("{code}: {message}"))
        }
        None => Err("backend response did not contain a boolean ok field".to_string()),
    }
}

fn launch_backend() -> Result<BackendProcess, String> {
    let (program, args) = backend_command()?;
    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child = command.spawn().map_err(|error| {
        format!(
            "could not launch backend command `{program}`: {error}. Set NMT_BACKEND_COMMAND or NMT_BACKEND_EXECUTABLE."
        )
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "backend stdin was not piped".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "backend stdout was not piped".to_string())?;
    Ok(BackendProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn backend_command() -> Result<(String, Vec<String>), String> {
    if let Some(command) = first_env(&[
        "NMT_BACKEND_COMMAND",
        "NATIVE_MONITOR_TOOLS_BACKEND_COMMAND",
    ]) {
        let parts = split_command_line(&command)?;
        let (program, args) = parts
            .split_first()
            .ok_or_else(|| "NMT_BACKEND_COMMAND must not be empty".to_string())?;
        return Ok((program.to_string(), args.to_vec()));
    }
    let executable = first_env(&[
        "NMT_BACKEND_EXECUTABLE",
        "NATIVE_MONITOR_TOOLS_BACKEND_EXECUTABLE",
    ])
    .unwrap_or_else(default_backend_executable);
    let args = first_env(&["NMT_BACKEND_ARGS"])
        .map(|value| split_command_line(&value))
        .transpose()?
        .unwrap_or_default();
    Ok((executable, args))
}

fn default_backend_executable() -> String {
    let name = if cfg!(windows) {
        "native-monitor-tools-backend.exe"
    } else {
        "native-monitor-tools-backend"
    };
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join(name)))
        .filter(|path| path.is_file())
        .map_or_else(
            || name.to_string(),
            |path| path.to_string_lossy().into_owned(),
        )
}

fn first_env(names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| env::var(name).ok().filter(|value| !value.trim().is_empty()))
}

fn split_command_line(input: &str) -> Result<Vec<String>, String> {
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for character in input.chars() {
        match character {
            '"' => quoted = !quoted,
            character if character.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    arguments.push(std::mem::take(&mut current));
                }
            }
            character => current.push(character),
        }
    }
    if quoted {
        return Err("backend command contains an unterminated quote".to_string());
    }
    if !current.is_empty() {
        arguments.push(current);
    }
    Ok(arguments)
}

fn strings_model(rows: Vec<String>) -> ModelRc<SharedString> {
    ModelRc::new(VecModel::from(
        rows.into_iter()
            .map(SharedString::from)
            .collect::<Vec<SharedString>>(),
    ))
}

fn set_rows(ui: &MainWindow, property: &str, rows: Vec<String>) {
    let model = strings_model(rows);
    match property {
        "monitors" => ui.set_monitor_rows(model),
        "profiles" => ui.set_profile_rows(model),
        "colors" => ui.set_color_rows(model),
        "windows" => ui.set_window_rows(model),
        _ => {}
    }
}

fn set_error(ui: &MainWindow, message: String) {
    ui.set_has_error(true);
    ui.set_error_message(SharedString::from(message));
}

fn clear_error(ui: &MainWindow) {
    ui.set_has_error(false);
    ui.set_error_message(SharedString::from(""));
}

fn string_field(value: &Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("backend result is missing string field `{field}`"))
}

fn number_field(value: &Value, field: &str) -> Result<f64, String> {
    value
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("backend result is missing numeric field `{field}`"))
}

fn bool_field(value: &Value, field: &str) -> Result<bool, String> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("backend result is missing boolean field `{field}`"))
}

fn monitor_rows(value: &Value) -> Result<Vec<String>, String> {
    let topology = value
        .get("topology")
        .ok_or_else(|| "monitor result is missing topology".to_string())?;
    let monitors = topology
        .get("monitors")
        .and_then(Value::as_array)
        .ok_or_else(|| "monitor result is missing topology.monitors".to_string())?;
    if monitors.is_empty() {
        return Ok(vec!["No monitors discovered".to_string()]);
    }
    monitors
        .iter()
        .map(|monitor| {
            let name = string_field(monitor, "name")?;
            let id = string_field(monitor, "id")?;
            let primary = bool_field(monitor, "isPrimary")?;
            let mode = monitor
                .get("mode")
                .ok_or_else(|| "monitor result is missing mode".to_string())?;
            let width = number_field(mode, "width")?;
            let height = number_field(mode, "height")?;
            let refresh = number_field(mode, "refreshRate")?;
            let bounds = monitor
                .get("bounds")
                .ok_or_else(|| "monitor result is missing bounds".to_string())?;
            let x = number_field(bounds, "x")?;
            let y = number_field(bounds, "y")?;
            Ok(format!(
                "{}{}  ·  {}×{} @ {} Hz  ·  ({}, {})  ·  {}",
                name,
                if primary { "  /  PRIMARY" } else { "" },
                width as i64,
                height as i64,
                refresh,
                x as i64,
                y as i64,
                compact_id(&id),
            ))
        })
        .collect()
}

fn profile_rows(value: &Value) -> Result<Vec<String>, String> {
    let profiles = value
        .as_array()
        .ok_or_else(|| "profile result was not an array".to_string())?;
    if profiles.is_empty() {
        return Ok(vec!["No saved profiles".to_string()]);
    }
    profiles
        .iter()
        .map(|profile| {
            profile
                .as_str()
                .map(ToString::to_string)
                .ok_or_else(|| "profile list contained a non-string value".to_string())
        })
        .collect()
}

fn color_rows(value: &Value) -> Result<Vec<String>, String> {
    let colors = value
        .as_array()
        .ok_or_else(|| "color result was not an array".to_string())?;
    if colors.is_empty() {
        return Ok(vec!["No color state reported".to_string()]);
    }
    colors
        .iter()
        .map(|color| {
            let name = string_field(color, "displayName")?;
            let id = string_field(color, "monitorId")?;
            let gamma = capability_summary(color.get("gamma"), "Gamma");
            let brightness = level_summary(color.get("brightness"), "Brightness");
            let contrast = level_summary(color.get("contrast"), "Contrast");
            Ok(format!(
                "{}  ·  {}  ·  {}  ·  {}  ·  {}",
                name,
                gamma,
                brightness,
                contrast,
                compact_id(&id),
            ))
        })
        .collect()
}

fn window_rows(value: &Value) -> Result<Vec<String>, String> {
    let areas = value
        .as_array()
        .ok_or_else(|| "window result was not an array".to_string())?;
    if areas.is_empty() {
        return Ok(vec!["No window areas reported".to_string()]);
    }
    areas
        .iter()
        .map(|area| {
            let monitor = string_field(area, "monitorName")?;
            let name = string_field(area, "name")?;
            let area_id = string_field(area, "areaId")?;
            Ok(format!(
                "{}  ·  {} ({})  ·  snap disabled",
                monitor, name, area_id
            ))
        })
        .collect()
}

fn capability_summary(value: Option<&Value>, label: &str) -> String {
    let Some(value) = value else {
        return format!("{label} unavailable");
    };
    if value.get("_tag").and_then(Value::as_str) == Some("Supported") {
        return format!("{label} available");
    }
    let reason = value
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("unsupported");
    format!("{label} unavailable ({reason})")
}

fn level_summary(value: Option<&Value>, label: &str) -> String {
    let Some(value) = value else {
        return format!("{label} unavailable");
    };
    if value.get("_tag").and_then(Value::as_str) != Some("Supported") {
        return format!("{label} unavailable");
    }
    let current = value.get("current").and_then(Value::as_f64).unwrap_or(0.0);
    let maximum = value.get("maximum").and_then(Value::as_f64).unwrap_or(0.0);
    format!("{label} {current:.0}/{maximum:.0}")
}

fn compact_id(value: &str) -> String {
    const MAX_LENGTH: usize = 34;
    if value.chars().count() <= MAX_LENGTH {
        return value.to_string();
    }
    let prefix: String = value.chars().take(MAX_LENGTH - 1).collect();
    format!("{prefix}…")
}

fn finish_loading(ui_weak: &Weak<MainWindow>, pending: &AtomicUsize) {
    if pending.fetch_sub(1, Ordering::SeqCst) == 1 {
        let weak = ui_weak.clone();
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = weak.upgrade() {
                ui.set_loading(false);
            }
        });
    }
}

fn request_with_ui<F>(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    method: &'static str,
    params: Value,
    pending: Arc<AtomicUsize>,
    handler: F,
) where
    F: FnOnce(&MainWindow, Response) + Send + 'static,
{
    let callback_weak = ui_weak.clone();
    client.request(method, params, move |result| {
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = callback_weak.upgrade() {
                handler(&ui, result);
            }
        });
        finish_loading(&ui_weak, &pending);
    });
}

fn refresh_all(ui_weak: Weak<MainWindow>, client: BackendClient) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        clear_error(&ui);
        ui.set_connection_status(SharedString::from("Refreshing backend data"));
    }
    let pending = Arc::new(AtomicUsize::new(5));

    let weak = ui_weak.clone();
    request_with_ui(
        weak,
        client.clone(),
        "capabilities.get",
        json!({}),
        pending.clone(),
        |ui, result| match result {
            Ok(value) => {
                let capabilities = value.get("capabilities");
                ui.set_profile_preview_enabled(capability_available(
                    capabilities,
                    "profileApplyPreview",
                ));
                ui.set_color_action_enabled(capability_available(capabilities, "color"));
                ui.set_window_action_enabled(capability_available(capabilities, "windowTools"));
                ui.set_connection_status(SharedString::from("Backend connected · protocol v1"));
            }
            Err(error) => set_error(ui, format!("capabilities.get · {error}")),
        },
    );

    let weak = ui_weak.clone();
    request_with_ui(
        weak,
        client.clone(),
        "monitors.list",
        json!({}),
        pending.clone(),
        |ui, result| match result {
            Ok(value) => match monitor_rows(&value) {
                Ok(rows) => {
                    let count = rows
                        .iter()
                        .filter(|row| *row != "No monitors discovered")
                        .count();
                    set_rows(ui, "monitors", rows);
                    ui.set_monitor_status(SharedString::from(format!("{count} detected")));
                }
                Err(error) => set_error(ui, format!("monitors.list · {error}")),
            },
            Err(error) => {
                set_rows(
                    ui,
                    "monitors",
                    vec![format!("Discovery unavailable · {error}")],
                );
                ui.set_monitor_status(SharedString::from("Unavailable"));
                set_error(ui, format!("monitors.list · {error}"));
            }
        },
    );

    let weak = ui_weak.clone();
    request_with_ui(
        weak,
        client.clone(),
        "profiles.list",
        json!({}),
        pending.clone(),
        |ui, result| match result {
            Ok(value) => match profile_rows(&value) {
                Ok(rows) => {
                    let count = rows
                        .iter()
                        .filter(|row| *row != "No saved profiles")
                        .count();
                    set_rows(ui, "profiles", rows);
                    ui.set_profile_status(SharedString::from(format!("{count} saved")));
                }
                Err(error) => set_error(ui, format!("profiles.list · {error}")),
            },
            Err(error) => {
                set_rows(
                    ui,
                    "profiles",
                    vec![format!("Profile list unavailable · {error}")],
                );
                ui.set_profile_status(SharedString::from("Unavailable"));
                set_error(ui, format!("profiles.list · {error}"));
            }
        },
    );

    let weak = ui_weak.clone();
    request_with_ui(
        weak,
        client.clone(),
        "color.list",
        json!({}),
        pending.clone(),
        |ui, result| match result {
            Ok(value) => match color_rows(&value) {
                Ok(rows) => {
                    set_rows(ui, "colors", rows);
                    ui.set_color_action_enabled(true);
                    ui.set_color_status(SharedString::from("Read-only state loaded"));
                }
                Err(error) => set_error(ui, format!("color.list · {error}")),
            },
            Err(error) => {
                set_rows(
                    ui,
                    "colors",
                    vec![format!("Color controls unavailable · {error}")],
                );
                ui.set_color_status(SharedString::from("Unavailable / read-only"));
            }
        },
    );

    request_with_ui(
        ui_weak,
        client,
        "window.list",
        json!({}),
        pending,
        |ui, result| match result {
            Ok(value) => match window_rows(&value) {
                Ok(rows) => {
                    set_rows(ui, "windows", rows);
                    ui.set_window_action_enabled(true);
                    ui.set_window_status(SharedString::from("Areas loaded · snap disabled"));
                }
                Err(error) => set_error(ui, format!("window.list · {error}")),
            },
            Err(error) => {
                set_rows(
                    ui,
                    "windows",
                    vec![format!("Window tools unavailable · {error}")],
                );
                ui.set_window_status(SharedString::from("Unavailable / read-only"));
            }
        },
    );
}

fn capability_available(capabilities: Option<&Value>, name: &str) -> bool {
    capabilities
        .and_then(|value| value.get(name))
        .and_then(|value| value.get("available"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn refresh_optional(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    method: &'static str,
    property: &'static str,
) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_connection_status(SharedString::from(format!("Reading {method}")));
    }
    let pending = Arc::new(AtomicUsize::new(1));
    request_with_ui(
        ui_weak,
        client,
        method,
        json!({}),
        pending,
        move |ui, result| match result {
            Ok(value) => {
                let parsed = match property {
                    "colors" => color_rows(&value),
                    "windows" => window_rows(&value),
                    _ => Err("unknown optional section".to_string()),
                };
                match parsed {
                    Ok(rows) => set_rows(ui, property, rows),
                    Err(error) => set_error(ui, format!("{method} · {error}")),
                }
            }
            Err(error) => set_error(ui, format!("{method} · {error}")),
        },
    );
}

fn preview_profile(ui_weak: Weak<MainWindow>, client: BackendClient, name: String) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_connection_status(SharedString::from(format!("Previewing profile `{name}`")));
    }
    let pending = Arc::new(AtomicUsize::new(1));
    request_with_ui(
        ui_weak,
        client,
        "profiles.applyPreview",
        json!({"name": name}),
        pending,
        move |ui, result| match result {
            Ok(value) => {
                let plan = value.get("plan");
                let operations = plan
                    .and_then(|value| value.get("operations"))
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);
                let noop = plan
                    .and_then(|value| value.get("isNoop"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                ui.set_connection_status(SharedString::from(format!(
                    "Preview ready · {operations} operation(s){} · no display changes applied",
                    if noop { " · already aligned" } else { "" }
                )));
            }
            Err(error) => set_error(ui, format!("profiles.applyPreview · {error}")),
        },
    );
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let ui = MainWindow::new()?;
    let client = BackendClient::start();
    let ui_weak = ui.as_weak();

    {
        let weak = ui.as_weak();
        let backend = client.clone();
        ui.on_refresh_clicked(move || refresh_all(weak.clone(), backend.clone()));
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        ui.on_color_refresh_clicked(move || {
            refresh_optional(weak.clone(), backend.clone(), "color.list", "colors")
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        ui.on_window_refresh_clicked(move || {
            refresh_optional(weak.clone(), backend.clone(), "window.list", "windows")
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        ui.on_profile_preview_clicked(move |name| {
            preview_profile(weak.clone(), backend.clone(), name.to_string())
        });
    }

    refresh_all(ui_weak, client);
    ui.run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{split_command_line, validate_response};
    use serde_json::json;

    #[test]
    fn parses_quoted_backend_commands_without_a_shell() {
        let args = split_command_line(r#"bun run "apps/slint-ui/backend-stdio.ts" --flag"#)
            .expect("command should parse");
        assert_eq!(
            args,
            ["bun", "run", "apps/slint-ui/backend-stdio.ts", "--flag"]
        );
    }

    #[test]
    fn rejects_response_for_another_request() {
        let error = validate_response(
            json!({"id": "other", "ok": true, "result": {}, "version": 1}),
            "expected",
        )
        .expect_err("mismatched ids should fail");
        assert!(error.contains("id"));
    }
}
