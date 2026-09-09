import { Effect } from "effect";

import { UnsupportedCapability } from "./application/capabilities";
import { makeDesktopApplicationLayer } from "./application/composition";
import { DesktopApplication } from "./application/service";
import { parseCliArgs } from "./cli/parser";
import { renderCliError, renderCliResult } from "./cli/renderer";
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

export { createWindowsDisplayPort } from "./platform/windows";
export type {
  BrightnessContrastCapabilities,
  ExternalLevelCapability,
  GammaRamp,
  WindowsDisplay,
  WindowsDisplayDiscovery,
  WindowsDisplayIdentity,
  WindowsDisplayPort,
  WindowsPlatformOperation,
  WindowsPlatformResult,
} from "./platform/windows";

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
  NativeUiSavedProfile,
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
