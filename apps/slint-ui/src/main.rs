use std::env;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};
use slint::{CloseRequestResponse, ModelRc, SharedString, VecModel, Weak};

slint::include_modules!();

const IPC_VERSION: u64 = 1;
const MAX_IPC_MESSAGE_BYTES: usize = 64 * 1024;
const BACKEND_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const GAMMA_MINIMUM: f64 = 0.3;
const GAMMA_MAXIMUM: f64 = 4.4;
const EXTERNAL_LEVEL_MINIMUM: f64 = 0.0;
const EXTERNAL_LEVEL_MAXIMUM: f64 = 65_535.0;

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
    responses: Receiver<Result<Value, String>>,
    response_reader: Option<thread::JoinHandle<()>>,
}

enum TransactionError {
    Transport(String),
    Server(String),
}

#[derive(Clone, Debug, PartialEq)]
struct MonitorCardData {
    monitor_id: String,
    display_name: String,
    resolution: String,
    position: String,
    primary: bool,
    gamma_supported: bool,
    brightness_supported: bool,
    contrast_supported: bool,
    capability_note: String,
}

#[derive(Clone, Debug, PartialEq)]
struct ColorCardData {
    monitor_id: String,
    display_name: String,
    gamma_supported: bool,
    gamma_value: f32,
    gamma_readback: String,
    brightness_supported: bool,
    brightness_minimum: f32,
    brightness_maximum: f32,
    brightness_value: f32,
    brightness_readback: String,
    contrast_supported: bool,
    contrast_minimum: f32,
    contrast_maximum: f32,
    contrast_value: f32,
    contrast_readback: String,
    pending_control: String,
}

#[derive(Clone, Debug, PartialEq)]
struct ProfileItemData {
    name: String,
    selected: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct WindowAreaData {
    area_id: String,
    monitor_id: String,
    monitor_name: String,
    name: String,
    selected: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct PreviewOperationData {
    kind: String,
    monitor_id: String,
    detail: String,
}

#[derive(Clone, Debug, PartialEq)]
struct ProfilePreviewData {
    name: String,
    dry_run: bool,
    is_noop: bool,
    operations: Vec<PreviewOperationData>,
}

#[derive(Default)]
struct UiState {
    monitors: Vec<MonitorCardData>,
    colors: Vec<ColorCardData>,
    profiles: Vec<ProfileItemData>,
    window_areas: Vec<WindowAreaData>,
    color_capabilities_ready: bool,
    pending_action: Option<PendingAction>,
    profile_save_state: ProfileSaveState,
}

#[derive(Clone, Debug, PartialEq)]
enum PendingAction {
    Color { monitor_id: String, control: String },
    ProfilePreview { name: String },
    ProfileSave { name: String },
    WindowSnap { area_id: String, monitor_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ProfileSaveState {
    Idle,
    Pending { name: String },
    Success { name: String },
    Error { message: String },
}

impl Default for ProfileSaveState {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, PartialEq)]
struct ProfileSaveRequest {
    method: &'static str,
    params: Value,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct TrayState {
    panel_visible: bool,
    quit_requested: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayCommand {
    Open,
    Refresh,
    Quit,
}

fn reduce_tray_command(mut state: TrayState, command: TrayCommand) -> TrayState {
    match command {
        TrayCommand::Open => state.panel_visible = true,
        TrayCommand::Refresh => {}
        TrayCommand::Quit => state.quit_requested = true,
    }
    state
}

fn apply_tray_command(state: &Arc<Mutex<TrayState>>, command: TrayCommand) -> bool {
    let Ok(mut current) = state.lock() else {
        return false;
    };
    *current = reduce_tray_command(*current, command);
    true
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
        terminate_backend(&mut process);
    }
}

fn terminate_backend(process: &mut BackendProcess) {
    let _ = process.child.kill();
    let _ = process.child.wait();
    drop(std::mem::replace(&mut process.responses, mpsc::channel().1));
    if let Some(reader) = process.response_reader.take() {
        let _ = reader.join();
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
            terminate_backend(&mut current);
            match launch_backend() {
                Ok(restarted) => *process = Some(restarted),
                Err(restart_error) => {
                    return Err(format!("{error}; backend restart failed: {restart_error}"));
                }
            }
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

    let response = receive_backend_response(
        &process.responses,
        method_name_from_request(request),
        BACKEND_REQUEST_TIMEOUT,
    )?;
    validate_response(response, request_id).map_err(TransactionError::Server)
}

fn method_name_from_request(request: &Value) -> &str {
    request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("backend request")
}

fn receive_backend_response(
    responses: &Receiver<Result<Value, String>>,
    method: &str,
    timeout: Duration,
) -> Result<Value, TransactionError> {
    match responses.recv_timeout(timeout) {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(error)) => Err(TransactionError::Transport(error)),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(TransactionError::Transport(format!(
            "{method} timed out after {} seconds; the backend was restarted",
            timeout.as_secs()
        ))),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(TransactionError::Transport(
            "backend response reader stopped before responding; the backend was restarted"
                .to_string(),
        )),
    }
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
    let (response_sender, responses) = mpsc::channel();
    let response_reader = thread::Builder::new()
        .name("slint-backend-response-reader".to_string())
        .spawn(move || read_backend_responses(stdout, response_sender))
        .map_err(|error| format!("could not start backend response reader: {error}"))?;
    Ok(BackendProcess {
        child,
        stdin,
        responses,
        response_reader: Some(response_reader),
    })
}

fn read_backend_responses(stdout: ChildStdout, sender: Sender<Result<Value, String>>) {
    let mut stdout = BufReader::new(stdout);
    loop {
        let mut response_line = String::new();
        match stdout.read_line(&mut response_line) {
            Ok(0) => {
                let _ = sender.send(Err(
                    "backend closed its stdout before responding".to_string()
                ));
                return;
            }
            Ok(_) => {
                if response_line.trim_end_matches(['\r', '\n']).len() > MAX_IPC_MESSAGE_BYTES {
                    let _ = sender.send(Err("backend IPC response exceeded 64 KiB".to_string()));
                    return;
                }
                match serde_json::from_str(&response_line) {
                    Ok(response) => {
                        if sender.send(Ok(response)).is_err() {
                            return;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(format!("backend returned invalid JSON: {error}")));
                        return;
                    }
                }
            }
            Err(error) => {
                let _ = sender.send(Err(format!("could not read IPC response: {error}")));
                return;
            }
        }
    }
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

fn string_field(value: &Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("backend result is missing non-empty string field `{field}`"))
}

fn number_field(value: &Value, field: &str) -> Result<f64, String> {
    let number = value
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("backend result is missing numeric field `{field}`"))?;
    if number.is_finite() {
        Ok(number)
    } else {
        Err(format!("backend result field `{field}` was not finite"))
    }
}

fn bool_field(value: &Value, field: &str) -> Result<bool, String> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("backend result is missing boolean field `{field}`"))
}

fn non_empty_array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("backend result is missing array field `{field}`"))
}

fn decode_monitors(value: &Value) -> Result<Vec<MonitorCardData>, String> {
    let topology = value
        .get("topology")
        .ok_or_else(|| "monitor result is missing topology".to_string())?;
    let monitors = topology
        .get("monitors")
        .and_then(Value::as_array)
        .ok_or_else(|| "monitor result is missing topology.monitors".to_string())?;
    monitors
        .iter()
        .map(|monitor| {
            let display_name = string_field(monitor, "name")?;
            let monitor_id = string_field(monitor, "id")?;
            let primary = bool_field(monitor, "isPrimary")?;
            let mode = monitor
                .get("mode")
                .ok_or_else(|| "monitor result is missing mode".to_string())?;
            let width = number_field(mode, "width")?;
            let height = number_field(mode, "height")?;
            let refresh = number_field(mode, "refreshRate")?;
            if width <= 0.0 || height <= 0.0 || refresh <= 0.0 {
                return Err("monitor result contained an invalid display mode".to_string());
            }
            let bounds = monitor
                .get("bounds")
                .ok_or_else(|| "monitor result is missing bounds".to_string())?;
            let x = number_field(bounds, "x")?;
            let y = number_field(bounds, "y")?;
            Ok(MonitorCardData {
                monitor_id,
                display_name,
                resolution: format!("{}×{}  ·  {:.0} Hz", width, height, refresh),
                position: format!("Desktop position  ({x:.0}, {y:.0})"),
                primary,
                gamma_supported: false,
                brightness_supported: false,
                contrast_supported: false,
                capability_note: "Color capability read pending".to_string(),
            })
        })
        .collect()
}

fn decode_gamma(value: &Value) -> Result<(bool, String), String> {
    let tag = string_field(value, "_tag")?;
    if tag == "Unsupported" {
        return Ok((false, "Gamma unavailable".to_string()));
    }
    if tag != "Supported" {
        return Err("gamma capability used an unknown tag".to_string());
    }
    let current = value
        .get("current")
        .ok_or_else(|| "supported gamma capability has no current ramp".to_string())?;
    let red = non_empty_array(current, "red")?;
    let green = non_empty_array(current, "green")?;
    let blue = non_empty_array(current, "blue")?;
    if red.len() != green.len() || red.len() != blue.len() {
        return Err("gamma ramp channels have different lengths".to_string());
    }
    for channel in [red, green, blue] {
        if channel
            .iter()
            .any(|sample| sample.as_f64().is_none_or(|number| !number.is_finite()))
        {
            return Err("gamma ramp contained a non-finite sample".to_string());
        }
    }
    Ok((true, format!("Readback verified  ·  {} samples", red.len())))
}

fn decode_external_level(
    value: &Value,
    label: &str,
) -> Result<(bool, f32, f32, f32, String), String> {
    let tag = string_field(value, "_tag")?;
    if tag == "Unsupported" {
        let reason = value
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("not reported");
        return Ok((false, 0.0, 100.0, 0.0, format!("Unavailable  ·  {reason}")));
    }
    if tag != "Supported" {
        return Err(format!("{label} capability used an unknown tag"));
    }
    let minimum = number_field(value, "minimum")?;
    let current = number_field(value, "current")?;
    let maximum = number_field(value, "maximum")?;
    if minimum < EXTERNAL_LEVEL_MINIMUM
        || maximum > EXTERNAL_LEVEL_MAXIMUM
        || minimum > current
        || current > maximum
        || minimum > maximum
        || current.fract() != 0.0
        || minimum.fract() != 0.0
        || maximum.fract() != 0.0
    {
        return Err(format!("{label} capability reported invalid bounds"));
    }
    Ok((
        true,
        minimum as f32,
        maximum as f32,
        current as f32,
        format!("Readback {current:.0}  ·  bounds {minimum:.0}–{maximum:.0}"),
    ))
}

fn decode_color_state(value: &Value) -> Result<ColorCardData, String> {
    let monitor_id = string_field(value, "monitorId")?;
    let display_name = string_field(value, "displayName")?;
    let gamma_value = decode_gamma(
        value
            .get("gamma")
            .ok_or_else(|| "color result is missing gamma capability".to_string())?,
    )?;
    let brightness = decode_external_level(
        value
            .get("brightness")
            .ok_or_else(|| "color result is missing brightness capability".to_string())?,
        "brightness",
    )?;
    let contrast = decode_external_level(
        value
            .get("contrast")
            .ok_or_else(|| "color result is missing contrast capability".to_string())?,
        "contrast",
    )?;
    Ok(ColorCardData {
        monitor_id,
        display_name,
        gamma_supported: gamma_value.0,
        gamma_value: 1.0,
        gamma_readback: gamma_value.1,
        brightness_supported: brightness.0,
        brightness_minimum: brightness.1,
        brightness_maximum: brightness.2,
        brightness_value: brightness.3,
        brightness_readback: brightness.4,
        contrast_supported: contrast.0,
        contrast_minimum: contrast.1,
        contrast_maximum: contrast.2,
        contrast_value: contrast.3,
        contrast_readback: contrast.4,
        pending_control: String::new(),
    })
}

fn decode_colors(value: &Value) -> Result<Vec<ColorCardData>, String> {
    let colors = value
        .as_array()
        .ok_or_else(|| "color result was not an array".to_string())?;
    colors.iter().map(decode_color_state).collect()
}

fn decode_profiles(value: &Value) -> Result<Vec<ProfileItemData>, String> {
    let profiles = value
        .as_array()
        .ok_or_else(|| "profile result was not an array".to_string())?;
    profiles
        .iter()
        .map(|profile| {
            let name = profile
                .as_str()
                .filter(|name| !name.trim().is_empty())
                .ok_or_else(|| "profile list contained an empty or non-string value".to_string())?;
            Ok(ProfileItemData {
                name: name.to_string(),
                selected: false,
            })
        })
        .collect()
}

fn decode_window_areas(value: &Value) -> Result<Vec<WindowAreaData>, String> {
    let areas = value
        .as_array()
        .ok_or_else(|| "window result was not an array".to_string())?;
    areas
        .iter()
        .map(|area| {
            Ok(WindowAreaData {
                area_id: string_field(area, "areaId")?,
                monitor_id: string_field(area, "monitorId")?,
                monitor_name: string_field(area, "monitorName")?,
                name: string_field(area, "name")?,
                selected: false,
            })
        })
        .collect()
}

fn operation_point(value: &Value, field: &str) -> Result<String, String> {
    let point = value
        .get(field)
        .ok_or_else(|| format!("operation is missing point `{field}`"))?;
    let x = number_field(point, "x")?;
    let y = number_field(point, "y")?;
    Ok(format!("({x:.0}, {y:.0})"))
}

fn operation_mode(value: &Value, field: &str) -> Result<String, String> {
    let mode = value
        .get(field)
        .ok_or_else(|| format!("operation is missing mode `{field}`"))?;
    let width = number_field(mode, "width")?;
    let height = number_field(mode, "height")?;
    let refresh = number_field(mode, "refreshRate")?;
    Ok(format!("{width:.0}×{height:.0} @ {refresh:.0} Hz"))
}

fn decode_profile_preview(value: &Value) -> Result<ProfilePreviewData, String> {
    let name = string_field(value, "name")?;
    let plan = value
        .get("plan")
        .and_then(Value::as_object)
        .ok_or_else(|| "profile preview result is missing plan".to_string())?;
    let dry_run = plan
        .get("dryRun")
        .and_then(Value::as_bool)
        .ok_or_else(|| "profile preview plan is missing dryRun".to_string())?;
    if !dry_run {
        return Err("profile preview returned a non-dry-run plan".to_string());
    }
    let is_noop = plan
        .get("isNoop")
        .and_then(Value::as_bool)
        .ok_or_else(|| "profile preview plan is missing isNoop".to_string())?;
    let operations = plan
        .get("operations")
        .and_then(Value::as_array)
        .ok_or_else(|| "profile preview plan is missing operations".to_string())?;
    let decoded: Result<Vec<_>, String> = operations
        .iter()
        .map(|operation| {
            let tag = string_field(operation, "_tag")?;
            let monitor_id = string_field(operation, "monitorId")?;
            let (kind, detail) = match tag.as_str() {
                "SetDisplayMode" => (
                    "Display mode".to_string(),
                    format!(
                        "{} → {}",
                        operation_mode(operation, "from")?,
                        operation_mode(operation, "to")?
                    ),
                ),
                "MoveMonitor" => (
                    "Move monitor".to_string(),
                    format!(
                        "{} → {}",
                        operation_point(operation, "from")?,
                        operation_point(operation, "to")?
                    ),
                ),
                "SetPrimary" => (
                    "Set primary".to_string(),
                    "Not primary → primary".to_string(),
                ),
                _ => return Err(format!("profile preview used unknown operation `{tag}`")),
            };
            Ok(PreviewOperationData {
                kind,
                monitor_id,
                detail,
            })
        })
        .collect();
    let operations = decoded?;
    if is_noop != operations.is_empty() {
        return Err("profile preview no-op flag did not match operation count".to_string());
    }
    Ok(ProfilePreviewData {
        name,
        dry_run,
        is_noop,
        operations,
    })
}

fn apply_capabilities_to_monitors(state: &mut UiState) {
    for monitor in &mut state.monitors {
        if let Some(color) = state
            .colors
            .iter()
            .find(|color| color.monitor_id == monitor.monitor_id)
        {
            monitor.gamma_supported = color.gamma_supported;
            monitor.brightness_supported = color.brightness_supported;
            monitor.contrast_supported = color.contrast_supported;
            monitor.capability_note = "Capabilities read from backend".to_string();
        } else if state.color_capabilities_ready {
            monitor.capability_note = "No color state returned for this monitor".to_string();
        } else {
            monitor.gamma_supported = false;
            monitor.brightness_supported = false;
            monitor.contrast_supported = false;
            monitor.capability_note = "Color capability read unavailable".to_string();
        }
    }
}

fn monitor_model(rows: &[MonitorCardData]) -> ModelRc<MonitorCard> {
    ModelRc::new(VecModel::from(
        rows.iter()
            .map(|row| MonitorCard {
                monitor_id: SharedString::from(row.monitor_id.clone()),
                display_name: SharedString::from(row.display_name.clone()),
                resolution: SharedString::from(row.resolution.clone()),
                position: SharedString::from(row.position.clone()),
                primary: row.primary,
                gamma_supported: row.gamma_supported,
                brightness_supported: row.brightness_supported,
                contrast_supported: row.contrast_supported,
                capability_note: SharedString::from(row.capability_note.clone()),
            })
            .collect::<Vec<_>>(),
    ))
}

fn color_model(rows: &[ColorCardData]) -> ModelRc<ColorCard> {
    ModelRc::new(VecModel::from(
        rows.iter()
            .map(|row| ColorCard {
                monitor_id: SharedString::from(row.monitor_id.clone()),
                display_name: SharedString::from(row.display_name.clone()),
                gamma_supported: row.gamma_supported,
                gamma_value: row.gamma_value,
                gamma_readback: SharedString::from(row.gamma_readback.clone()),
                brightness_supported: row.brightness_supported,
                brightness_minimum: row.brightness_minimum,
                brightness_maximum: row.brightness_maximum,
                brightness_value: row.brightness_value,
                brightness_readback: SharedString::from(row.brightness_readback.clone()),
                contrast_supported: row.contrast_supported,
                contrast_minimum: row.contrast_minimum,
                contrast_maximum: row.contrast_maximum,
                contrast_value: row.contrast_value,
                contrast_readback: SharedString::from(row.contrast_readback.clone()),
                pending_control: SharedString::from(row.pending_control.clone()),
            })
            .collect::<Vec<_>>(),
    ))
}

fn profile_model(rows: &[ProfileItemData]) -> ModelRc<ProfileItem> {
    ModelRc::new(VecModel::from(
        rows.iter()
            .map(|row| ProfileItem {
                name: SharedString::from(row.name.clone()),
                selected: row.selected,
            })
            .collect::<Vec<_>>(),
    ))
}

fn window_model(rows: &[WindowAreaData]) -> ModelRc<WindowArea> {
    ModelRc::new(VecModel::from(
        rows.iter()
            .map(|row| WindowArea {
                area_id: SharedString::from(row.area_id.clone()),
                monitor_id: SharedString::from(row.monitor_id.clone()),
                monitor_name: SharedString::from(row.monitor_name.clone()),
                name: SharedString::from(row.name.clone()),
                selected: row.selected,
            })
            .collect::<Vec<_>>(),
    ))
}

fn operation_model(rows: &[PreviewOperationData]) -> ModelRc<PreviewOperation> {
    ModelRc::new(VecModel::from(
        rows.iter()
            .map(|row| PreviewOperation {
                kind: SharedString::from(row.kind.clone()),
                monitor_id: SharedString::from(row.monitor_id.clone()),
                detail: SharedString::from(row.detail.clone()),
            })
            .collect::<Vec<_>>(),
    ))
}

fn set_global_error(ui: &MainWindow, message: String) {
    ui.set_has_error(true);
    ui.set_error_message(SharedString::from(message));
}

fn clear_global_error(ui: &MainWindow) {
    ui.set_has_error(false);
    ui.set_error_message(SharedString::from(""));
}

fn update_color_view(ui: &MainWindow, state: &Arc<Mutex<UiState>>) {
    if let Ok(guard) = state.lock() {
        ui.set_color_cards(color_model(&guard.colors));
    }
}

fn begin_action(state: &Arc<Mutex<UiState>>, action: PendingAction) -> Result<(), String> {
    let mut guard = state
        .lock()
        .map_err(|_| "UI action state was poisoned".to_string())?;
    if guard.pending_action.is_some() {
        return Err("Another backend action is still pending".to_string());
    }
    guard.pending_action = Some(action);
    Ok(())
}

fn finish_action(state: &Arc<Mutex<UiState>>) {
    if let Ok(mut guard) = state.lock() {
        guard.pending_action = None;
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

fn mark_refresh_start(ui: &MainWindow) {
    ui.set_loading(true);
    clear_global_error(ui);
}

fn mark_all_sections_loading(ui: &MainWindow) {
    ui.set_monitors_loading(true);
    ui.set_monitors_error(false);
    ui.set_profiles_loading(true);
    ui.set_profiles_error(false);
    ui.set_colors_loading(true);
    ui.set_colors_error(false);
    ui.set_windows_loading(true);
    ui.set_windows_error(false);
}

fn capability_available(value: Option<&Value>, name: &str) -> bool {
    value
        .and_then(|capabilities| capabilities.get(name))
        .and_then(|capability| capability.get("available"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn request_capabilities(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    pending: Arc<AtomicUsize>,
) {
    request_with_ui(
        ui_weak,
        client,
        "capabilities.get",
        json!({}),
        pending,
        |ui, result| match result {
            Ok(value) => {
                let capabilities = value.get("capabilities");
                ui.set_profile_preview_enabled(capability_available(
                    capabilities,
                    "profileApplyPreview",
                ));
                ui.set_color_action_enabled(true);
                ui.set_window_action_enabled(true);
                ui.set_window_snap_enabled(capability_available(capabilities, "windowTools"));
                ui.set_connection_status(SharedString::from("Backend connected  ·  protocol v1"));
            }
            Err(error) => set_global_error(ui, format!("capabilities.get  ·  {error}")),
        },
    );
}

fn request_monitors(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    pending: Arc<AtomicUsize>,
) {
    request_with_ui(
        ui_weak,
        client,
        "monitors.list",
        json!({}),
        pending,
        move |ui, result| {
            ui.set_monitors_loading(false);
            match result {
                Ok(value) => match decode_monitors(&value) {
                    Ok(monitors) => {
                        if let Ok(mut guard) = state.lock() {
                            guard.monitors = monitors;
                            apply_capabilities_to_monitors(&mut guard);
                            ui.set_monitor_cards(monitor_model(&guard.monitors));
                            ui.set_monitors_empty(guard.monitors.is_empty());
                            ui.set_monitor_status(SharedString::from(format!(
                                "{} detected",
                                guard.monitors.len()
                            )));
                        }
                        ui.set_monitors_error(false);
                    }
                    Err(error) => {
                        ui.set_monitors_error(true);
                        ui.set_monitors_error_message(SharedString::from(error.clone()));
                        set_global_error(ui, format!("monitors.list  ·  {error}"));
                    }
                },
                Err(error) => {
                    ui.set_monitors_error(true);
                    ui.set_monitors_error_message(SharedString::from(error.clone()));
                    ui.set_monitor_status(SharedString::from("Unavailable"));
                    set_global_error(ui, format!("monitors.list  ·  {error}"));
                }
            }
        },
    );
}

fn request_profiles(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    pending: Arc<AtomicUsize>,
) {
    request_with_ui(
        ui_weak,
        client,
        "profiles.list",
        json!({}),
        pending,
        move |ui, result| {
            ui.set_profiles_loading(false);
            match result {
                Ok(value) => match decode_profiles(&value) {
                    Ok(mut profiles) => {
                        let selected = ui.get_selected_profile().to_string();
                        if !profiles.iter().any(|profile| profile.name == selected) {
                            ui.set_selected_profile(SharedString::from(""));
                        }
                        for profile in &mut profiles {
                            profile.selected = profile.name == selected;
                        }
                        if let Ok(mut guard) = state.lock() {
                            guard.profiles = profiles;
                            ui.set_profile_items(profile_model(&guard.profiles));
                            ui.set_profiles_empty(guard.profiles.is_empty());
                            ui.set_profile_status(SharedString::from(format!(
                                "{} saved",
                                guard.profiles.len()
                            )));
                            if let ProfileSaveState::Success { name } = &guard.profile_save_state {
                                ui.set_profile_save_status(SharedString::from(format!(
                                    "Saved `{name}`  ·  profile list refreshed"
                                )));
                            }
                        }
                        ui.set_profiles_error(false);
                    }
                    Err(error) => {
                        ui.set_profiles_error(true);
                        ui.set_profiles_error_message(SharedString::from(error.clone()));
                        set_global_error(ui, format!("profiles.list  ·  {error}"));
                    }
                },
                Err(error) => {
                    ui.set_profiles_error(true);
                    ui.set_profiles_error_message(SharedString::from(error.clone()));
                    ui.set_profile_status(SharedString::from("Unavailable"));
                    set_global_error(ui, format!("profiles.list  ·  {error}"));
                }
            }
        },
    );
}

fn request_colors(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    pending: Arc<AtomicUsize>,
) {
    request_with_ui(
        ui_weak,
        client,
        "color.list",
        json!({}),
        pending,
        move |ui, result| {
            ui.set_colors_loading(false);
            match result {
                Ok(value) => match decode_colors(&value) {
                    Ok(colors) => {
                        if let Ok(mut guard) = state.lock() {
                            guard.colors = colors;
                            guard.color_capabilities_ready = true;
                            apply_capabilities_to_monitors(&mut guard);
                            ui.set_color_cards(color_model(&guard.colors));
                            ui.set_monitor_cards(monitor_model(&guard.monitors));
                            ui.set_colors_empty(guard.colors.is_empty());
                            ui.set_color_status(SharedString::from(format!(
                                "{} monitor state{} read",
                                guard.colors.len(),
                                if guard.colors.len() == 1 { "" } else { "s" }
                            )));
                        }
                        ui.set_colors_error(false);
                    }
                    Err(error) => {
                        if let Ok(mut guard) = state.lock() {
                            guard.colors.clear();
                            guard.color_capabilities_ready = false;
                            apply_capabilities_to_monitors(&mut guard);
                            ui.set_color_cards(color_model(&guard.colors));
                            ui.set_monitor_cards(monitor_model(&guard.monitors));
                        }
                        ui.set_colors_error(true);
                        ui.set_colors_error_message(SharedString::from(error.clone()));
                        set_global_error(ui, format!("color.list  ·  {error}"));
                    }
                },
                Err(error) => {
                    if let Ok(mut guard) = state.lock() {
                        guard.colors.clear();
                        guard.color_capabilities_ready = false;
                        apply_capabilities_to_monitors(&mut guard);
                        ui.set_color_cards(color_model(&guard.colors));
                        ui.set_monitor_cards(monitor_model(&guard.monitors));
                    }
                    ui.set_colors_error(true);
                    ui.set_colors_error_message(SharedString::from(error.clone()));
                    ui.set_color_status(SharedString::from("Unavailable"));
                    set_global_error(ui, format!("color.list  ·  {error}"));
                }
            }
        },
    );
}

fn request_windows(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    pending: Arc<AtomicUsize>,
) {
    request_with_ui(
        ui_weak,
        client,
        "window.list",
        json!({}),
        pending,
        move |ui, result| {
            ui.set_windows_loading(false);
            match result {
                Ok(value) => match decode_window_areas(&value) {
                    Ok(areas) => {
                        if let Ok(mut guard) = state.lock() {
                            guard.window_areas = areas;
                            ui.set_window_areas(window_model(&guard.window_areas));
                            ui.set_windows_empty(guard.window_areas.is_empty());
                            ui.set_window_status(SharedString::from(format!(
                                "{} areas available",
                                guard.window_areas.len()
                            )));
                        }
                        ui.set_windows_error(false);
                    }
                    Err(error) => {
                        ui.set_windows_error(true);
                        ui.set_windows_error_message(SharedString::from(error.clone()));
                        set_global_error(ui, format!("window.list  ·  {error}"));
                    }
                },
                Err(error) => {
                    ui.set_windows_error(true);
                    ui.set_windows_error_message(SharedString::from(error.clone()));
                    ui.set_window_status(SharedString::from("Unavailable"));
                    set_global_error(ui, format!("window.list  ·  {error}"));
                }
            }
        },
    );
}

fn refresh_all(ui_weak: Weak<MainWindow>, client: BackendClient, state: Arc<Mutex<UiState>>) {
    if let Some(ui) = ui_weak.upgrade() {
        mark_refresh_start(&ui);
        mark_all_sections_loading(&ui);
        ui.set_connection_status(SharedString::from("Refreshing backend data"));
    }
    let pending = Arc::new(AtomicUsize::new(5));
    request_capabilities(ui_weak.clone(), client.clone(), pending.clone());
    request_monitors(
        ui_weak.clone(),
        client.clone(),
        state.clone(),
        pending.clone(),
    );
    request_profiles(
        ui_weak.clone(),
        client.clone(),
        state.clone(),
        pending.clone(),
    );
    request_colors(
        ui_weak.clone(),
        client.clone(),
        state.clone(),
        pending.clone(),
    );
    request_windows(ui_weak, client, state, pending);
}

fn refresh_monitors(ui_weak: Weak<MainWindow>, client: BackendClient, state: Arc<Mutex<UiState>>) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_monitors_loading(true);
        ui.set_monitors_error(false);
        ui.set_monitor_status(SharedString::from("Reading topology"));
    }
    request_monitors(ui_weak, client, state, Arc::new(AtomicUsize::new(1)));
}

fn refresh_profiles(ui_weak: Weak<MainWindow>, client: BackendClient, state: Arc<Mutex<UiState>>) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_profiles_loading(true);
        ui.set_profiles_error(false);
        ui.set_profile_status(SharedString::from("Reading saved profiles"));
    }
    request_profiles(ui_weak, client, state, Arc::new(AtomicUsize::new(1)));
}

fn refresh_profiles_after_save(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_profiles_loading(true);
        ui.set_profiles_error(false);
        ui.set_profile_status(SharedString::from("Refreshing saved profile names"));
    }
    request_profiles(ui_weak, client, state, Arc::new(AtomicUsize::new(1)));
}

fn refresh_colors(ui_weak: Weak<MainWindow>, client: BackendClient, state: Arc<Mutex<UiState>>) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_colors_loading(true);
        ui.set_colors_error(false);
        ui.set_color_status(SharedString::from("Reading color capabilities"));
    }
    request_colors(ui_weak, client, state, Arc::new(AtomicUsize::new(1)));
}

fn refresh_windows(ui_weak: Weak<MainWindow>, client: BackendClient, state: Arc<Mutex<UiState>>) {
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_windows_loading(true);
        ui.set_windows_error(false);
        ui.set_window_status(SharedString::from("Reading snap areas"));
    }
    request_windows(ui_weak, client, state, Arc::new(AtomicUsize::new(1)));
}

fn select_profile(ui: &MainWindow, state: &Arc<Mutex<UiState>>, name: String) {
    if name.trim().is_empty() {
        return;
    }
    if let Ok(mut guard) = state.lock() {
        if guard.profiles.iter().any(|profile| profile.name == name) {
            for profile in &mut guard.profiles {
                profile.selected = profile.name == name;
            }
            ui.set_selected_profile(SharedString::from(name));
            ui.set_profile_items(profile_model(&guard.profiles));
            ui.set_profile_preview_has_result(false);
            ui.set_profile_preview_error(SharedString::from(""));
            ui.set_profile_preview_operations(operation_model(&[]));
            ui.set_profile_preview_status(SharedString::from(
                "Profile selected  ·  choose Preview plan to validate a dry run",
            ));
        }
    }
}

fn color_request_params(
    colors: &[ColorCardData],
    monitor_id: &str,
    control: &str,
    value: f64,
) -> Result<Value, String> {
    if !value.is_finite() {
        return Err("Color value must be finite".to_string());
    }
    let color = colors
        .iter()
        .find(|color| color.monitor_id == monitor_id)
        .ok_or_else(|| "The selected monitor has no current color state".to_string())?;
    let (supported, minimum, maximum, normalized) = match control {
        "gamma" => (color.gamma_supported, GAMMA_MINIMUM, GAMMA_MAXIMUM, value),
        "brightness" => (
            color.brightness_supported,
            f64::from(color.brightness_minimum),
            f64::from(color.brightness_maximum),
            value.round(),
        ),
        "contrast" => (
            color.contrast_supported,
            f64::from(color.contrast_minimum),
            f64::from(color.contrast_maximum),
            value.round(),
        ),
        _ => return Err("Color control must be gamma, brightness, or contrast".to_string()),
    };
    if !supported {
        return Err(format!("{control} is not supported by this monitor"));
    }
    if normalized < minimum || normalized > maximum {
        return Err(format!(
            "{control} must be between {minimum:.1} and {maximum:.1}"
        ));
    }
    Ok(json!({
        "control": control,
        "monitorId": monitor_id,
        "value": normalized,
    }))
}

fn set_color_pending(state: &Arc<Mutex<UiState>>, monitor_id: &str, control: &str) {
    if let Ok(mut guard) = state.lock() {
        if let Some(color) = guard
            .colors
            .iter_mut()
            .find(|color| color.monitor_id == monitor_id)
        {
            color.pending_control = control.to_string();
        }
    }
}

fn clear_color_pending(state: &Arc<Mutex<UiState>>, monitor_id: &str) {
    if let Ok(mut guard) = state.lock() {
        if let Some(color) = guard
            .colors
            .iter_mut()
            .find(|color| color.monitor_id == monitor_id)
        {
            color.pending_control.clear();
        }
    }
}

fn set_color(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    monitor_id: String,
    control: String,
    value: f32,
) {
    let params = match state.lock() {
        Ok(guard) => color_request_params(&guard.colors, &monitor_id, &control, f64::from(value)),
        Err(_) => Err("UI action state was poisoned".to_string()),
    };
    let params = match params {
        Ok(params) => params,
        Err(error) => {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_colors_error(true);
                ui.set_colors_error_message(SharedString::from(error.clone()));
                set_global_error(&ui, format!("color.set validation  ·  {error}"));
            }
            return;
        }
    };
    if let Err(error) = begin_action(
        &state,
        PendingAction::Color {
            monitor_id: monitor_id.clone(),
            control: control.clone(),
        },
    ) {
        if let Some(ui) = ui_weak.upgrade() {
            ui.set_colors_error(true);
            ui.set_colors_error_message(SharedString::from(error.clone()));
        }
        return;
    }
    set_color_pending(&state, &monitor_id, &control);
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_color_cards(color_model(
            &state
                .lock()
                .map(|guard| guard.colors.clone())
                .unwrap_or_default(),
        ));
        ui.set_colors_error(false);
        ui.set_color_status(SharedString::from(format!(
            "Setting {control}  ·  pending readback"
        )));
    }
    let requested_value = f64::from(value);
    let pending = Arc::new(AtomicUsize::new(1));
    request_with_ui(
        ui_weak,
        client,
        "color.set",
        params,
        pending,
        move |ui, result| {
            finish_action(&state);
            match result {
                Ok(value) => match decode_color_state(&value) {
                    Ok(mut color) => {
                        if color.monitor_id != monitor_id {
                            clear_color_pending(&state, &monitor_id);
                            update_color_view(ui, &state);
                            ui.set_colors_error(true);
                            ui.set_colors_error_message(SharedString::from(
                                "Backend color readback targeted a different monitor",
                            ));
                            set_global_error(
                                ui,
                                "color.set readback  ·  monitor identity mismatch".to_string(),
                            );
                            return;
                        }
                        if control == "gamma" {
                            color.gamma_value = requested_value as f32;
                            color.gamma_readback = format!(
                                "Readback verified  ·  setpoint {requested_value:.1}  ·  256 samples"
                            );
                        }
                        if let Ok(mut guard) = state.lock() {
                            if let Some(existing) = guard
                                .colors
                                .iter_mut()
                                .find(|existing| existing.monitor_id == color.monitor_id)
                            {
                                *existing = color;
                            }
                            apply_capabilities_to_monitors(&mut guard);
                            ui.set_color_cards(color_model(&guard.colors));
                            ui.set_monitor_cards(monitor_model(&guard.monitors));
                        }
                        ui.set_colors_loading(false);
                        ui.set_colors_error(false);
                        ui.set_color_status(SharedString::from(format!(
                            "{control} applied  ·  backend readback verified"
                        )));
                    }
                    Err(error) => {
                        clear_color_pending(&state, &monitor_id);
                        update_color_view(ui, &state);
                        ui.set_colors_error(true);
                        ui.set_colors_error_message(SharedString::from(error.clone()));
                        set_global_error(ui, format!("color.set readback  ·  {error}"));
                    }
                },
                Err(error) => {
                    clear_color_pending(&state, &monitor_id);
                    update_color_view(ui, &state);
                    ui.set_colors_error(true);
                    ui.set_colors_error_message(SharedString::from(error.clone()));
                    ui.set_color_status(SharedString::from("Write rejected"));
                    set_global_error(ui, format!("color.set  ·  {error}"));
                }
            }
        },
    );
}

fn select_window_area(
    ui: &MainWindow,
    state: &Arc<Mutex<UiState>>,
    area_id: String,
    monitor_id: String,
) {
    if let Ok(mut guard) = state.lock() {
        if guard
            .window_areas
            .iter()
            .any(|area| area.area_id == area_id && area.monitor_id == monitor_id)
        {
            for area in &mut guard.window_areas {
                area.selected = area.area_id == area_id && area.monitor_id == monitor_id;
            }
            ui.set_selected_window_area(SharedString::from(area_id));
            ui.set_selected_window_monitor(SharedString::from(monitor_id));
            ui.set_window_areas(window_model(&guard.window_areas));
            ui.set_windows_error(false);
        }
    }
}

fn window_snap_params(
    areas: &[WindowAreaData],
    area_id: &str,
    monitor_id: &str,
) -> Result<Value, String> {
    if area_id.trim().is_empty() || monitor_id.trim().is_empty() {
        return Err("Choose a monitor area before snapping".to_string());
    }
    if !areas
        .iter()
        .any(|area| area.area_id == area_id && area.monitor_id == monitor_id)
    {
        return Err(
            "The selected snap area is not present in the latest backend readback".to_string(),
        );
    }
    Ok(json!({"areaId": area_id, "monitorId": monitor_id}))
}

fn validate_window_snap_ack(value: &Value, area_id: &str, monitor_id: &str) -> Result<(), String> {
    let returned_area = value
        .get("areaId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Backend snap acknowledgement omitted areaId".to_string())?;
    let returned_monitor = value
        .get("monitorId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Backend snap acknowledgement omitted monitorId".to_string())?;
    if returned_area != area_id || returned_monitor != monitor_id {
        return Err("Backend snap acknowledgement did not match the requested area".to_string());
    }
    Ok(())
}

fn snap_window(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    area_id: String,
    monitor_id: String,
) {
    let params = match state.lock() {
        Ok(guard) => window_snap_params(&guard.window_areas, &area_id, &monitor_id),
        Err(_) => Err("UI action state was poisoned".to_string()),
    };
    let params = match params {
        Ok(params) => params,
        Err(error) => {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_windows_error(true);
                ui.set_windows_error_message(SharedString::from(error.clone()));
                set_global_error(&ui, format!("window.snap validation  ·  {error}"));
            }
            return;
        }
    };
    if let Err(error) = begin_action(
        &state,
        PendingAction::WindowSnap {
            area_id: area_id.clone(),
            monitor_id: monitor_id.clone(),
        },
    ) {
        if let Some(ui) = ui_weak.upgrade() {
            ui.set_windows_error(true);
            ui.set_windows_error_message(SharedString::from(error));
        }
        return;
    }
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_window_snap_pending(true);
        ui.set_windows_error(false);
        ui.set_window_status(SharedString::from(
            "Snap pending  ·  foreground window will move",
        ));
    }
    request_with_ui(
        ui_weak,
        client,
        "window.snap",
        params,
        Arc::new(AtomicUsize::new(1)),
        move |ui, result| {
            finish_action(&state);
            ui.set_window_snap_pending(false);
            match result {
                Ok(value) => {
                    if let Err(error) = validate_window_snap_ack(&value, &area_id, &monitor_id) {
                        ui.set_windows_error(true);
                        ui.set_windows_error_message(SharedString::from(error));
                        set_global_error(
                            ui,
                            "window.snap readback  ·  area identity mismatch".to_string(),
                        );
                        return;
                    }
                    ui.set_windows_error(false);
                    ui.set_window_status(SharedString::from(format!(
                        "Snapped foreground window  ·  {area_id}"
                    )));
                    ui.set_connection_status(SharedString::from(
                        "Window snap completed  ·  verify the foreground window position",
                    ));
                }
                Err(error) => {
                    ui.set_windows_error(true);
                    ui.set_windows_error_message(SharedString::from(error.clone()));
                    ui.set_window_status(SharedString::from("Snap rejected"));
                    set_global_error(ui, format!("window.snap  ·  {error}"));
                }
            }
        },
    );
}

fn validate_profile_name(name: &str) -> Result<(), String> {
    if name.trim() != name {
        return Err("Profile names cannot start or end with whitespace".to_string());
    }
    if name.is_empty() {
        return Err("Enter a profile name".to_string());
    }
    if name.chars().count() > 64 {
        return Err("Profile names must be 1–64 characters".to_string());
    }
    let mut characters = name.chars();
    let Some(first) = characters.next() else {
        return Err("Enter a profile name".to_string());
    };
    if !first.is_ascii_alphanumeric()
        || characters.any(|character| {
            !character.is_ascii_alphanumeric() && character != '-' && character != '_'
        })
    {
        return Err("Profile names must use letters, numbers, hyphens, or underscores".to_string());
    }
    if [
        "AUX", "CON", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "NUL", "PRN",
    ]
    .iter()
    .any(|reserved| reserved.eq_ignore_ascii_case(name))
    {
        return Err("Profile names cannot use reserved Windows device names".to_string());
    }
    Ok(())
}

fn profile_save_params(name: &str) -> Result<Value, String> {
    validate_profile_name(name)?;
    Ok(json!({"name": name}))
}

fn profile_save_request(name: &str) -> Result<ProfileSaveRequest, String> {
    Ok(ProfileSaveRequest {
        method: "profiles.save",
        params: profile_save_params(name)?,
    })
}

fn validate_profile_save_ack(value: &Value, requested_name: &str) -> Result<(), String> {
    let returned_name = string_field(value, "name")?;
    if returned_name != requested_name {
        return Err("Backend save acknowledgement returned a different profile name".to_string());
    }
    if bool_field(value, "dryRun")? {
        return Err("Backend reported that the profile was not saved".to_string());
    }
    if !bool_field(value, "saved")? {
        return Err("Backend did not confirm that the profile was saved".to_string());
    }
    if !value.get("profile").is_some_and(Value::is_object) {
        return Err("Backend save acknowledgement omitted the saved profile".to_string());
    }
    Ok(())
}

fn profile_save_started(
    current: &ProfileSaveState,
    name: &str,
) -> Result<ProfileSaveState, String> {
    if matches!(current, ProfileSaveState::Pending { .. }) {
        return Err("A profile save is still pending".to_string());
    }
    Ok(ProfileSaveState::Pending {
        name: name.to_string(),
    })
}

fn profile_save_finished(
    current: &ProfileSaveState,
    result: Result<(), String>,
) -> ProfileSaveState {
    let ProfileSaveState::Pending { name } = current else {
        return current.clone();
    };
    match result {
        Ok(()) => ProfileSaveState::Success { name: name.clone() },
        Err(message) => ProfileSaveState::Error { message },
    }
}

fn set_profile_save_view(ui: &MainWindow, state: &ProfileSaveState) {
    match state {
        ProfileSaveState::Idle => {
            ui.set_profile_save_loading(false);
            ui.set_profile_save_success(false);
            ui.set_profile_save_status(SharedString::from(
                "Save a snapshot of the current display layout",
            ));
            ui.set_profile_save_error(SharedString::from(""));
        }
        ProfileSaveState::Pending { name } => {
            ui.set_profile_save_loading(true);
            ui.set_profile_save_success(false);
            ui.set_profile_save_status(SharedString::from(format!("Saving `{name}`…")));
            ui.set_profile_save_error(SharedString::from(""));
        }
        ProfileSaveState::Success { name } => {
            ui.set_profile_save_loading(false);
            ui.set_profile_save_success(true);
            ui.set_profile_save_status(SharedString::from(format!(
                "Saved `{name}`  ·  refreshing profile list"
            )));
            ui.set_profile_save_error(SharedString::from(""));
        }
        ProfileSaveState::Error { message } => {
            ui.set_profile_save_loading(false);
            ui.set_profile_save_success(false);
            ui.set_profile_save_status(SharedString::from("Profile was not saved"));
            ui.set_profile_save_error(SharedString::from(message.clone()));
        }
    }
}

fn update_profile_save_view(ui: &MainWindow, state: &Arc<Mutex<UiState>>, next: ProfileSaveState) {
    if let Ok(mut guard) = state.lock() {
        guard.profile_save_state = next;
        set_profile_save_view(ui, &guard.profile_save_state);
    }
}

fn profile_preview_params(name: &str) -> Result<Value, String> {
    if name.trim().is_empty() || name.len() > 128 {
        return Err("Choose a valid saved profile name".to_string());
    }
    Ok(json!({"name": name}))
}

fn preview_profile(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    name: String,
) {
    let params = match profile_preview_params(&name) {
        Ok(params) => params,
        Err(error) => {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_profile_preview_error(SharedString::from(error.clone()));
                set_global_error(&ui, format!("profiles.applyPreview validation  ·  {error}"));
            }
            return;
        }
    };
    if let Err(error) = begin_action(&state, PendingAction::ProfilePreview { name: name.clone() }) {
        if let Some(ui) = ui_weak.upgrade() {
            ui.set_profile_preview_error(SharedString::from(error));
        }
        return;
    }
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_loading(true);
        ui.set_profile_preview_loading(true);
        ui.set_profile_preview_error(SharedString::from(""));
        ui.set_profile_preview_status(SharedString::from(format!("Previewing `{name}`")));
    }
    request_with_ui(
        ui_weak,
        client,
        "profiles.applyPreview",
        params,
        Arc::new(AtomicUsize::new(1)),
        move |ui, result| {
            finish_action(&state);
            ui.set_profile_preview_loading(false);
            match result {
                Ok(value) => match decode_profile_preview(&value) {
                    Ok(preview) => {
                        if preview.name != name {
                            ui.set_profile_preview_has_result(false);
                            ui.set_profile_preview_error(SharedString::from(
                                "Backend preview returned a different profile name",
                            ));
                            set_global_error(
                                ui,
                                "profiles.applyPreview validation  ·  profile identity mismatch"
                                    .to_string(),
                            );
                            return;
                        }
                        ui.set_profile_preview_name(SharedString::from(preview.name));
                        ui.set_profile_preview_dry_run(preview.dry_run);
                        ui.set_profile_preview_noop(preview.is_noop);
                        ui.set_profile_preview_operation_count(preview.operations.len() as i32);
                        ui.set_profile_preview_operations(operation_model(&preview.operations));
                        ui.set_profile_preview_has_result(true);
                        ui.set_profile_preview_status(SharedString::from(
                            "Validated preview ready  ·  no display changes applied",
                        ));
                        ui.set_profile_preview_error(SharedString::from(""));
                    }
                    Err(error) => {
                        ui.set_profile_preview_has_result(false);
                        ui.set_profile_preview_error(SharedString::from(error.clone()));
                        set_global_error(
                            ui,
                            format!("profiles.applyPreview validation  ·  {error}"),
                        );
                    }
                },
                Err(error) => {
                    ui.set_profile_preview_has_result(false);
                    ui.set_profile_preview_error(SharedString::from(error.clone()));
                    set_global_error(ui, format!("profiles.applyPreview  ·  {error}"));
                }
            }
        },
    );
}

fn save_profile(
    ui_weak: Weak<MainWindow>,
    client: BackendClient,
    state: Arc<Mutex<UiState>>,
    name: String,
) {
    let request = match profile_save_request(&name) {
        Ok(request) => request,
        Err(error) => {
            if let Some(ui) = ui_weak.upgrade() {
                update_profile_save_view(
                    &ui,
                    &state,
                    ProfileSaveState::Error {
                        message: error.clone(),
                    },
                );
                set_global_error(&ui, format!("profiles.save validation  ·  {error}"));
            }
            return;
        }
    };
    if let Err(error) = begin_action(&state, PendingAction::ProfileSave { name: name.clone() }) {
        if let Some(ui) = ui_weak.upgrade() {
            update_profile_save_view(
                &ui,
                &state,
                ProfileSaveState::Error {
                    message: error.clone(),
                },
            );
            set_global_error(&ui, format!("profiles.save  ·  {error}"));
        }
        return;
    }
    let started = match state.lock() {
        Ok(guard) => profile_save_started(&guard.profile_save_state, &name),
        Err(_) => Err("UI action state was poisoned".to_string()),
    };
    let started = match started {
        Ok(started) => started,
        Err(error) => {
            finish_action(&state);
            if let Some(ui) = ui_weak.upgrade() {
                update_profile_save_view(
                    &ui,
                    &state,
                    ProfileSaveState::Error {
                        message: error.clone(),
                    },
                );
                set_global_error(&ui, format!("profiles.save  ·  {error}"));
            }
            return;
        }
    };
    if let Some(ui) = ui_weak.upgrade() {
        update_profile_save_view(&ui, &state, started);
        ui.set_loading(true);
        clear_global_error(&ui);
    }
    let refresh_client = client.clone();
    request_with_ui(
        ui_weak,
        client,
        request.method,
        request.params,
        Arc::new(AtomicUsize::new(1)),
        move |ui, result| {
            finish_action(&state);
            let save_result = match result {
                Ok(value) => validate_profile_save_ack(&value, &name),
                Err(error) => Err(error),
            };
            let succeeded = save_result.is_ok();
            let error_message = save_result.as_ref().err().cloned();
            if let Ok(mut guard) = state.lock() {
                guard.profile_save_state =
                    profile_save_finished(&guard.profile_save_state, save_result);
                set_profile_save_view(&ui, &guard.profile_save_state);
            }
            if let Some(error) = error_message {
                set_global_error(&ui, format!("profiles.save  ·  {error}"));
                return;
            }
            if succeeded {
                ui.set_profile_status(SharedString::from(
                    "Save confirmed  ·  refreshing saved profile names",
                ));
                refresh_profiles_after_save(ui.as_weak(), refresh_client, state.clone());
            }
        },
    );
}

fn edit_profile_save_name(ui: &MainWindow, state: &Arc<Mutex<UiState>>) {
    if let Ok(mut guard) = state.lock() {
        if matches!(guard.profile_save_state, ProfileSaveState::Pending { .. }) {
            return;
        }
        let had_error = matches!(guard.profile_save_state, ProfileSaveState::Error { .. });
        guard.profile_save_state = ProfileSaveState::Idle;
        set_profile_save_view(ui, &guard.profile_save_state);
        if had_error {
            clear_global_error(ui);
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let ui = MainWindow::new()?;
    let tray = AppTray::new()?;
    let client = BackendClient::start();
    let state = Arc::new(Mutex::new(UiState::default()));
    let tray_state = Arc::new(Mutex::new(TrayState::default()));
    let ui_weak = ui.as_weak();

    ui.window()
        .on_close_requested(|| CloseRequestResponse::HideWindow);

    {
        let weak = ui.as_weak();
        let tray_state = tray_state.clone();
        tray.on_open_window(move || {
            if !apply_tray_command(&tray_state, TrayCommand::Open) {
                return;
            }
            if let Some(ui) = weak.upgrade() {
                let _ = ui.show();
                ui.window().request_redraw();
            }
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        let tray_state = tray_state.clone();
        tray.on_refresh(move || {
            if apply_tray_command(&tray_state, TrayCommand::Refresh) {
                refresh_all(weak.clone(), backend.clone(), state.clone());
            }
        });
    }
    {
        let tray_state = tray_state.clone();
        tray.on_quit(move || {
            if apply_tray_command(&tray_state, TrayCommand::Quit) {
                let _ = slint::quit_event_loop();
            }
        });
    }

    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_refresh_clicked(move || refresh_all(weak.clone(), backend.clone(), state.clone()));
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_monitor_retry_clicked(move || {
            refresh_monitors(weak.clone(), backend.clone(), state.clone())
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_profile_retry_clicked(move || {
            refresh_profiles(weak.clone(), backend.clone(), state.clone())
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_color_retry_clicked(move || {
            refresh_colors(weak.clone(), backend.clone(), state.clone())
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_window_retry_clicked(move || {
            refresh_windows(weak.clone(), backend.clone(), state.clone())
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_profile_selected(move |name| {
            if let Some(ui) = weak.upgrade() {
                select_profile(&ui, &state, name.to_string());
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_profile_save_name_edited(move |_name| {
            if let Some(ui) = weak.upgrade() {
                edit_profile_save_name(&ui, &state);
            }
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_profile_save_requested(move |name| {
            save_profile(
                weak.clone(),
                backend.clone(),
                state.clone(),
                name.to_string(),
            );
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_profile_preview_clicked(move |name| {
            if let Some(ui) = weak.upgrade() {
                select_profile(&ui, &state, name.to_string());
            }
            preview_profile(
                weak.clone(),
                backend.clone(),
                state.clone(),
                name.to_string(),
            )
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_color_set_requested(move |monitor_id, control, value| {
            set_color(
                weak.clone(),
                backend.clone(),
                state.clone(),
                monitor_id.to_string(),
                control.to_string(),
                value,
            )
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_window_area_selected(move |area_id, monitor_id| {
            if let Some(ui) = weak.upgrade() {
                select_window_area(&ui, &state, area_id.to_string(), monitor_id.to_string());
            }
        });
    }
    {
        let weak = ui.as_weak();
        let backend = client.clone();
        let state = state.clone();
        ui.on_window_snap_clicked(move || {
            if let Some(ui) = weak.upgrade() {
                snap_window(
                    weak.clone(),
                    backend.clone(),
                    state.clone(),
                    ui.get_selected_window_area().to_string(),
                    ui.get_selected_window_monitor().to_string(),
                );
            }
        });
    }

    refresh_all(ui_weak, client, state);
    ui.show()?;
    tray.show()?;
    ui.run()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ProfileSaveState, TrayCommand, TrayState, WindowAreaData, color_request_params,
        decode_colors, decode_monitors, decode_profile_preview, decode_window_areas,
        profile_preview_params, profile_save_finished, profile_save_params, profile_save_request,
        profile_save_started, receive_backend_response, reduce_tray_command, split_command_line,
        validate_profile_name, validate_profile_save_ack, validate_response,
        validate_window_snap_ack, window_snap_params,
    };
    use serde_json::json;

    fn supported_color_state() -> serde_json::Value {
        json!({
            "monitorId": "device:test-primary",
            "displayName": "Primary",
            "gamma": {
                "_tag": "Supported",
                "current": {
                    "red": [0, 65535],
                    "green": [0, 65535],
                    "blue": [0, 65535]
                }
            },
            "brightness": {
                "_tag": "Supported",
                "minimum": 0,
                "current": 50,
                "maximum": 100
            },
            "contrast": {
                "_tag": "Unsupported",
                "reason": "not exposed"
            }
        })
    }

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

    #[test]
    fn decoders_keep_empty_backend_results_empty() {
        assert!(
            decode_monitors(&json!({"topology": {"monitors": []}}))
                .expect("empty topology should decode")
                .is_empty()
        );
        assert!(
            decode_colors(&json!([]))
                .expect("empty color list should decode")
                .is_empty()
        );
        assert!(
            decode_window_areas(&json!([]))
                .expect("empty window list should decode")
                .is_empty()
        );
    }

    #[test]
    fn decoders_reject_malformed_untrusted_shapes() {
        assert!(decode_monitors(&json!({"topology": {"monitors": [{"name": "A"}]}})).is_err());
        assert!(decode_colors(&json!([{"monitorId": "a"}])).is_err());
        assert!(decode_window_areas(&json!([{"areaId": "Full"}])).is_err());
    }

    #[test]
    fn color_action_safety_checks_capability_and_bounds_before_ipc() {
        let color = decode_colors(&json!([supported_color_state()]))
            .expect("supported color state should decode");
        let gamma_outside = color_request_params(&color, "device:test-primary", "gamma", 4.5);
        assert!(gamma_outside.is_err());
        let unsupported = color_request_params(&color, "device:test-primary", "contrast", 50.0);
        assert!(unsupported.is_err());
        let rounded = color_request_params(&color, "device:test-primary", "brightness", 50.4)
            .expect("external levels are normalized to safe integers");
        assert_eq!(rounded["value"], json!(50.0));
    }

    #[test]
    fn window_action_safety_requires_an_exact_readback_pair() {
        let areas = vec![WindowAreaData {
            area_id: "Full".to_string(),
            monitor_id: "device:a".to_string(),
            monitor_name: "A".to_string(),
            name: "Full screen".to_string(),
            selected: false,
        }];
        assert!(window_snap_params(&areas, "Full", "device:b").is_err());
        assert_eq!(
            window_snap_params(&areas, "Full", "device:a").expect("known pair should pass"),
            json!({"areaId": "Full", "monitorId": "device:a"})
        );
        assert!(
            validate_window_snap_ack(
                &json!({"areaId": "Full", "monitorId": "device:b"}),
                "Full",
                "device:a"
            )
            .is_err()
        );
    }

    #[test]
    fn profile_preview_decoder_requires_a_dry_run_and_consistent_noop() {
        let valid = json!({
            "name": "desk",
            "plan": {
                "dryRun": true,
                "isNoop": false,
                "operations": [{
                    "_tag": "MoveMonitor",
                    "monitorId": "device:a",
                    "from": {"x": 0, "y": 0},
                    "to": {"x": 100, "y": 0}
                }]
            }
        });
        assert_eq!(
            decode_profile_preview(&valid)
                .expect("valid preview")
                .operations
                .len(),
            1
        );
        let mut not_dry = valid.clone();
        not_dry["plan"]["dryRun"] = json!(false);
        assert!(decode_profile_preview(&not_dry).is_err());
        let mut inconsistent = valid;
        inconsistent["plan"]["isNoop"] = json!(true);
        assert!(decode_profile_preview(&inconsistent).is_err());
    }

    #[test]
    fn profile_preview_action_rejects_empty_names_without_ipc() {
        assert!(profile_preview_params("").is_err());
        assert_eq!(
            profile_preview_params("desk").expect("bounded name should pass"),
            json!({"name": "desk"})
        );
    }

    #[test]
    fn profile_save_request_is_file_only_and_cannot_target_mutations() {
        let request = profile_save_request("desk-work").expect("valid name should pass");
        assert_eq!(request.method, "profiles.save");
        assert_eq!(request.params, json!({"name": "desk-work"}));
        assert!(!["profiles.apply", "color.set", "window.snap"].contains(&request.method));
    }

    #[test]
    fn profile_save_name_validation_matches_the_safe_filename_contract() {
        assert!(validate_profile_name("desk_work-2").is_ok());
        assert!(validate_profile_name("").is_err());
        assert!(validate_profile_name(" desk").is_err());
        assert!(validate_profile_name("desk ").is_err());
        assert!(validate_profile_name("desk layout").is_err());
        assert!(validate_profile_name("desk.layout").is_err());
        assert!(validate_profile_name("CON").is_err());
        assert!(validate_profile_name(&"a".repeat(65)).is_err());
        assert_eq!(
            profile_save_params("desk").expect("valid name should pass"),
            json!({"name": "desk"})
        );
    }

    #[test]
    fn profile_save_state_reports_pending_success_and_error_without_side_effects() {
        let idle = ProfileSaveState::Idle;
        let pending = profile_save_started(&idle, "desk").expect("idle can start a save");
        assert_eq!(
            pending,
            ProfileSaveState::Pending {
                name: "desk".to_string()
            }
        );
        assert!(profile_save_started(&pending, "other").is_err());
        assert_eq!(
            profile_save_finished(&pending, Ok(())),
            ProfileSaveState::Success {
                name: "desk".to_string()
            }
        );
        assert_eq!(
            profile_save_finished(&pending, Err("disk full".to_string())),
            ProfileSaveState::Error {
                message: "disk full".to_string()
            }
        );
        assert_eq!(profile_save_finished(&idle, Ok(())), idle);
    }

    #[test]
    fn profile_save_ack_requires_a_real_non_dry_run_save() {
        let saved = json!({
            "dryRun": false,
            "name": "desk",
            "profile": {},
            "saved": true
        });
        assert!(validate_profile_save_ack(&saved, "desk").is_ok());

        let mut dry_run = saved.clone();
        dry_run["dryRun"] = json!(true);
        assert!(validate_profile_save_ack(&dry_run, "desk").is_err());

        let mut wrong_name = saved;
        wrong_name["name"] = json!("other");
        assert!(validate_profile_save_ack(&wrong_name, "desk").is_err());
    }

    #[test]
    fn color_decoder_separates_gamma_setpoint_from_readback() {
        let colors =
            decode_colors(&json!([supported_color_state()])).expect("fixture should decode");
        assert_eq!(colors[0].gamma_value, 1.0);
        assert!(colors[0].gamma_readback.contains("samples"));
    }

    #[test]
    fn tray_open_is_idempotent_and_quit_is_explicit() {
        let state = TrayState::default();
        let opened = reduce_tray_command(state, TrayCommand::Open);
        assert_eq!(
            opened,
            TrayState {
                panel_visible: true,
                quit_requested: false
            }
        );
        assert_eq!(reduce_tray_command(opened, TrayCommand::Open), opened);
        assert_eq!(reduce_tray_command(opened, TrayCommand::Refresh), opened);
        assert_eq!(
            reduce_tray_command(opened, TrayCommand::Quit),
            TrayState {
                panel_visible: true,
                quit_requested: true
            }
        );
    }

    #[test]
    fn backend_watchdog_returns_recoverable_timeout_and_disconnect_errors() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let timeout =
            receive_backend_response(&receiver, "monitors.list", std::time::Duration::ZERO)
                .expect_err("an empty response channel should time out");
        assert!(
            matches!(timeout, super::TransactionError::Transport(message) if message.contains("timed out") && message.contains("restarted"))
        );
        drop(sender);
        let disconnected =
            receive_backend_response(&receiver, "monitors.list", std::time::Duration::ZERO)
                .expect_err("a closed response channel should be recoverable");
        assert!(
            matches!(disconnected, super::TransactionError::Transport(message) if message.contains("response reader stopped") && message.contains("restarted"))
        );
    }
}
