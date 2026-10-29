import { Effect } from "effect";

import { UnsupportedCapability } from "./application/capabilities";
import { makeDesktopApplicationLayer } from "./application/composition";
import { DesktopApplication } from "./application/service";
import { parseCliArgs } from "./cli/parser";
import { renderCliError, renderCliResult } from "./cli/renderer";
import {
  decodeNativeUiArgument,
  encodeNativeUiArgument,
  runNativeUiRequest,
} from "./native-ui-host";
import {
  parseDesktopPlatform,
  resolveDesktopPaths,
} from "./storage/configuration";

const command = Effect.gen(function* commandEffect() {
  const parsed = yield* parseCliArgs(process.argv.slice(2));
  const application = yield* DesktopApplication;
  const result = yield* application.execute(parsed);
  return renderCliResult(result, parsed.format);
});

const run = async (): Promise<void> => {
  if (process.argv.includes("--native-ui")) {
    const [encoded] = process.argv.slice(3);
    const input =
      encoded === undefined
        ? new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer())
        : (decodeNativeUiArgument(encoded) ?? new Uint8Array(0));
    const output = await runNativeUiRequest(input);
    process.stdout.write(
      encoded === undefined ? output : encodeNativeUiArgument(output)
    );
    return;
  }
  const paths = resolveDesktopPaths(
    process.env,
    parseDesktopPlatform(process.platform),
    process.env.USERPROFILE ?? process.env.HOME ?? "."
  );
  try {
    const output = await Effect.runPromise(
      Effect.provide(command, makeDesktopApplicationLayer(paths))
    );
    process.stdout.write(`${output}\n`);
    process.exitCode = 0;
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error("Desktop command failed.");
    process.stderr.write(`${renderCliError(failure)}\n`);
    process.exitCode = error instanceof UnsupportedCapability ? 2 : 1;
  }
};

if (import.meta.main) {
  void run();
}

export {
  createWindowsDisplayPort,
  edidRegistrySubkeyForInterfacePath,
} from "./platform/windows";
export type {
  BrightnessContrastCapabilities,
  ExternalLevelCapability,
  GammaRamp,
  WindowsDisplayNativeApi,
  WindowsDisplay,
  WindowsDisplayDiscovery,
  WindowsDisplayIdentity,
  WindowsDisplayPort,
  WindowsDisplayPortOptions,
  WindowsNativeDisplayMode,
  WindowsNativeDisplayRecord,
  WindowsNativeLevelReading,
  WindowsPhysicalMonitorLease,
  WindowsPlatformOperation,
  WindowsPlatformResult,
} from "./platform/windows";
export type {
  WindowsNativePointer as WindowsDisplayNativePointer,
  WindowsNativeRect as WindowsDisplayNativeRect,
} from "./platform/windows";
export {
  createWindowsWindowPort,
  parseWindowGeometry,
  parseWindowsNativeRect,
} from "./platform/windows/window";
export type {
  WindowsNativePointer,
  WindowsNativeRect,
  WindowsWindowHandle,
  WindowsForegroundWindowMoveRequest,
  WindowsForegroundWindowMoveResult,
  WindowsWindowMonitorTarget,
  WindowsWindowNativeApi,
  WindowsWindowOperation,
  WindowsWindowPort,
  WindowsWindowPortOptions,
  WindowsWindowRect,
  WindowsWindowResult,
} from "./platform/windows/window";
export {
  createWindowsCursorPort,
  parseCursorClipRect,
  parseCursorPoint,
  parseCursorPosition,
} from "./platform/windows/cursor";
export type {
  WindowsCursorLockLease,
  WindowsCursorNativeApi,
  WindowsCursorPoint,
  WindowsCursorPort,
  WindowsCursorPortOptions,
  WindowsCursorRect,
  WindowsCursorOperation,
  WindowsCursorResult,
} from "./platform/windows/cursor";

export {
  makeNativeUiApplicationLayer,
  makeNativeUiApplication,
  makeProductionNativeUiApplication,
  NativeUiAdapterError,
  NativeUiApplication,
} from "./application";
export type {
  NativeUiApplicationApi,
  NativeUiApplicationDependencies,
  NativeUiApplicationError,
  NativeUiCapability,
  NativeUiCapabilityName,
  NativeUiCapabilitySnapshot,
  NativeUiColorSetRequest,
  NativeUiColorState,
  NativeUiSavedProfile,
  NativeUiWindowArea,
  NativeUiWindowSnapRequest,
  NativeUiWindowSnapResult,
} from "./application";
export { NativeUiIpcClient } from "./ipc/client";
export { NativeUiIpcClientError } from "./ipc/client-error";
export type { IpcClientOptions } from "./ipc/client";
export {
  encodeIpcRequest,
  encodeIpcResponse,
  IpcProtocolError,
  parseIpcRequest,
  parseIpcResponse,
} from "./ipc/protocol";
export type {
  IpcDetailValue,
  IpcDetails,
  IpcEmptyParams,
  IpcError,
  IpcErrorCode,
  IpcErrorResponse,
  IpcMethod,
  IpcRequest,
  IpcRequestInput,
  IpcRequestParseResult,
  IpcResponse,
  IpcResponseParseResult,
  IpcResult,
  IpcSuccessResponse,
} from "./ipc/protocol";
export { handleIpcLine, serveNativeUiIpc } from "./ipc/server";
export type { IpcServerOptions } from "./ipc/server";
export {
  IpcTransportError,
  makeStdioTransport,
  readJsonLines,
} from "./ipc/transport";
export type {
  IpcChunk,
  IpcTransport,
  IpcWritable,
  StdioTransportOptions,
} from "./ipc/transport";
export {
  IPC_METHODS,
  IPC_PROTOCOL_VERSION,
  MAX_IPC_MESSAGE_BYTES,
  MAX_IPC_REQUEST_ID_BYTES,
} from "./ipc/protocol";
