import { Effect } from "effect";

import { makeNativeUiApplicationLayer } from "./application/composition";
import { NativeUiApplication } from "./application/native-ui";
import type {
  NativeUiApplicationApi,
  NativeUiCapabilitySnapshot,
  NativeUiColorSetRequest,
  NativeUiColorState,
  NativeUiWindowArea,
  NativeUiWindowSnapRequest,
} from "./application/native-ui";
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
const COLOR_FRAME_KIND = 4;
const COLOR_SET_OPERATION = 5;
const WINDOW_AREAS_FRAME_KIND = 6;
const WINDOW_AREAS_OPERATION = 6;
const WINDOW_SNAP_FRAME_KIND = 7;
const WINDOW_SNAP_OPERATION = 7;
const ERROR_FRAME_KIND = 255;
const MAX_FRAME_ITEMS = 64;
const MAX_FRAME_BYTES = 64 * 1024;
export const nativeUiFrameLimit = MAX_FRAME_BYTES;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

type NativeUiRequest =
  | { readonly kind: "displays" }
  | { readonly kind: "colors" }
  | { readonly kind: "colorSet"; readonly request: NativeUiColorSetRequest }
  | { readonly kind: "profiles" }
  | { readonly kind: "apply"; readonly name: string }
  | { readonly kind: "windowAreas" }
  | {
      readonly kind: "windowSnap";
      readonly request: NativeUiWindowSnapRequest;
    };

const colorControl = (
  value: number
): NativeUiColorSetRequest["control"] | null => {
  if (value === 1) {
    return "gamma";
  }
  if (value === 2) {
    return "brightness";
  }
  if (value === 3) {
    return "contrast";
  }
  return null;
};

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

const boundedUtf8 = (value: string, maxBytes: number): Uint8Array => {
  const output: number[] = [];
  for (const character of value) {
    const encoded = textEncoder.encode(character);
    if (output.length + encoded.byteLength > maxBytes) {
      break;
    }
    for (const byte of encoded) {
      output.push(byte);
    }
  }
  return new Uint8Array(output);
};

const errorFrame = (operation: number, message: string): Uint8Array => {
  const output: number[] = [operation];
  appendBytes(output, boundedUtf8(message, MAX_FRAME_BYTES - 5));
  return frame(ERROR_FRAME_KIND, output);
};

const decodeColorSetRequest = (
  input: Uint8Array,
  nameLength: number
): NativeUiRequest | null => {
  if (nameLength === 0 || input.length !== 7 + nameLength) {
    return null;
  }
  const control = colorControl(input[4 + nameLength] ?? 0);
  if (control === null) {
    return null;
  }
  let value = (input[5 + nameLength] ?? 0) + (input[6 + nameLength] ?? 0) * 256;
  if (control === "gamma") {
    value /= 100;
  }
  try {
    return {
      kind: "colorSet",
      request: {
        control,
        monitorId: textDecoder.decode(input.slice(4, 4 + nameLength)),
        value,
      },
    };
  } catch {
    return null;
  }
};

const decodeWindowSnapRequest = (
  input: Uint8Array,
  monitorIdLength: number
): NativeUiRequest | null => {
  const monitorIdStart = 4;
  const areaLengthOffset = monitorIdStart + monitorIdLength;
  if (monitorIdLength === 0 || areaLengthOffset + 2 > input.length) {
    return null;
  }
  const areaLength =
    (input[areaLengthOffset] ?? 0) + (input[areaLengthOffset + 1] ?? 0) * 256;
  const areaStart = areaLengthOffset + 2;
  if (areaLength === 0 || areaStart + areaLength !== input.length) {
    return null;
  }
  try {
    return {
      kind: "windowSnap",
      request: {
        areaId: textDecoder.decode(input.slice(areaStart)),
        monitorId: textDecoder.decode(
          input.slice(monitorIdStart, monitorIdStart + monitorIdLength)
        ),
      },
    };
  } catch {
    return null;
  }
};

const decodeRequest = (input: Uint8Array): NativeUiRequest | null => {
  if (input.length < 4 || input[0] !== PROTOCOL_VERSION) {
    return null;
  }
  const [, kind, nameLengthLow, nameLengthHigh] = input;
  const nameLength = (nameLengthLow ?? 0) + (nameLengthHigh ?? 0) * 256;
  if (kind === COLOR_SET_OPERATION) {
    return decodeColorSetRequest(input, nameLength);
  }
  if (kind === WINDOW_SNAP_OPERATION) {
    return decodeWindowSnapRequest(input, nameLength);
  }
  if (4 + nameLength !== input.length) {
    return null;
  }
  if (kind === 1 && nameLength === 0) {
    return { kind: "displays" };
  }
  if (kind === 2 && nameLength === 0) {
    return { kind: "profiles" };
  }
  if (kind === 4 && nameLength === 0) {
    return { kind: "colors" };
  }
  if (kind === WINDOW_AREAS_OPERATION && nameLength === 0) {
    return { kind: "windowAreas" };
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

const isHexNibble = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 15;

const decodeHex = (value: string): Uint8Array | null => {
  if (value.length === 0 || value.length % 2 !== 0) {
    return null;
  }
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    const high = Number.parseInt(value.slice(index * 2, index * 2 + 1), 16);
    const low = Number.parseInt(value.slice(index * 2 + 1, index * 2 + 2), 16);
    if (!isHexNibble(high) || !isHexNibble(low)) {
      return null;
    }
    output[index] = high * 16 + low;
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

/** Encode the display frame using the application's current capabilities. */
export const encodeDisplays = (
  discovery: WindowsDisplayDiscovery,
  capabilitySnapshot: NativeUiCapabilitySnapshot
): Uint8Array => {
  const output: number[] = [];
  const displays = discovery.displays.slice(0, MAX_FRAME_ITEMS);
  appendU16(output, displays.length);
  for (const display of displays) {
    appendBytes(output, textEncoder.encode(display.snapshot.id));
    output.push(display.snapshot.isPrimary ? 1 : 0);
    appendBytes(output, textEncoder.encode(display.snapshot.name));
    appendBytes(output, displayResolution(display));
    appendBytes(output, displayPosition(display));
    output.push(
      capabilitySnapshot.capabilities.color.available ? 1 : 0,
      capabilitySnapshot.capabilities.windowTools.available ? 1 : 0
    );
  }
  return frame(DISPLAY_FRAME_KIND, output);
};

const appendColorLevel = (
  output: number[],
  level: NativeUiColorState["brightness"]
): void => {
  if (level._tag === "Unsupported") {
    output.push(0);
    appendBytes(output, textEncoder.encode(level.reason));
    return;
  }
  output.push(1);
  appendU16(output, level.minimum);
  appendU16(output, level.current);
  appendU16(output, level.maximum);
};

const encodeColors = (states: readonly NativeUiColorState[]): Uint8Array => {
  const output: number[] = [];
  const limited = states.slice(0, MAX_FRAME_ITEMS);
  appendU16(output, limited.length);
  for (const state of limited) {
    appendBytes(output, textEncoder.encode(state.monitorId));
    appendBytes(output, textEncoder.encode(state.displayName));
    if (state.gamma._tag === "Supported") {
      output.push(1);
    } else {
      output.push(0);
      appendBytes(output, textEncoder.encode(state.gamma.reason));
    }
    appendColorLevel(output, state.brightness);
    appendColorLevel(output, state.contrast);
  }
  return frame(COLOR_FRAME_KIND, output);
};

const encodeWindowAreas = (
  areas: readonly NativeUiWindowArea[]
): Uint8Array => {
  const output: number[] = [];
  const limited = areas.slice(0, MAX_FRAME_ITEMS);
  appendU16(output, limited.length);
  for (const area of limited) {
    appendBytes(output, textEncoder.encode(area.monitorId));
    appendBytes(output, textEncoder.encode(area.monitorName));
    appendBytes(output, textEncoder.encode(area.areaId));
    appendBytes(output, textEncoder.encode(area.name));
  }
  return frame(WINDOW_AREAS_FRAME_KIND, output);
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
  if (request.kind === "colors") {
    return 4;
  }
  if (request.kind === "colorSet") {
    return COLOR_SET_OPERATION;
  }
  if (request.kind === "windowAreas") {
    return WINDOW_AREAS_OPERATION;
  }
  if (request.kind === "windowSnap") {
    return WINDOW_SNAP_OPERATION;
  }
  return 3;
};

const dispatchRequest = async (
  application: NativeUiApplicationApi,
  request: NativeUiRequest
): Promise<Uint8Array> => {
  if (request.kind === "displays") {
    const discovery = await Effect.runPromise(application.discoverMonitors());
    return encodeDisplays(discovery, application.capabilitySnapshot());
  }
  if (request.kind === "profiles") {
    return encodeProfiles(await Effect.runPromise(application.listProfiles()));
  }
  if (request.kind === "colors") {
    return encodeColors(await Effect.runPromise(application.listColor()));
  }
  if (request.kind === "colorSet") {
    await Effect.runPromise(application.setColor(request.request));
    return encodeColors(await Effect.runPromise(application.listColor()));
  }
  if (request.kind === "windowAreas") {
    return encodeWindowAreas(
      await Effect.runPromise(application.listWindowAreas())
    );
  }
  if (request.kind === "windowSnap") {
    await Effect.runPromise(application.snapForegroundWindow(request.request));
    return frame(WINDOW_SNAP_FRAME_KIND, [0]);
  }
  await Effect.runPromise(application.previewProfileApply(request.name));
  return frame(APPLY_FRAME_KIND, [0, 0]);
};

/** Execute one bounded Native SDK request for the external UI service. */
export const runNativeUiRequest = async (
  input: Uint8Array
): Promise<Uint8Array> => {
  if (input.byteLength > nativeUiFrameLimit) {
    return errorFrame(0, "Native UI request exceeds the frame size limit.");
  }
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
    const response = await dispatchRequest(application, request);
    return response.byteLength <= MAX_FRAME_BYTES
      ? response
      : errorFrame(
          operationFor(request),
          "Native UI response exceeds its size limit."
        );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Native UI request failed.";
    return errorFrame(operationFor(request), message);
  }
};

/** Decode the argument form used by the Native SDK service carrier. */
export const decodeNativeUiArgument = (value: string): Uint8Array | null =>
  decodeHex(value);
