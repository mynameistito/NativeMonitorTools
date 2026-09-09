/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This module is the explicit untrusted JSON protocol boundary. */

import type {
  ApplyPlan,
  DisplayProfile,
  TopologyDiff,
} from "@native-monitor-tools/core";
import { Data } from "effect";

import type {
  NativeUiCapabilitySnapshot,
  NativeUiSavedProfile,
} from "../application/native-ui";
import type { WindowsDisplayDiscovery } from "../platform/windows";

/** Maximum UTF-8 bytes accepted for one JSON-lines message. */
export const MAX_IPC_MESSAGE_BYTES = 64 * 1024;

/** Maximum UTF-8 bytes accepted for one request identifier. */
export const MAX_IPC_REQUEST_ID_BYTES = 128;

/** Protocol version implemented by this boundary. */
export const IPC_PROTOCOL_VERSION = 1 as const;

/** Methods available to a Native SDK UI client. */
export type IpcMethod =
  | "capabilities.get"
  | "monitors.list"
  | "profiles.list"
  | "profiles.show"
  | "profiles.save"
  | "profiles.diff"
  | "profiles.applyPreview";

/** Parameters accepted by a method which does not need request arguments. */
export type IpcEmptyParams = Readonly<Record<never, never>>;

/** Request envelope without the generated protocol version and identifier. */
export type IpcRequestInput =
  | { readonly method: "capabilities.get"; readonly params?: IpcEmptyParams }
  | { readonly method: "monitors.list"; readonly params?: IpcEmptyParams }
  | { readonly method: "profiles.list"; readonly params?: IpcEmptyParams }
  | {
      readonly method: "profiles.show";
      readonly params: { readonly name: string };
    }
  | {
      readonly method: "profiles.save";
      readonly params: {
        readonly dryRun?: boolean;
        readonly name: string;
        readonly profile?: unknown;
      };
    }
  | {
      readonly method: "profiles.diff";
      readonly params: { readonly name: string };
    }
  | {
      readonly method: "profiles.applyPreview";
      readonly params: { readonly name: string };
    };

/** A versioned, identified request accepted by the Native SDK UI boundary. */
export type IpcRequest = IpcRequestInput & {
  readonly id: string;
  readonly version: 1;
};

/** Result projection for a successful protocol method. */
export type IpcResult =
  | NativeUiCapabilitySnapshot
  | WindowsDisplayDiscovery
  | readonly string[]
  | NativeUiSavedProfile
  | { readonly name: string; readonly profile: DisplayProfile }
  | { readonly diff: TopologyDiff; readonly name: string }
  | { readonly name: string; readonly plan: ApplyPlan };

/** Stable error codes used in protocol error responses. */
export type IpcErrorCode =
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "INVALID_PARAMS"
  | "INVALID_RESPONSE"
  | "INVALID_UTF8"
  | "MESSAGE_TOO_LARGE"
  | "UNKNOWN_METHOD"
  | "UNSUPPORTED_VERSION"
  | "PROFILE_NOT_FOUND"
  | "INVALID_PROFILE_NAME"
  | "INVALID_PROFILE"
  | "INVALID_TOPOLOGY"
  | "INVALID_APPLY_PLAN"
  | "CAPABILITY_UNAVAILABLE"
  | "BACKEND_ERROR"
  | "RESPONSE_TOO_LARGE"
  | "INTERNAL_ERROR";

/** JSON-safe scalar values used for structured protocol diagnostics. */
export type IpcDetailValue =
  | boolean
  | null
  | number
  | readonly string[]
  | string;

/** JSON-safe structured diagnostics attached to an error response. */
export type IpcDetails = Readonly<Record<string, IpcDetailValue>>;

/** Typed protocol parsing failure. */
export class IpcProtocolError extends Data.TaggedError("IpcProtocolError")<{
  readonly code: IpcErrorCode;
  readonly id: string | null;
  readonly reason: string;
}> {}

/** Error payload returned by the server for one request. */
export interface IpcError {
  readonly code: IpcErrorCode;
  readonly details?: IpcDetails;
  readonly message: string;
}

/** Successful response envelope. */
export interface IpcSuccessResponse {
  readonly id: string;
  readonly ok: true;
  readonly result: unknown;
  readonly version: 1;
}

/** Failed response envelope; null identifies malformed input without an ID. */
export interface IpcErrorResponse {
  readonly error: IpcError;
  readonly id: string | null;
  readonly ok: false;
  readonly version: 1;
}

/** All response envelopes emitted by the server or accepted by the client. */
export type IpcResponse = IpcSuccessResponse | IpcErrorResponse;

/** Result of parsing an inbound request without throwing or rejecting. */
export type IpcRequestParseResult =
  | { readonly _tag: "Failure"; readonly error: IpcProtocolError }
  | { readonly _tag: "Success"; readonly value: IpcRequest };

/** Result of parsing a response received by the client. */
export type IpcResponseParseResult =
  | { readonly _tag: "Failure"; readonly error: IpcProtocolError }
  | { readonly _tag: "Success"; readonly value: IpcResponse };

/** The method names in protocol declaration order. */
export const IPC_METHODS: readonly IpcMethod[] = [
  "capabilities.get",
  "monitors.list",
  "profiles.list",
  "profiles.show",
  "profiles.save",
  "profiles.diff",
  "profiles.applyPreview",
];

const textEncoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(record, key);

const hasOnlyKeys = (
  record: Record<string, unknown>,
  allowed: readonly string[]
): boolean => {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
};

const messageBytes = (value: string): number =>
  textEncoder.encode(value).byteLength;

const parseIdentifier = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return messageBytes(value) <= MAX_IPC_REQUEST_ID_BYTES ? value : null;
};

const parseBoundedString = (
  value: unknown,
  field: string,
  id: string | null
): { readonly _tag: "Failure"; readonly error: IpcProtocolError } | string => {
  if (typeof value !== "string" || value.length === 0) {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_PARAMS",
        id,
        reason: `${field} must be a non-empty string`,
      }),
    };
  }
  if (messageBytes(value) > MAX_IPC_REQUEST_ID_BYTES) {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_PARAMS",
        id,
        reason: `${field} is too long`,
      }),
    };
  }
  return value;
};

const failure = (
  id: string | null,
  code: IpcErrorCode,
  reason: string
): IpcRequestParseResult => ({
  _tag: "Failure",
  error: new IpcProtocolError({ code, id, reason }),
});

const parseEmptyParams = (
  id: string,
  value: unknown
): IpcRequestParseResult | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || Object.keys(value).length > 0) {
    return failure(
      id,
      "INVALID_PARAMS",
      "This method does not accept parameters"
    );
  }
  return undefined;
};

const parseNameParams = (
  id: string,
  value: unknown
):
  | { readonly _tag: "Failure"; readonly error: IpcProtocolError }
  | { readonly name: string } => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["name"])) {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_PARAMS",
        id,
        reason: "Parameters must contain only a profile name",
      }),
    };
  }
  const name = parseBoundedString(value.name, "name", id);
  return typeof name === "string"
    ? { name }
    : { _tag: "Failure", error: name.error };
};

const parseSaveParams = (
  id: string,
  value: unknown
):
  | { readonly _tag: "Failure"; readonly error: IpcProtocolError }
  | {
      readonly dryRun?: boolean;
      readonly name: string;
      readonly profile?: unknown;
    } => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["dryRun", "name", "profile"])) {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_PARAMS",
        id,
        reason: "Save parameters must contain name, profile, or dryRun",
      }),
    };
  }
  if (hasOwn(value, "dryRun") && typeof value.dryRun !== "boolean") {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_PARAMS",
        id,
        reason: "dryRun must be a boolean",
      }),
    };
  }
  const name = parseBoundedString(value.name, "name", id);
  if (typeof name !== "string") {
    return { _tag: "Failure", error: name.error };
  }
  if (!hasOwn(value, "profile") && !hasOwn(value, "dryRun")) {
    return { name };
  }
  if (hasOwn(value, "profile") && hasOwn(value, "dryRun")) {
    return { dryRun: value.dryRun === true, name, profile: value.profile };
  }
  if (hasOwn(value, "profile")) {
    return { name, profile: value.profile };
  }
  return { dryRun: value.dryRun === true, name };
};

const parseRequestValue = (decoded: unknown): IpcRequestParseResult => {
  if (!isRecord(decoded)) {
    return failure(null, "INVALID_REQUEST", "Request must be a JSON object");
  }
  const id = parseIdentifier(decoded.id);
  if (id === null) {
    return failure(
      null,
      "INVALID_REQUEST",
      "Request id must be a bounded string"
    );
  }
  if (!hasOnlyKeys(decoded, ["id", "method", "params", "version"])) {
    return failure(id, "INVALID_REQUEST", "Request contains an unknown field");
  }
  if (decoded.version !== IPC_PROTOCOL_VERSION) {
    return failure(
      id,
      "UNSUPPORTED_VERSION",
      "Only IPC protocol version 1 is supported"
    );
  }
  if (typeof decoded.method !== "string") {
    return failure(id, "INVALID_REQUEST", "Request method must be a string");
  }
  const method = IPC_METHODS.find((candidate) => candidate === decoded.method);
  if (method === undefined) {
    return failure(
      id,
      "UNKNOWN_METHOD",
      `Unsupported IPC method: ${decoded.method}`
    );
  }

  if (
    method === "capabilities.get" ||
    method === "monitors.list" ||
    method === "profiles.list"
  ) {
    const paramsFailure = parseEmptyParams(id, decoded.params);
    if (paramsFailure !== undefined) {
      return paramsFailure;
    }
    return {
      _tag: "Success",
      value: { id, method, version: IPC_PROTOCOL_VERSION },
    };
  }

  if (method === "profiles.save") {
    const params = parseSaveParams(id, decoded.params);
    if ("_tag" in params) {
      return { _tag: "Failure", error: params.error };
    }
    return {
      _tag: "Success",
      value: { id, method, params, version: IPC_PROTOCOL_VERSION },
    };
  }

  const params = parseNameParams(id, decoded.params);
  if ("_tag" in params) {
    return { _tag: "Failure", error: params.error };
  }
  return {
    _tag: "Success",
    value: { id, method, params, version: IPC_PROTOCOL_VERSION },
  };
};

/**
 * Parse one untrusted JSON-lines request into a typed request value.
 *
 * @param input - One line without its line terminator.
 * @param maxMessageBytes - Maximum UTF-8 message size.
 * @returns A success value or typed protocol failure.
 */
export const parseIpcRequest = (
  input: string,
  maxMessageBytes: number = MAX_IPC_MESSAGE_BYTES
): IpcRequestParseResult => {
  if (messageBytes(input) > maxMessageBytes) {
    return failure(
      null,
      "MESSAGE_TOO_LARGE",
      "IPC message exceeds the configured size limit"
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    return failure(null, "INVALID_JSON", "IPC message is not valid JSON");
  }
  return parseRequestValue(decoded);
};

const isErrorCode = (value: unknown): value is IpcErrorCode =>
  typeof value === "string" &&
  [
    "INVALID_JSON",
    "INVALID_REQUEST",
    "INVALID_PARAMS",
    "INVALID_RESPONSE",
    "INVALID_UTF8",
    "MESSAGE_TOO_LARGE",
    "UNKNOWN_METHOD",
    "UNSUPPORTED_VERSION",
    "PROFILE_NOT_FOUND",
    "INVALID_PROFILE_NAME",
    "INVALID_PROFILE",
    "INVALID_TOPOLOGY",
    "INVALID_APPLY_PLAN",
    "CAPABILITY_UNAVAILABLE",
    "BACKEND_ERROR",
    "RESPONSE_TOO_LARGE",
    "INTERNAL_ERROR",
  ].includes(value);

const isDetailValue = (value: unknown): value is IpcDetailValue => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
};

const parseDetails = (value: unknown): IpcDetails | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const details: Record<string, IpcDetailValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isDetailValue(item)) {
      return undefined;
    }
    details[key] = item;
  }
  return details;
};

/**
 * Parse one response received from a Native SDK UI server.
 *
 * @param input - One response line without its line terminator.
 * @returns A success value or typed protocol failure.
 */
export const parseIpcResponse = (input: string): IpcResponseParseResult => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_JSON",
        id: null,
        reason: "IPC response is not valid JSON",
      }),
    };
  }
  if (!isRecord(decoded)) {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_RESPONSE",
        id: null,
        reason: "IPC response must be a JSON object",
      }),
    };
  }
  const { id } = decoded;
  let responseId: string | null;
  if (id === null) {
    responseId = null;
  } else {
    const parsedId = parseIdentifier(id);
    if (parsedId === null) {
      return {
        _tag: "Failure",
        error: new IpcProtocolError({
          code: "INVALID_RESPONSE",
          id: null,
          reason: "IPC response id must be a bounded string or null",
        }),
      };
    }
    responseId = parsedId;
  }
  if (
    decoded.version !== IPC_PROTOCOL_VERSION ||
    typeof decoded.ok !== "boolean"
  ) {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code:
          decoded.version === IPC_PROTOCOL_VERSION
            ? "INVALID_RESPONSE"
            : "UNSUPPORTED_VERSION",
        id: responseId,
        reason: "IPC response envelope is invalid",
      }),
    };
  }
  if (decoded.ok === true) {
    if (responseId === null || !hasOwn(decoded, "result")) {
      return {
        _tag: "Failure",
        error: new IpcProtocolError({
          code: "INVALID_RESPONSE",
          id: responseId,
          reason: "Successful IPC responses require an id and result",
        }),
      };
    }
    return {
      _tag: "Success",
      value: {
        id: responseId,
        ok: true,
        result: decoded.result,
        version: IPC_PROTOCOL_VERSION,
      },
    };
  }
  if (
    !isRecord(decoded.error) ||
    !isErrorCode(decoded.error.code) ||
    typeof decoded.error.message !== "string"
  ) {
    return {
      _tag: "Failure",
      error: new IpcProtocolError({
        code: "INVALID_RESPONSE",
        id: responseId,
        reason: "Failed IPC responses require a typed error payload",
      }),
    };
  }
  const details = parseDetails(decoded.error.details);
  const error: IpcError =
    details === undefined
      ? { code: decoded.error.code, message: decoded.error.message }
      : { code: decoded.error.code, details, message: decoded.error.message };
  return {
    _tag: "Success",
    value: {
      error,
      id: responseId,
      ok: false,
      version: IPC_PROTOCOL_VERSION,
    },
  };
};

/** Serialize a validated request as one JSON-lines record. */
export const encodeIpcRequest = (request: IpcRequest): string =>
  JSON.stringify(request);

/** Serialize a validated response as one JSON-lines record. */
export const encodeIpcResponse = (response: IpcResponse): string =>
  JSON.stringify(response);
