# Slint native panel

This directory contains the first working Slint slice for Native Monitor Tools. It is a compact, native-rendered Rust/Slint control panel. It does not embed a webview, JavaScript runtime, or backend library in the native binary.

## What works

- launches a Bun backend child process and speaks the existing version 1 line-oriented JSON IPC over stdin/stdout;
- renders monitor discovery and saved profile list responses;
- renders explicit connecting, refreshing, empty, unsupported, and error states;
- invokes `profiles.applyPreview` from each **Preview plan** button;
- reads `color.list` and `window.list` when available;
- shows color and window-tool data while keeping `color.set` and `window.snap` controls intentionally disabled. This slice never sends those mutation requests. Profile actions remain preview-only as required by the backend safety contract.

## Build and run

From the repository root, install Rust dependencies and compile the app:

```powershell
cargo check --manifest-path apps/slint-ui/Cargo.toml
cargo test --manifest-path apps/slint-ui/Cargo.toml
cargo run --manifest-path apps/slint-ui/Cargo.toml
```

The default backend executable is `native-monitor-tools-backend.exe` on Windows, or `native-monitor-tools-backend` elsewhere. It must implement the JSON-lines protocol and be on `PATH` (or beside the panel launcher).

### Development backend path

The current Bun desktop source exposes the JSON-lines server as a service seam; `backend-stdio.ts` is the local adapter that composes the real desktop application and serves that same protocol on stdio. After `bun install` has been run at the repository root, use this development path:

```powershell
$env:NMT_BACKEND_COMMAND = "bun run apps/slint-ui/backend-stdio.ts"
cargo run --manifest-path apps/slint-ui/Cargo.toml
```

This path performs monitor/color/window **reads** and profile preview planning, but the Slint UI still never invokes display, color, or window mutations. Clear the variable with `Remove-Item Env:NMT_BACKEND_COMMAND` when finished.

## Backend command overrides

- `NMT_BACKEND_COMMAND` — a quoted command line, parsed without a shell. This is the most useful override for development, such as `bun run ...`.
- `NMT_BACKEND_EXECUTABLE` — executable path used when no command override is set.
- `NMT_BACKEND_ARGS` — optional quoted arguments for the executable override.

The longer aliases `NATIVE_MONITOR_TOOLS_BACKEND_COMMAND` and `NATIVE_MONITOR_TOOLS_BACKEND_EXECUTABLE` are also accepted.
