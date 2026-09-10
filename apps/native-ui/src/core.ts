import { Cmd, asciiBytes, utf8Bytes } from "@native-sdk/core";
import type { StatusItemState } from "@native-sdk/core/events";
import { backendRequest } from "@native-sdk/services";

export type Bytes = Uint8Array;
export type Section =
  | "displays"
  | "profiles"
  | "color"
  | "window_tools"
  | "settings";
export type LoadStatus = "idle" | "loading" | "ready" | "empty" | "failed";
export type IpcState = "disconnected" | "connecting" | "ready" | "failed";
export type WindowActionStatus = "idle" | "loading" | "failed";

export interface Capabilities {
  readonly displays: boolean;
  readonly profiles: boolean;
  readonly color: boolean;
  readonly windowTools: boolean;
}

export interface MonitorCard {
  readonly id: Bytes;
  readonly name: Bytes;
  readonly resolution: Bytes;
  readonly position: Bytes;
  readonly primary: boolean;
  readonly colorSupported: boolean;
  readonly windowToolsSupported: boolean;
}

export interface ColorLevelState {
  readonly current: number;
  readonly maximum: number;
  readonly minimum: number;
  readonly reason: Bytes;
  readonly supported: boolean;
}

export interface ColorMonitorCard {
  readonly brightnessCurrent: number;
  readonly brightnessMaximum: number;
  readonly brightnessMinimum: number;
  readonly brightnessReason: Bytes;
  readonly brightnessSupported: boolean;
  readonly contrastCurrent: number;
  readonly contrastMaximum: number;
  readonly contrastMinimum: number;
  readonly contrastReason: Bytes;
  readonly contrastSupported: boolean;
  readonly displayName: Bytes;
  readonly gammaReason: Bytes;
  readonly gammaSupported: boolean;
  readonly id: Bytes;
}

export interface WindowAreaCard {
  readonly areaId: Bytes;
  readonly id: Bytes;
  readonly monitorId: Bytes;
  readonly monitorName: Bytes;
  readonly name: Bytes;
}

export interface ProfilePreview {
  readonly id: Bytes;
  readonly name: Bytes;
  readonly summary: Bytes;
  readonly monitorCount: number;
}

export interface Model {
  readonly section: Section;
  readonly displayStatus: LoadStatus;
  readonly profileStatus: LoadStatus;
  readonly displays: readonly MonitorCard[];
  readonly profiles: readonly ProfilePreview[];
  readonly selectedProfileId: Bytes;
  readonly previewReady: boolean;
  readonly previewName: Bytes;
  readonly previewSummary: Bytes;
  readonly previewMonitorCount: number;
  readonly applyingProfile: boolean;
  readonly applyStatus: LoadStatus;
  readonly capabilities: Capabilities;
  readonly colorStatus: LoadStatus;
  readonly colors: readonly ColorMonitorCard[];
  readonly settingColor: boolean;
  readonly windowAreaStatus: LoadStatus;
  readonly windowAreas: readonly WindowAreaCard[];
  readonly selectedWindowAreaId: Bytes;
  readonly snappingWindow: boolean;
  readonly windowActionStatus: WindowActionStatus;
  readonly ipcState: IpcState;
  readonly protocolVersion: number;
  readonly lastError: Bytes;
}

export type Msg =
  | { readonly kind: "show_displays" }
  | { readonly kind: "show_profiles" }
  | { readonly kind: "show_color" }
  | { readonly kind: "show_window_tools" }
  | { readonly kind: "show_settings" }
  | { readonly kind: "refresh" }
  | { readonly kind: "select_profile"; readonly id: Bytes }
  | { readonly kind: "apply_profile" }
  | { readonly kind: "backend_completed"; readonly result: Bytes }
  | { readonly kind: "backend_failed"; readonly reason: Bytes }
  | { readonly kind: "displays_loaded"; readonly payload: Bytes }
  | { readonly kind: "displays_failed"; readonly reason: Bytes }
  | { readonly kind: "profiles_loaded"; readonly payload: Bytes }
  | { readonly kind: "profiles_failed"; readonly reason: Bytes }
  | { readonly kind: "colors_loaded"; readonly payload: Bytes }
  | { readonly kind: "colors_failed"; readonly reason: Bytes }
  | { readonly kind: "profile_applied"; readonly payload: Bytes }
  | { readonly kind: "profile_apply_failed"; readonly reason: Bytes }
  | { readonly kind: "set_color_gamma"; readonly id: Bytes }
  | { readonly kind: "increase_color_brightness"; readonly id: Bytes }
  | { readonly kind: "increase_color_contrast"; readonly id: Bytes }
  | { readonly kind: "color_set_completed"; readonly payload: Bytes }
  | { readonly kind: "color_set_failed"; readonly reason: Bytes }
  | { readonly kind: "window_areas_loaded"; readonly payload: Bytes }
  | { readonly kind: "window_areas_failed"; readonly reason: Bytes }
  | { readonly kind: "select_window_area"; readonly id: Bytes }
  | { readonly kind: "snap_window" }
  | { readonly kind: "window_snap_completed"; readonly payload: Bytes }
  | { readonly kind: "window_snap_failed"; readonly reason: Bytes }
  | { readonly kind: "open_app" }
  | { readonly kind: "quit_app" };

const IPC_PROTOCOL_VERSION = 1;
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
const MAX_IPC_ITEMS = 64;
const EMPTY_BYTES = asciiBytes("");

const NO_MODIFIERS = {
  command: false,
  control: false,
  option: false,
  primary: false,
  shift: false,
};

export const viewUnbound = [
  "displays_loaded",
  "displays_failed",
  "profiles_loaded",
  "profiles_failed",
  "colors_loaded",
  "colors_failed",
  "color_set_completed",
  "color_set_failed",
  "window_areas_loaded",
  "window_areas_failed",
  "window_snap_completed",
  "window_snap_failed",
  "profile_applied",
  "profile_apply_failed",
  "backend_completed",
  "backend_failed",
  "open_app",
  "quit_app",
] as const;

export function initialModel(): Model {
  return {
    applyStatus: "idle",
    applyingProfile: false,
    capabilities: {
      color: false,
      displays: false,
      profiles: false,
      windowTools: false,
    },
    colorStatus: "empty",
    colors: [],
    displayStatus: "empty",
    displays: [],
    ipcState: "disconnected",
    lastError: EMPTY_BYTES,
    previewMonitorCount: 0,
    previewName: EMPTY_BYTES,
    previewReady: false,
    previewSummary: EMPTY_BYTES,
    profileStatus: "empty",
    profiles: [],
    protocolVersion: 1,
    section: "displays",
    selectedProfileId: EMPTY_BYTES,
    selectedWindowAreaId: EMPTY_BYTES,
    settingColor: false,
    snappingWindow: false,
    windowActionStatus: "idle",
    windowAreaStatus: "empty",
    windowAreas: [],
  };
}

export function commandMsg(name: string): Msg | null {
  if (name === "app.open") {
    return { kind: "open_app" };
  }
  if (name === "app.refresh") {
    return { kind: "refresh" };
  }
  if (name === "app.quit") {
    return { kind: "quit_app" };
  }
  return null;
}

export function applyLabel(model: Model): Bytes {
  if (model.applyingProfile) {
    return utf8Bytes("Previewing…");
  }
  return asciiBytes("Preview profile");
}

export function windowSnapLabel(model: Model): Bytes {
  return model.snappingWindow
    ? utf8Bytes("Snapping…")
    : asciiBytes("Snap foreground window");
}

export function statusText(model: Model): Bytes {
  if (model.ipcState === "failed") {
    return model.lastError;
  }
  return asciiBytes("Commands are versioned and capability-aware");
}

interface ReadBytes {
  readonly value: Bytes;
  readonly next: number;
}

function toWhole(value: number): number {
  if (value >= 0) {
    return Math.trunc(value);
  }
  return 0;
}

function readU16(bytes: Bytes, offset: number): number {
  return toWhole((bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 256);
}

function encodeBackendRequest(kind: number, name: Bytes): Bytes {
  return new Uint8Array([
    IPC_PROTOCOL_VERSION,
    kind,
    name.length & 255,
    (name.length >>> 8) & 255,
    ...name,
  ]);
}

function readBytes(bytes: Bytes, offset: number): ReadBytes | null {
  if (offset + 2 > bytes.length) {
    return null;
  }
  const length = readU16(bytes, offset);
  const start = offset + 2;
  const end = start + length;
  if (end > bytes.length) {
    return null;
  }
  return { next: end, value: bytes.slice(start, end) };
}

function decodeDisplayFrame(payload: Bytes): readonly MonitorCard[] | null {
  if (
    payload.length < 4 ||
    payload[0] !== IPC_PROTOCOL_VERSION ||
    payload[1] !== DISPLAY_FRAME_KIND
  ) {
    return null;
  }
  const count = readU16(payload, 2);
  if (count > MAX_IPC_ITEMS) {
    return null;
  }
  let offset = 4;
  const displays: MonitorCard[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = readBytes(payload, offset);
    if (id === null || id.next + 1 > payload.length) {
      return null;
    }
    const primary = (payload[id.next] ?? 0) === 1;
    offset = id.next + 1;
    const name = readBytes(payload, offset);
    if (name === null) {
      return null;
    }
    offset = name.next;
    const resolution = readBytes(payload, offset);
    if (resolution === null) {
      return null;
    }
    offset = resolution.next;
    const position = readBytes(payload, offset);
    if (position === null || position.next + 2 > payload.length) {
      return null;
    }
    offset = position.next;
    const colorSupported = (payload[offset] ?? 0) === 1;
    const windowToolsSupported = (payload[offset + 1] ?? 0) === 1;
    offset += 2;
    displays.push({
      colorSupported,
      id: id.value,
      name: name.value,
      position: position.value,
      primary,
      resolution: resolution.value,
      windowToolsSupported,
    });
  }
  if (offset !== payload.length) {
    return null;
  }
  return displays;
}

function decodeProfileFrame(payload: Bytes): readonly ProfilePreview[] | null {
  if (
    payload.length < 4 ||
    payload[0] !== IPC_PROTOCOL_VERSION ||
    payload[1] !== PROFILE_FRAME_KIND
  ) {
    return null;
  }
  const count = readU16(payload, 2);
  if (count > MAX_IPC_ITEMS) {
    return null;
  }
  let offset = 4;
  const profiles: ProfilePreview[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = readBytes(payload, offset);
    if (id === null) {
      return null;
    }
    offset = id.next;
    const name = readBytes(payload, offset);
    if (name === null) {
      return null;
    }
    offset = name.next;
    const summary = readBytes(payload, offset);
    if (summary === null || summary.next + 2 > payload.length) {
      return null;
    }
    offset = summary.next;
    const monitorCount = readU16(payload, offset);
    if (!(monitorCount >= 0)) {
      return null;
    }
    if (monitorCount > 64) {
      return null;
    }
    const wholeMonitorCount = Math.trunc(monitorCount);
    offset += 2;
    profiles.push({
      id: id.value,
      monitorCount: wholeMonitorCount,
      name: name.value,
      summary: summary.value,
    });
  }
  if (offset !== payload.length) {
    return null;
  }
  return profiles;
}

function readColorLevel(
  payload: Bytes,
  offset: number
): { readonly next: number; readonly value: ColorLevelState } | null {
  if (offset >= payload.length) {
    return null;
  }
  if (payload[offset] === 1) {
    if (offset + 7 > payload.length) {
      return null;
    }
    const minimum = Math.trunc(readU16(payload, offset + 1));
    const current = Math.trunc(readU16(payload, offset + 3));
    const maximum = Math.trunc(readU16(payload, offset + 5));
    if (
      !(minimum >= 0 && minimum <= 65_535) ||
      !(current >= 0 && current <= 65_535) ||
      !(maximum >= 0 && maximum <= 65_535) ||
      minimum > current ||
      current > maximum
    ) {
      return null;
    }
    return {
      next: offset + 7,
      value: {
        current: Math.trunc(current),
        maximum: Math.trunc(maximum),
        minimum: Math.trunc(minimum),
        reason: EMPTY_BYTES,
        supported: true,
      },
    };
  }
  if (payload[offset] !== 0) {
    return null;
  }
  const reason = readBytes(payload, offset + 1);
  return reason === null || reason.value.length === 0
    ? null
    : {
        next: reason.next,
        value: {
          current: 0,
          maximum: 0,
          minimum: 0,
          reason: reason.value,
          supported: false,
        },
      };
}

function decodeColorFrame(payload: Bytes): readonly ColorMonitorCard[] | null {
  if (
    payload.length < 4 ||
    payload[0] !== IPC_PROTOCOL_VERSION ||
    payload[1] !== COLOR_FRAME_KIND
  ) {
    return null;
  }
  const count = readU16(payload, 2);
  if (count > MAX_IPC_ITEMS) {
    return null;
  }
  let offset = 4;
  const colors: ColorMonitorCard[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = readBytes(payload, offset);
    if (id === null || id.value.length === 0) {
      return null;
    }
    offset = id.next;
    const displayName = readBytes(payload, offset);
    if (
      displayName === null ||
      displayName.value.length === 0 ||
      displayName.next + 1 > payload.length
    ) {
      return null;
    }
    offset = displayName.next;
    const gammaSupported = payload[offset] === 1;
    if (payload[offset] !== 0 && !gammaSupported) {
      return null;
    }
    offset += 1;
    let gammaReason = EMPTY_BYTES;
    if (!gammaSupported) {
      const reason = readBytes(payload, offset);
      if (reason === null || reason.value.length === 0) {
        return null;
      }
      gammaReason = reason.value;
      offset = reason.next;
    }
    const brightness = readColorLevel(payload, offset);
    if (brightness === null) {
      return null;
    }
    offset = brightness.next;
    const contrast = readColorLevel(payload, offset);
    if (contrast === null) {
      return null;
    }
    offset = contrast.next;
    const brightnessCurrentValue = brightness.value.current;
    const brightnessMaximumValue = brightness.value.maximum;
    const brightnessMinimumValue = brightness.value.minimum;
    const contrastCurrentValue = contrast.value.current;
    const contrastMaximumValue = contrast.value.maximum;
    const contrastMinimumValue = contrast.value.minimum;
    if (
      !(brightnessCurrentValue >= 0 && brightnessCurrentValue <= 65_535) ||
      !(brightnessMaximumValue >= 0 && brightnessMaximumValue <= 65_535) ||
      !(brightnessMinimumValue >= 0 && brightnessMinimumValue <= 65_535) ||
      !(contrastCurrentValue >= 0 && contrastCurrentValue <= 65_535) ||
      !(contrastMaximumValue >= 0 && contrastMaximumValue <= 65_535) ||
      !(contrastMinimumValue >= 0 && contrastMinimumValue <= 65_535)
    ) {
      return null;
    }
    const brightnessCurrent = Math.trunc(brightnessCurrentValue);
    const brightnessMaximum = Math.trunc(brightnessMaximumValue);
    const brightnessMinimum = Math.trunc(brightnessMinimumValue);
    const contrastCurrent = Math.trunc(contrastCurrentValue);
    const contrastMaximum = Math.trunc(contrastMaximumValue);
    const contrastMinimum = Math.trunc(contrastMinimumValue);
    colors.push({
      brightnessCurrent,
      brightnessMaximum,
      brightnessMinimum,
      brightnessReason: brightness.value.reason,
      brightnessSupported: brightness.value.supported,
      contrastCurrent,
      contrastMaximum,
      contrastMinimum,
      contrastReason: contrast.value.reason,
      contrastSupported: contrast.value.supported,
      displayName: displayName.value,
      gammaReason,
      gammaSupported,
      id: id.value,
    });
  }
  return offset === payload.length ? colors : null;
}

function decodeWindowAreasFrame(
  payload: Bytes
): readonly WindowAreaCard[] | null {
  if (
    payload.length < 4 ||
    payload[0] !== IPC_PROTOCOL_VERSION ||
    payload[1] !== WINDOW_AREAS_FRAME_KIND
  ) {
    return null;
  }
  const count = readU16(payload, 2);
  if (count > MAX_IPC_ITEMS) {
    return null;
  }
  let offset = 4;
  const areas: WindowAreaCard[] = [];
  for (let index = 0; index < count; index += 1) {
    const monitorId = readBytes(payload, offset);
    if (monitorId === null || monitorId.value.length === 0) {
      return null;
    }
    offset = monitorId.next;
    const monitorName = readBytes(payload, offset);
    if (monitorName === null || monitorName.value.length === 0) {
      return null;
    }
    offset = monitorName.next;
    const areaId = readBytes(payload, offset);
    if (areaId === null || areaId.value.length === 0) {
      return null;
    }
    offset = areaId.next;
    const name = readBytes(payload, offset);
    if (name === null || name.value.length === 0) {
      return null;
    }
    offset = name.next;
    areas.push({
      areaId: areaId.value,
      id: asciiBytes(String(index)),
      monitorId: monitorId.value,
      monitorName: monitorName.value,
      name: name.value,
    });
  }
  return offset === payload.length ? areas : null;
}

function decodeWindowSnapFrame(payload: Bytes): boolean {
  return (
    payload.length === 3 &&
    payload[0] === IPC_PROTOCOL_VERSION &&
    payload[1] === WINDOW_SNAP_FRAME_KIND &&
    payload[2] === 0
  );
}

interface ErrorFrame {
  readonly operation: number;
  readonly reason: Bytes;
}

function decodeErrorFrame(payload: Bytes): ErrorFrame | null {
  if (
    payload.length < 5 ||
    payload[0] !== IPC_PROTOCOL_VERSION ||
    payload[1] !== ERROR_FRAME_KIND
  ) {
    return null;
  }
  const reason = readBytes(payload, 3);
  if (reason === null || reason.next !== payload.length) {
    return null;
  }
  return { operation: payload[2] ?? 0, reason: reason.value };
}

function hasWindowToolsSupport(displays: readonly MonitorCard[]): boolean {
  for (const display of displays) {
    if (display.windowToolsSupported) {
      return true;
    }
  }
  return false;
}

function colorHasWritableControl(color: ColorMonitorCard): boolean {
  return (
    color.gammaSupported || color.brightnessSupported || color.contrastSupported
  );
}

function hasColorControlSupport(colors: readonly ColorMonitorCard[]): boolean {
  for (const color of colors) {
    if (colorHasWritableControl(color)) {
      return true;
    }
  }
  return false;
}

function sameBytes(left: Bytes, right: Bytes): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function colorById(
  colors: readonly ColorMonitorCard[],
  id: Bytes
): ColorMonitorCard | null {
  for (const color of colors) {
    if (sameBytes(color.id, id)) {
      return color;
    }
  }
  return null;
}

function colorSupportsDisplay(
  colors: readonly ColorMonitorCard[],
  id: Bytes
): boolean {
  const color = colorById(colors, id);
  return color !== null && colorHasWritableControl(color);
}

function windowAreaById(
  areas: readonly WindowAreaCard[],
  id: Bytes
): WindowAreaCard | null {
  for (const area of areas) {
    if (sameBytes(area.id, id)) {
      return area;
    }
  }
  return null;
}

function withWindowAreas(
  model: Model,
  areas: readonly WindowAreaCard[]
): Model {
  const selected =
    windowAreaById(areas, model.selectedWindowAreaId) ??
    (areas.length > 0 ? (areas[0] ?? null) : null);
  return {
    ...model,
    capabilities: { ...model.capabilities, windowTools: areas.length > 0 },
    ipcState: "ready",
    lastError: EMPTY_BYTES,
    selectedWindowAreaId: selected?.id ?? EMPTY_BYTES,
    snappingWindow: false,
    windowActionStatus: "idle",
    windowAreaStatus: areas.length === 0 ? "empty" : "ready",
    windowAreas: areas,
  };
}

function mergeColorStates(
  existing: readonly ColorMonitorCard[],
  updates: readonly ColorMonitorCard[]
): readonly ColorMonitorCard[] {
  const merged: ColorMonitorCard[] = [...existing];
  for (const update of updates) {
    let replaced = false;
    for (let index = 0; index < merged.length; index += 1) {
      const current = merged[index];
      if (current !== undefined && sameBytes(current.id, update.id)) {
        merged[index] = update;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      merged.push(update);
    }
  }
  return merged;
}

function withColorStates(
  model: Model,
  updates: readonly ColorMonitorCard[],
  replace: boolean
): Model {
  const colors = replace ? updates : mergeColorStates(model.colors, updates);
  const displays = model.displays.map((display) => ({
    ...display,
    colorSupported: colorSupportsDisplay(colors, display.id),
  }));
  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      color: hasColorControlSupport(colors),
      displays: model.capabilities.displays || displays.length > 0,
    },
    colorStatus: colors.length === 0 ? "empty" : "ready",
    colors,
    displays,
    ipcState: "ready",
    lastError: EMPTY_BYTES,
    settingColor: false,
  };
}

function clearDisplayColorSupport(
  displays: readonly MonitorCard[]
): readonly MonitorCard[] {
  return displays.map((display) => ({ ...display, colorSupported: false }));
}

function encodeColorSetRequest(
  id: Bytes,
  control: number,
  value: number
): Bytes {
  const whole = Math.trunc(control === 1 ? value * 100 : value);
  return new Uint8Array([
    IPC_PROTOCOL_VERSION,
    COLOR_SET_OPERATION,
    id.length & 255,
    (id.length >>> 8) & 255,
    ...id,
    control,
    whole & 255,
    (whole >>> 8) & 255,
  ]);
}

function encodeWindowSnapRequest(monitorId: Bytes, areaId: Bytes): Bytes {
  return new Uint8Array([
    IPC_PROTOCOL_VERSION,
    WINDOW_SNAP_OPERATION,
    monitorId.length & 255,
    (monitorId.length >>> 8) & 255,
    ...monitorId,
    areaId.length & 255,
    (areaId.length >>> 8) & 255,
    ...areaId,
  ]);
}

function findProfile(
  profiles: readonly ProfilePreview[],
  id: Bytes
): ProfilePreview | null {
  for (const profile of profiles) {
    if (profile.id.length !== id.length) {
      continue;
    }
    let equal = true;
    for (let index = 0; index < id.length; index += 1) {
      if (profile.id[index] !== id[index]) {
        equal = false;
      }
    }
    if (equal) {
      return profile;
    }
  }
  return null;
}

function withPreview(model: Model, profile: ProfilePreview | null): Model {
  if (profile === null) {
    return {
      ...model,
      previewMonitorCount: 0,
      previewName: EMPTY_BYTES,
      previewReady: false,
      previewSummary: EMPTY_BYTES,
      selectedProfileId: EMPTY_BYTES,
    };
  }
  return {
    ...model,
    previewMonitorCount: profile.monitorCount,
    previewName: profile.name,
    previewReady: true,
    previewSummary: profile.summary,
    selectedProfileId: profile.id,
  };
}

export function update(model: Model, msg: Msg): Model | [Model, Cmd<Msg>] {
  switch (msg.kind) {
    case "show_displays": {
      return { ...model, section: "displays" };
    }
    case "show_profiles": {
      return { ...model, section: "profiles" };
    }
    case "show_color": {
      return { ...model, section: "color" };
    }
    case "show_window_tools": {
      if (model.windowAreaStatus !== "empty") {
        return { ...model, section: "window_tools" };
      }
      return [
        {
          ...model,
          lastError: EMPTY_BYTES,
          section: "window_tools",
          windowAreaStatus: "loading",
        },
        backendRequest(
          encodeBackendRequest(WINDOW_AREAS_OPERATION, EMPTY_BYTES),
          {
            err: "window_areas_failed",
            key: "ipc.window.areas",
            ok: "backend_completed",
          }
        ),
      ];
    }
    case "show_settings": {
      return { ...model, section: "settings" };
    }
    case "refresh": {
      return [
        {
          ...model,
          capabilities: {
            ...model.capabilities,
            color: false,
            windowTools: false,
          },
          colorStatus: "loading",
          colors: model.colors.slice(0, 0),
          displayStatus: "loading",
          displays: clearDisplayColorSupport(model.displays),
          ipcState: "connecting",
          lastError: EMPTY_BYTES,
          profileStatus: "loading",
          selectedWindowAreaId: EMPTY_BYTES,
          settingColor: false,
          snappingWindow: false,
          windowActionStatus: "idle",
          windowAreaStatus: "loading",
          windowAreas: model.windowAreas.slice(0, 0),
        },
        Cmd.batch([
          backendRequest(encodeBackendRequest(1, EMPTY_BYTES), {
            err: "displays_failed",
            key: "ipc.displays",
            ok: "backend_completed",
          }),
          backendRequest(encodeBackendRequest(2, EMPTY_BYTES), {
            err: "profiles_failed",
            key: "ipc.profiles",
            ok: "backend_completed",
          }),
          backendRequest(encodeBackendRequest(4, EMPTY_BYTES), {
            err: "colors_failed",
            key: "ipc.colors",
            ok: "backend_completed",
          }),
          backendRequest(
            encodeBackendRequest(WINDOW_AREAS_OPERATION, EMPTY_BYTES),
            {
              err: "window_areas_failed",
              key: "ipc.window.areas",
              ok: "backend_completed",
            }
          ),
        ]),
      ];
    }
    case "select_profile": {
      return withPreview(model, findProfile(model.profiles, msg.id));
    }
    case "apply_profile": {
      if (model.selectedProfileId.length === 0 || model.applyingProfile) {
        return model;
      }
      return [
        {
          ...model,
          applyStatus: "loading",
          applyingProfile: true,
          lastError: EMPTY_BYTES,
        },
        backendRequest(encodeBackendRequest(3, model.selectedProfileId), {
          err: "profile_apply_failed",
          key: "ipc.profiles.apply",
          ok: "backend_completed",
        }),
      ];
    }
    case "backend_completed": {
      const failure = decodeErrorFrame(msg.result);
      if (failure !== null) {
        if (failure.operation === 1) {
          return update(model, {
            kind: "displays_failed",
            reason: failure.reason,
          });
        }
        if (failure.operation === 2) {
          return update(model, {
            kind: "profiles_failed",
            reason: failure.reason,
          });
        }
        if (failure.operation === 3) {
          return update(model, {
            kind: "profile_apply_failed",
            reason: failure.reason,
          });
        }
        if (failure.operation === 4) {
          return update(model, {
            kind: "colors_failed",
            reason: failure.reason,
          });
        }
        if (failure.operation === WINDOW_AREAS_OPERATION) {
          return update(model, {
            kind: "window_areas_failed",
            reason: failure.reason,
          });
        }
        if (failure.operation === WINDOW_SNAP_OPERATION) {
          return update(model, {
            kind: "window_snap_failed",
            reason: failure.reason,
          });
        }
      }
      const displays = decodeDisplayFrame(msg.result);
      if (displays !== null) {
        return update(model, { kind: "displays_loaded", payload: msg.result });
      }
      const profiles = decodeProfileFrame(msg.result);
      if (profiles !== null) {
        return update(model, { kind: "profiles_loaded", payload: msg.result });
      }
      const colors = decodeColorFrame(msg.result);
      if (colors !== null) {
        return update(model, { kind: "colors_loaded", payload: msg.result });
      }
      const windowAreas = decodeWindowAreasFrame(msg.result);
      if (windowAreas !== null) {
        return update(model, {
          kind: "window_areas_loaded",
          payload: msg.result,
        });
      }
      if (decodeWindowSnapFrame(msg.result)) {
        return update(model, {
          kind: "window_snap_completed",
          payload: msg.result,
        });
      }
      if (
        msg.result.length === 4 &&
        msg.result[0] === IPC_PROTOCOL_VERSION &&
        msg.result[1] === APPLY_FRAME_KIND
      ) {
        return update(model, { kind: "profile_applied", payload: msg.result });
      }
      return {
        ...model,
        ipcState: "failed",
        lastError: asciiBytes("The backend returned an invalid IPC v1 frame."),
        settingColor: false,
      };
    }
    case "backend_failed": {
      return {
        ...model,
        ipcState: "failed",
        lastError: msg.reason,
        settingColor: false,
      };
    }
    case "displays_loaded": {
      const displays = decodeDisplayFrame(msg.payload);
      if (displays === null) {
        return {
          ...model,
          displayStatus: "failed",
          ipcState: "failed",
          lastError: asciiBytes(
            "The display response was not a valid IPC v1 frame."
          ),
        };
      }
      const displaysWithColor = displays.map((display) => ({
        ...display,
        colorSupported: colorSupportsDisplay(model.colors, display.id),
      }));
      return {
        ...model,
        capabilities: {
          ...model.capabilities,
          color: hasColorControlSupport(model.colors),
          displays: true,
          windowTools: hasWindowToolsSupport(displays),
        },
        displayStatus: displays.length === 0 ? "empty" : "ready",
        displays: displaysWithColor,
        ipcState: "ready",
        lastError: EMPTY_BYTES,
      };
    }
    case "displays_failed": {
      return {
        ...model,
        capabilities: {
          ...model.capabilities,
          color: false,
          displays: false,
          windowTools: false,
        },
        displayStatus: "failed",
        ipcState: "failed",
        lastError: msg.reason,
      };
    }
    case "profiles_loaded": {
      const profiles = decodeProfileFrame(msg.payload);
      if (profiles === null) {
        return {
          ...model,
          ipcState: "failed",
          lastError: asciiBytes(
            "The profile response was not a valid IPC v1 frame."
          ),
          profileStatus: "failed",
        };
      }
      const first = profiles.length > 0 ? (profiles[0] ?? null) : null;
      return {
        ...withPreview({ ...model, profiles }, first),
        capabilities: { ...model.capabilities, profiles: true },
        ipcState: "ready",
        lastError: EMPTY_BYTES,
        profileStatus: profiles.length === 0 ? "empty" : "ready",
      };
    }
    case "profiles_failed": {
      return {
        ...model,
        capabilities: { ...model.capabilities, profiles: false },
        ipcState: "failed",
        lastError: msg.reason,
        profileStatus: "failed",
      };
    }
    case "colors_loaded": {
      const colors = decodeColorFrame(msg.payload);
      if (colors === null) {
        return {
          ...model,
          capabilities: { ...model.capabilities, color: false },
          colorStatus: "failed",
          colors: model.colors.slice(0, 0),
          displays: clearDisplayColorSupport(model.displays),
          lastError: asciiBytes(
            "The color response was not a valid IPC v1 frame."
          ),
        };
      }
      return withColorStates(model, colors, true);
    }
    case "colors_failed": {
      return {
        ...model,
        capabilities: { ...model.capabilities, color: false },
        colorStatus: "failed",
        colors: model.colors.slice(0, 0),
        displays: clearDisplayColorSupport(model.displays),
        lastError: msg.reason,
        settingColor: false,
      };
    }
    case "window_areas_loaded": {
      const areas = decodeWindowAreasFrame(msg.payload);
      if (areas === null) {
        return {
          ...model,
          capabilities: { ...model.capabilities, windowTools: false },
          ipcState: "failed",
          lastError: asciiBytes(
            "The window-area response was not a valid IPC v1 frame."
          ),
          windowAreaStatus: "failed",
          windowAreas: model.windowAreas.slice(0, 0),
        };
      }
      return withWindowAreas(model, areas);
    }
    case "window_areas_failed": {
      return {
        ...model,
        capabilities: { ...model.capabilities, windowTools: false },
        ipcState: "failed",
        lastError: msg.reason,
        selectedWindowAreaId: EMPTY_BYTES,
        snappingWindow: false,
        windowActionStatus: "idle",
        windowAreaStatus: "failed",
        windowAreas: model.windowAreas.slice(0, 0),
      };
    }
    case "select_window_area": {
      const area = windowAreaById(model.windowAreas, msg.id);
      return area === null
        ? model
        : {
            ...model,
            lastError: EMPTY_BYTES,
            selectedWindowAreaId: area.id,
            windowActionStatus: "idle",
          };
    }
    case "snap_window": {
      const area = windowAreaById(
        model.windowAreas,
        model.selectedWindowAreaId
      );
      if (
        !model.capabilities.windowTools ||
        model.snappingWindow ||
        area === null
      ) {
        return model;
      }
      return [
        {
          ...model,
          lastError: EMPTY_BYTES,
          snappingWindow: true,
          windowActionStatus: "loading",
        },
        backendRequest(encodeWindowSnapRequest(area.monitorId, area.areaId), {
          err: "window_snap_failed",
          key: "ipc.window.snap",
          ok: "window_snap_completed",
        }),
      ];
    }
    case "window_snap_completed": {
      const failure = decodeErrorFrame(msg.payload);
      if (failure !== null) {
        return update(model, {
          kind: "window_snap_failed",
          reason: failure.reason,
        });
      }
      return decodeWindowSnapFrame(msg.payload)
        ? {
            ...model,
            lastError: EMPTY_BYTES,
            snappingWindow: false,
            windowActionStatus: "idle",
          }
        : {
            ...model,
            lastError: asciiBytes("The window snap response was invalid."),
            snappingWindow: false,
            windowActionStatus: "failed",
          };
    }
    case "window_snap_failed": {
      return {
        ...model,
        lastError: msg.reason,
        snappingWindow: false,
        windowActionStatus: "failed",
      };
    }
    case "set_color_gamma": {
      const color = colorById(model.colors, msg.id);
      if (model.settingColor || color === null || !color.gammaSupported) {
        return model;
      }
      return [
        { ...model, lastError: EMPTY_BYTES, settingColor: true },
        backendRequest(encodeColorSetRequest(msg.id, 1, 1), {
          err: "color_set_failed",
          key: "ipc.color.set",
          ok: "color_set_completed",
        }),
      ];
    }
    case "increase_color_brightness": {
      const color = colorById(model.colors, msg.id);
      if (model.settingColor || color === null || !color.brightnessSupported) {
        return model;
      }
      const value = Math.min(
        color.brightnessMaximum,
        color.brightnessCurrent + 10
      );
      return [
        { ...model, lastError: EMPTY_BYTES, settingColor: true },
        backendRequest(encodeColorSetRequest(msg.id, 2, value), {
          err: "color_set_failed",
          key: "ipc.color.set",
          ok: "color_set_completed",
        }),
      ];
    }
    case "increase_color_contrast": {
      const color = colorById(model.colors, msg.id);
      if (model.settingColor || color === null || !color.contrastSupported) {
        return model;
      }
      const value = Math.min(color.contrastMaximum, color.contrastCurrent + 10);
      return [
        { ...model, lastError: EMPTY_BYTES, settingColor: true },
        backendRequest(encodeColorSetRequest(msg.id, 3, value), {
          err: "color_set_failed",
          key: "ipc.color.set",
          ok: "color_set_completed",
        }),
      ];
    }
    case "color_set_completed": {
      const failure = decodeErrorFrame(msg.payload);
      if (failure !== null) {
        return update(model, {
          kind: "color_set_failed",
          reason: failure.reason,
        });
      }
      const colors = decodeColorFrame(msg.payload);
      return colors === null
        ? update(model, {
            kind: "color_set_failed",
            reason: asciiBytes("The color write response was invalid."),
          })
        : withColorStates(model, colors, false);
    }
    case "color_set_failed": {
      return {
        ...model,
        lastError: msg.reason,
        settingColor: false,
      };
    }
    case "profile_applied": {
      return {
        ...model,
        applyStatus: "ready",
        applyingProfile: false,
        lastError: EMPTY_BYTES,
      };
    }
    case "profile_apply_failed": {
      return {
        ...model,
        applyStatus: "failed",
        applyingProfile: false,
        ipcState: "failed",
        lastError: msg.reason,
      };
    }
    case "open_app": {
      return model;
    }
    case "quit_app": {
      return [model, Cmd.quitApp()];
    }
  }
}

export function statusItem(model: Model): StatusItemState {
  const title =
    model.ipcState === "ready" ? asciiBytes("READY") : asciiBytes("MONITORS");
  return {
    activationCommand: asciiBytes("app.open"),
    alternateActivationCommand: EMPTY_BYTES,
    iconPath: EMPTY_BYTES,
    items: [
      {
        command: asciiBytes("app.open"),
        detail: EMPTY_BYTES,
        enabled: true,
        id: 1,
        key: EMPTY_BYTES,
        label: asciiBytes("Open Native Monitor Tools"),
        modifiers: NO_MODIFIERS,
        role: "command",
        separator: false,
      },
      {
        command: asciiBytes("app.refresh"),
        detail: EMPTY_BYTES,
        enabled: true,
        id: 2,
        key: asciiBytes("r"),
        label: asciiBytes("Refresh"),
        modifiers: { ...NO_MODIFIERS, primary: true },
        role: "command",
        separator: false,
      },
      {
        command: EMPTY_BYTES,
        detail: EMPTY_BYTES,
        enabled: false,
        id: 0,
        key: EMPTY_BYTES,
        label: EMPTY_BYTES,
        modifiers: NO_MODIFIERS,
        role: "command",
        separator: true,
      },
      {
        command: asciiBytes("app.quit"),
        detail: EMPTY_BYTES,
        enabled: true,
        id: 3,
        key: EMPTY_BYTES,
        label: asciiBytes("Quit"),
        modifiers: NO_MODIFIERS,
        role: "command",
        separator: false,
      },
    ],
    openCommand: asciiBytes("app.open"),
    presentation: {
      fontSize: 12,
      fontWeight: "semibold",
      iconOpacity: 1,
      monospaced: true,
      title,
      tone: model.ipcState === "failed" ? "warning" : "normal",
      width: 72,
    },
    tooltip: asciiBytes("Native Monitor Tools"),
  };
}
