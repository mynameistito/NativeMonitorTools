/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof -- Error translation inspects untrusted Effect failures only at this protocol boundary. */

import { Effect } from "effect";

import type {
  NativeUiApplicationApi,
  NativeUiApplicationError,
} from "../application/native-ui";
import {
  encodeIpcResponse,
  parseIpcRequest,
  IPC_PROTOCOL_VERSION,
  MAX_IPC_MESSAGE_BYTES,
} from "./protocol";
import type {
  IpcDetailValue,
  IpcDetails,
  IpcError,
  IpcErrorCode,
  IpcRequest,
  IpcResponse,
  IpcResult,
} from "./protocol";
import { IpcTransportError, readJsonLines } from "./transport";
import type { IpcTransport } from "./transport";

const impossible = (): never => {
  throw new Error("Unexpected IPC method");
};

/** Server options controlling the inbound and outbound message cap. */
export interface IpcServerOptions {
  readonly maxMessageBytes?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const stringField = (value: unknown, key: string): string | undefined => {
  const candidate = field(value, key);
  return typeof candidate === "string" ? candidate : undefined;
};

const errorDetails = (
  entries: readonly (readonly [string, IpcDetailValue | undefined])[]
): IpcDetails | undefined => {
  const present = entries.filter(
    (entry): entry is readonly [string, IpcDetailValue] =>
      entry[1] !== undefined
  );
  if (present.length === 0) {
    return undefined;
  }
  const details: Record<string, IpcDetailValue> = {};
  for (const [key, value] of present) {
    details[key] = value;
  }
  return details;
};

const makeError = (
  code: IpcErrorCode,
  message: string,
  details?: IpcDetails
): IpcError =>
  details === undefined ? { code, message } : { code, details, message };

const applicationError = (error: unknown): IpcError => {
  const tag = stringField(error, "_tag");
  switch (tag) {
    case "NativeUiAdapterError": {
      const kind = stringField(error, "kind");
      return makeError(
        kind === "unsupported" ? "CAPABILITY_UNAVAILABLE" : "BACKEND_ERROR",
        stringField(error, "reason") ?? "Monitor discovery failed",
        errorDetails([
          ["operation", stringField(error, "operation")],
          ["kind", kind],
        ])
      );
    }
    case "ProfileNotFound": {
      return makeError(
        "PROFILE_NOT_FOUND",
        "The requested profile does not exist",
        errorDetails([["name", stringField(error, "name")]])
      );
    }
    case "InvalidProfileName": {
      return makeError(
        "INVALID_PROFILE_NAME",
        stringField(error, "reason") ?? "Profile name is invalid"
      );
    }
    case "InvalidDisplayProfile": {
      return makeError(
        "INVALID_PROFILE",
        stringField(error, "reason") ?? "Display profile is invalid",
        errorDetails([["path", stringField(error, "path")]])
      );
    }
    case "InvalidTopology": {
      return makeError(
        "INVALID_TOPOLOGY",
        stringField(error, "reason") ?? "Monitor topology is invalid",
        errorDetails([["monitorId", stringField(error, "monitorId")]])
      );
    }
    case "InvalidApplyPlan": {
      return makeError(
        "INVALID_APPLY_PLAN",
        stringField(error, "reason") ?? "Display profile cannot be planned",
        errorDetails([["monitorId", stringField(error, "monitorId")]])
      );
    }
    case "ProfileStoreError": {
      return makeError(
        "BACKEND_ERROR",
        "The profile store operation failed",
        errorDetails([["operation", stringField(error, "operation")]])
      );
    }
    default: {
      return makeError("INTERNAL_ERROR", "The desktop application failed");
    }
  }
};

const errorResponse = (id: string | null, error: IpcError): IpcResponse => ({
  error,
  id,
  ok: false,
  version: IPC_PROTOCOL_VERSION,
});

const successResponse = (id: string, result: IpcResult): IpcResponse => ({
  id,
  ok: true,
  result,
  version: IPC_PROTOCOL_VERSION,
});

const dispatch = (
  application: NativeUiApplicationApi,
  request: IpcRequest
): Effect.Effect<IpcResult, NativeUiApplicationError> => {
  switch (request.method) {
    case "capabilities.get": {
      return Effect.succeed(application.capabilitySnapshot());
    }
    case "monitors.list": {
      return application.discoverMonitors();
    }
    case "profiles.list": {
      return application.listProfiles();
    }
    case "profiles.show": {
      return application.showProfile(request.params.name).pipe(
        Effect.map((profile) => ({
          name: request.params.name,
          profile,
        }))
      );
    }
    case "profiles.save": {
      return application.saveProfile(request.params.name, {
        dryRun: request.params.dryRun,
        profile: request.params.profile,
      });
    }
    case "profiles.diff": {
      return application.diffProfile(request.params.name);
    }
    case "profiles.applyPreview": {
      return application.previewProfileApply(request.params.name);
    }
    default: {
      return impossible();
    }
  }
};

const safeMaxMessageBytes = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : MAX_IPC_MESSAGE_BYTES;

const responseLine = (
  response: IpcResponse,
  maxMessageBytes: number
): string => {
  const encoded = encodeIpcResponse(response);
  if (new TextEncoder().encode(encoded).byteLength <= maxMessageBytes) {
    return encoded;
  }
  return encodeIpcResponse(
    errorResponse(
      response.id,
      makeError(
        "RESPONSE_TOO_LARGE",
        "IPC response exceeds the configured size limit"
      )
    )
  );
};

/**
 * Handle one complete JSON-lines request and return one response line.
 *
 * @param line - An inbound JSON request without its line terminator.
 * @param application - The application service invoked by the boundary.
 * @param options - Optional message-size configuration.
 * @returns A serialized response without its line terminator.
 */
export const handleIpcLine = async (
  line: string,
  application: NativeUiApplicationApi,
  options: IpcServerOptions = {}
): Promise<string> => {
  const maxMessageBytes = safeMaxMessageBytes(options.maxMessageBytes);
  const parsed = parseIpcRequest(line, maxMessageBytes);
  if (parsed._tag === "Failure") {
    return responseLine(
      errorResponse(
        parsed.error.id,
        makeError(parsed.error.code, parsed.error.reason)
      ),
      maxMessageBytes
    );
  }
  try {
    const result = await Effect.runPromise(dispatch(application, parsed.value));
    return responseLine(
      successResponse(parsed.value.id, result),
      maxMessageBytes
    );
  } catch (error) {
    return responseLine(
      errorResponse(parsed.value.id, applicationError(error)),
      maxMessageBytes
    );
  }
};

const transportError = (error: IpcTransportError): IpcError =>
  makeError(error.code, error.reason);

/**
 * Serve Native SDK UI requests until the transport reaches EOF.
 *
 * @param transport - A JSON-lines transport, such as stdio or a test seam.
 * @param application - The application service invoked for each request.
 * @param options - Optional message-size configuration.
 */
export const serveNativeUiIpc = async (
  transport: IpcTransport,
  application: NativeUiApplicationApi,
  options: IpcServerOptions = {}
): Promise<void> => {
  const maxMessageBytes = safeMaxMessageBytes(options.maxMessageBytes);
  try {
    for await (const line of readJsonLines(
      transport.readChunks(),
      maxMessageBytes
    )) {
      await transport.writeLine(
        await handleIpcLine(line, application, { maxMessageBytes })
      );
    }
  } catch (error) {
    if (!(error instanceof IpcTransportError)) {
      throw error;
    }
    await transport.writeLine(
      responseLine(errorResponse(null, transportError(error)), maxMessageBytes)
    );
  }
};
