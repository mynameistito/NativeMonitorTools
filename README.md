# Native Monitor Tools

Native Monitor Tools is a Bun workspace for a desktop runtime and shared code.

## License and attribution

Native Monitor Tools is licensed under the GNU General Public License version 3 (GPLv3) and incorporates GPLv3-compatible behavior and code from Dual Monitor Tools r555/2.13. See [`COPYING.txt`](COPYING.txt) and [`NOTICE.md`](NOTICE.md) for the full license and attribution details.

## Workspace layout

- `apps/desktop` — the Bun desktop runtime entry point
- `apps/native-ui` — the Native SDK native-rendered Windows UI
- `apps/site` — a dependency-free placeholder for a future site
- `packages/core` — shared core package, ready for future monitor logic

To install dependencies:

```sh
bun install
```

To run the desktop app:

```sh
bun run dev
```

To validate or test the native UI (requires the Native SDK CLI and Zig for a full build):

```sh
bun run ui:check
bun run ui:test
bun run ui:dev
```

`ui:check` and `ui:test` use `scripts/native-sdk-cli.ts`, which delegates all arguments to the pinned `@native-sdk/cli@0.10.1` through Bun and preserves its exit code. On Windows, the shared wrapper prepends the tracked `scripts/native-sdk-windows/include` directory to `C_INCLUDE_PATH`; its minimal `sys/types.h` supplies the missing `ssize_t` typedef for the runtime header. The root also pins the published `@scriptc/runtime@0.0.36`, while the CLI continues to pin `scriptc`/`@scriptc/compiler` to `0.0.35`. Using the installed runtime source as `SCRIPTC_TEST_RUNTIME_SRC_DIR` was tested but does not compile with that bundled compiler, so the wrapper does not select it automatically. An explicitly set `SCRIPTC_TEST_RUNTIME_SRC_DIR` is preserved. When `clang.exe` is not already on `PATH`, the wrapper first uses the directory from `NATIVE_SDK_LLVM_BIN` when set, then falls back to `%ProgramFiles%\LLVM\bin`. It prepends that directory only when it contains `clang.exe`; other platforms and missing LLVM installations are left unchanged. The wrapper preserves native compiler failures and does not patch `%TEMP%`, change global `SCRIPTC_CC`/`zigcc` settings, or hide diagnostics.

`ui:dev` first compiles the Bun/Effect backend to `dist/native-monitor-tools-backend.exe`, prepends that directory to `PATH`, and starts the Native SDK development host. The packaged Native SDK app needs the same backend executable discoverable beside it or on `PATH`.

On Windows, the pinned Native SDK `0.10.1` currently passes `ui:check`, but `ui:test` and native builds are blocked by its generated COFF `build-obj` graph when a TypeScript core archive and markup object are attached together: `coff does not support linking multiple objects into one`. This is a Native SDK/Zig limitation rather than an application or monitor-runtime failure; do not work around it by patching generated caches or changing global compiler settings.

The Native SDK UI is a separate native-rendered app. It communicates with the Bun/Effect desktop backend through a versioned IPC boundary; it does not embed a JavaScript runtime or import backend services directly.

Useful checks:

```sh
bun run typecheck
bun run lint
bun run test
```

The desktop runtime owns the monitor adapter, profile storage, and versioned IPC host. The Native SDK UI reaches it through a generated service request and keeps profile actions preview-only; the explicit desktop CLI `profile apply` command can apply a non-dry-run display plan through the Windows adapter.

Windows discovery keeps the PNP device path as the stable monitor identity and opportunistically enriches the display name and metadata from the monitor's registry EDID (`HKLM\\SYSTEM\\CurrentControlSet\\Enum\\DISPLAY`). Missing or malformed registry data is treated as absent metadata and never changes the identity or prevents topology discovery.

Window Tools now exposes the nine built-in DMT snap areas for every discovered monitor and routes an explicit foreground-window snap through the bounded Windows port. Geometry is derived from the current work area and the topology is re-read before the write so a monitor change fails safely instead of applying a stale target.
