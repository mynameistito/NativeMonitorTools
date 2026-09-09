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
  | { readonly kind: "profile_applied"; readonly payload: Bytes }
  | { readonly kind: "profile_apply_failed"; readonly reason: Bytes }
  | { readonly kind: "open_app" }
  | { readonly kind: "quit_app" };

const IPC_PROTOCOL_VERSION = 1;
const DISPLAY_FRAME_KIND = 1;
const PROFILE_FRAME_KIND = 2;
const APPLY_FRAME_KIND = 3;
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

function hasColorSupport(displays: readonly MonitorCard[]): boolean {
  for (const display of displays) {
    if (display.colorSupported) {
      return true;
    }
  }
  return false;
}

function hasWindowToolsSupport(displays: readonly MonitorCard[]): boolean {
  for (const display of displays) {
    if (display.windowToolsSupported) {
      return true;
    }
  }
  return false;
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
      return { ...model, section: "window_tools" };
    }
    case "show_settings": {
      return { ...model, section: "settings" };
    }
    case "refresh": {
      return [
        {
          ...model,
          displayStatus: "loading",
          profileStatus: "loading",
          ipcState: "connecting",
          lastError: EMPTY_BYTES,
        },
        Cmd.batch([
          backendRequest(encodeBackendRequest(1, EMPTY_BYTES), {
            key: "ipc.displays",
            ok: "backend_completed",
            err: "backend_failed",
          }),
          backendRequest(encodeBackendRequest(2, EMPTY_BYTES), {
            key: "ipc.profiles",
            ok: "backend_completed",
            err: "backend_failed",
          }),
        ]),
      ];
    }
    case "select_profile": {
      return withPreview(model, findProfile(model.profiles, msg.id));
    }
    case "apply_profile": {
      if (model.selectedProfileId.length === 0 || model.applyingProfile)
        return model;
      return [
        {
          ...model,
          applyingProfile: true,
          applyStatus: "loading",
          lastError: EMPTY_BYTES,
        },
        backendRequest(encodeBackendRequest(3, model.selectedProfileId), {
          key: "ipc.profiles.apply",
          ok: "backend_completed",
          err: "backend_failed",
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
      }
      const displays = decodeDisplayFrame(msg.result);
      if (displays !== null) {
        return update(model, { kind: "displays_loaded", payload: msg.result });
      }
      const profiles = decodeProfileFrame(msg.result);
      if (profiles !== null) {
        return update(model, { kind: "profiles_loaded", payload: msg.result });
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
        applyStatus: "failed",
        displayStatus: "failed",
        ipcState: "failed",
        lastError: asciiBytes("The backend returned an invalid IPC v1 frame."),
        profileStatus: "failed",
      };
    }
    case "backend_failed": {
      return {
        ...model,
        displayStatus: "failed",
        profileStatus: "failed",
        applyStatus: "failed",
        ipcState: "failed",
        lastError: msg.reason,
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
      return {
        ...model,
        capabilities: {
          ...model.capabilities,
          color: hasColorSupport(displays),
          displays: true,
          windowTools: hasWindowToolsSupport(displays),
        },
        displayStatus: displays.length === 0 ? "empty" : "ready",
        displays,
        ipcState: "ready",
        lastError: EMPTY_BYTES,
      };
    }
    case "displays_failed": {
      return {
        ...model,
        displayStatus: "failed",
        ipcState: "failed",
        lastError: msg.reason,
        capabilities: {
          ...model.capabilities,
          displays: false,
          color: false,
          windowTools: false,
        },
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
        profileStatus: "failed",
        ipcState: "failed",
        lastError: msg.reason,
        capabilities: { ...model.capabilities, profiles: false },
      };
    }
    case "profile_applied": {
      return {
        ...model,
        applyingProfile: false,
        applyStatus: "ready",
        lastError: EMPTY_BYTES,
      };
    }
    case "profile_apply_failed": {
      return {
        ...model,
        applyingProfile: false,
        applyStatus: "failed",
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
        id: 1,
        label: asciiBytes("Open Native Monitor Tools"),
        command: asciiBytes("app.open"),
        separator: false,
        enabled: true,
        detail: EMPTY_BYTES,
        role: "command",
        key: EMPTY_BYTES,
        modifiers: NO_MODIFIERS,
      },
      {
        id: 2,
        label: asciiBytes("Refresh"),
        command: asciiBytes("app.refresh"),
        separator: false,
        enabled: true,
        detail: EMPTY_BYTES,
        role: "command",
        key: asciiBytes("r"),
        modifiers: { ...NO_MODIFIERS, primary: true },
      },
      {
        id: 0,
        label: EMPTY_BYTES,
        command: EMPTY_BYTES,
        separator: true,
        enabled: false,
        detail: EMPTY_BYTES,
        role: "command",
        key: EMPTY_BYTES,
        modifiers: NO_MODIFIERS,
      },
      {
        id: 3,
        label: asciiBytes("Quit"),
        command: asciiBytes("app.quit"),
        separator: false,
        enabled: true,
        detail: EMPTY_BYTES,
        role: "command",
        key: EMPTY_BYTES,
        modifiers: NO_MODIFIERS,
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
