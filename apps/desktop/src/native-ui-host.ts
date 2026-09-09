import { Effect } from "effect";

import { makeNativeUiApplicationLayer } from "./application/composition";
import { NativeUiApplication } from "./application/native-ui";
import type { NativeUiApplicationApi } from "./application/native-ui";
import type {
  WindowsDisplay,
  WindowsDisplayDiscovery,
} from "./platform/windows";
import {
  parseDesktopPlatform,
  resolveDesktopPaths,
} from "./storage/configuration";

const PROTOCOL_VERSION = 1;
const DISPLAY_FRAME_KIND = 1;
const PROFILE_FRAME_KIND = 2;
const APPLY_FRAME_KIND = 3;
const ERROR_FRAME_KIND = 255;
const MAX_FRAME_ITEMS = 64;
const MAX_FRAME_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

type NativeUiRequest =
  | { readonly kind: "displays" }
  | { readonly kind: "profiles" }
  | { readonly kind: "apply"; readonly name: string };

const appendU16 = (output: number[], value: number): void => {
  const high = Math.trunc(value / 256);
  output.push(value - high * 256, high);
};

const appendBytes = (output: number[], value: Uint8Array): void => {
  appendU16(output, value.byteLength);
  for (const byte of value) {
    output.push(byte);
  }
};

const frame = (kind: number, body: readonly number[]): Uint8Array =>
  new Uint8Array([PROTOCOL_VERSION, kind, ...body]);

const errorFrame = (operation: number, message: string): Uint8Array => {
  const output: number[] = [operation];
  appendBytes(output, textEncoder.encode(message));
  return frame(ERROR_FRAME_KIND, output);
};

const decodeRequest = (input: Uint8Array): NativeUiRequest | null => {
  if (input.length < 4 || input[0] !== PROTOCOL_VERSION) {
    return null;
  }
  const [, kind, nameLengthLow, nameLengthHigh] = input;
  const nameLength = (nameLengthLow ?? 0) + (nameLengthHigh ?? 0) * 256;
  if (4 + nameLength !== input.length) {
    return null;
  }
  if (kind === 1 && nameLength === 0) {
    return { kind: "displays" };
  }
  if (kind === 2 && nameLength === 0) {
    return { kind: "profiles" };
  }
  if (kind !== 3 || nameLength === 0) {
    return null;
  }
  try {
    return {
      kind: "apply",
      name: textDecoder.decode(input.slice(4)),
    };
  } catch {
    return null;
  }
};

const decodeHex = (value: string): Uint8Array | null => {
  if (value.length === 0 || value.length % 2 !== 0) {
    return null;
  }
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      return null;
    }
    output[index] = byte;
  }
  return output;
};

const hexDigit = (value: number): string => {
  const digits = "0123456789abcdef";
  return digits.slice(value, value + 1);
};

/** Encode a response for the text-only child-process carrier. */
export const encodeNativeUiArgument = (value: Uint8Array): string => {
  let output = "";
  for (const byte of value) {
    const high = Math.floor(byte / 16);
    const low = byte - high * 16;
    output += hexDigit(high) + hexDigit(low);
  }
  return output;
};

const displayResolution = (display: WindowsDisplay): Uint8Array =>
  textEncoder.encode(
    `${display.snapshot.mode.width}×${display.snapshot.mode.height}`
  );

const displayPosition = (display: WindowsDisplay): Uint8Array =>
  textEncoder.encode(
    `${display.snapshot.bounds.x}, ${display.snapshot.bounds.y}`
  );

const encodeDisplays = (discovery: WindowsDisplayDiscovery): Uint8Array => {
  const output: number[] = [];
  const displays = discovery.displays.slice(0, MAX_FRAME_ITEMS);
  appendU16(output, displays.length);
  for (const display of displays) {
    appendBytes(output, textEncoder.encode(display.snapshot.id));
    output.push(display.snapshot.isPrimary ? 1 : 0);
    appendBytes(output, textEncoder.encode(display.snapshot.name));
    appendBytes(output, displayResolution(display));
    appendBytes(output, displayPosition(display));
    output.push(0, 0);
  }
  return frame(DISPLAY_FRAME_KIND, output);
};

const encodeProfiles = (names: readonly string[]): Uint8Array => {
  const output: number[] = [];
  const profiles = names.slice(0, MAX_FRAME_ITEMS);
  appendU16(output, profiles.length);
  for (const name of profiles) {
    const encodedName = textEncoder.encode(name);
    appendBytes(output, encodedName);
    appendBytes(output, encodedName);
    appendBytes(output, textEncoder.encode("Saved display profile"));
    appendU16(output, 0);
  }
  return frame(PROFILE_FRAME_KIND, output);
};

const operationFor = (request: NativeUiRequest): number => {
  if (request.kind === "displays") {
    return 1;
  }
  if (request.kind === "profiles") {
    return 2;
  }
  return 3;
};

const dispatchRequest = async (
  application: NativeUiApplicationApi,
  request: NativeUiRequest
): Promise<Uint8Array> => {
  if (request.kind === "displays") {
    return encodeDisplays(
      await Effect.runPromise(application.discoverMonitors())
    );
  }
  if (request.kind === "profiles") {
    return encodeProfiles(await Effect.runPromise(application.listProfiles()));
  }
  await Effect.runPromise(application.previewProfileApply(request.name));
  return frame(APPLY_FRAME_KIND, [0, 0]);
};

/** Execute one bounded Native SDK request for the external UI service. */
export const runNativeUiRequest = async (
  input: Uint8Array
): Promise<Uint8Array> => {
  const request = decodeRequest(input);
  if (request === null) {
    return errorFrame(0, "Native UI request is not a valid protocol v1 frame.");
  }
  const paths = resolveDesktopPaths(
    process.env,
    parseDesktopPlatform(process.platform),
    process.env.USERPROFILE ?? process.env.HOME ?? "."
  );
  try {
    const application = await Effect.runPromise(
      Effect.provide(
        NativeUiApplication,
        makeNativeUiApplicationLayer(paths, process.platform)
      )
    );
    return await dispatchRequest(application, request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Native UI request failed.";
    return errorFrame(operationFor(request), message);
  }
};

/** Decode the argument form used by the Native SDK service carrier. */
export const decodeNativeUiArgument = (value: string): Uint8Array | null =>
  decodeHex(value);

export const nativeUiFrameLimit = MAX_FRAME_BYTES;
