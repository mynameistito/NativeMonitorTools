# Slint native panel

This directory contains the first working Slint slice for Native Monitor Tools. It is a compact, native-rendered Rust/Slint control panel. It does not embed a webview, JavaScript runtime, or backend library in the native binary.

## What works

- launches a Bun backend child process and speaks the existing version 1 line-oriented JSON IPC over stdin/stdout;
- renders monitor discovery and saved profile list responses;
- renders explicit connecting, refreshing, empty, unsupported, and error states;
- invokes `profiles.applyPreview` from each **Preview plan** button;
- saves the current display layout as a named profile through `profiles.save`; this writes only the profile file and never applies display settings;
- reads `color.list` and `window.list` when available;
- exposes bounded per-monitor `color.set` controls with pending/bounds/readback states and an explicit, warning-gated `window.snap` action. Profile apply actions remain preview-only as required by the backend safety contract.
- stays resident through Slint 1.17's native system tray with one reusable panel: Open, Refresh, and explicit Quit actions are available without creating duplicate windows;
- bounds each JSONL request to a 15-second watchdog, terminates a hung child, reports a recoverable error, and launches a fresh child for the next request.

## Build and run

From the repository root, use the packaged panel build/dev path. It first compiles the Bun JSON-lines adapter from `backend-stdio.ts` and stages it beside the Rust panel under the ignored `dist/slint-panel/debug` directory:

```powershell
bun run panel:backend:build
bun run panel:build
bun run panel:dev
bun run panel:release
bun run panel:test
```

The lower-level Rust checks can still be run directly with `cargo check --manifest-path apps/slint-ui/Cargo.toml` and `cargo test --manifest-path apps/slint-ui/Cargo.toml`.

`panel:release` writes a self-contained Windows release directory at `dist/slint-panel/release`. It builds the compiled JSON-lines backend and the release panel, places the backend beside the panel, and copies `COPYING.txt` and `NOTICE.md` when those files are present. The command fails if either compiled executable is missing; it never selects a backend from `PATH` while staging the release.

The default backend executable is `native-monitor-tools-backend.exe` on Windows, or `native-monitor-tools-backend` elsewhere. A packaged release keeps that executable beside the panel launcher so it cannot accidentally bind to an unrelated backend on `PATH`.

### Development backend source override

The current Bun desktop source exposes the JSON-lines server as a service seam; `backend-stdio.ts` is the local adapter that composes the real desktop application and serves that same protocol on stdio. After `bun install` has been run at the repository root, use this development path:

```powershell
$env:NMT_BACKEND_COMMAND = "bun run apps/slint-ui/backend-stdio.ts"
cargo run --manifest-path apps/slint-ui/Cargo.toml
```

This path performs monitor/color/window reads, bounded color writes, explicit window snaps, and profile preview planning through the existing IPC contract. Clear the variable with `Remove-Item Env:NMT_BACKEND_COMMAND` when finished.

## Backend command overrides

- `NMT_BACKEND_COMMAND` — a quoted command line, parsed without a shell. This is the most useful override for development, such as `bun run ...`.
- `NMT_BACKEND_EXECUTABLE` — executable path used when no command override is set.
- `NMT_BACKEND_ARGS` — optional quoted arguments for the executable override.

The longer aliases `NATIVE_MONITOR_TOOLS_BACKEND_COMMAND` and `NATIVE_MONITOR_TOOLS_BACKEND_EXECUTABLE` are also accepted.
