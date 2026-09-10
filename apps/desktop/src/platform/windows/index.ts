/// <reference types="bun-types" />
/* oxlint-disable anti-slop/no-runtime-typeof -- Native failures are untrusted FFI boundary values. */

import type { dlopen, FFIType, JSCallback, Pointer, ptr, read } from "bun:ffi";

import type {
  ApplyPlan,
  DisplayProfile,
  DisplayProfileMonitor,
  EdidBaseBlock,
  MonitorId,
  MonitorSnapshot,
  MonitorTopology,
} from "@native-monitor-tools/core";
import {
  displayModesEqual,
  makeDisplayMode,
  makeMonitorSnapshot,
  makeMonitorTopology,
  monitorIdFromIdentity,
  parseEdidBaseBlock,
  rectsEqual,
} from "@native-monitor-tools/core";
import { Cause, Effect, Exit, Result } from "effect";

const DISPLAY_DEVICE_STRING_LENGTH = 128;
const DISPLAY_DEVICE_ID_LENGTH = 128;
const DISPLAY_DEVICE_SIZE = 840;
const DEVMODE_SIZE = 220;
const DEVMODE_DM_SIZE_OFFSET = 68;
const DEVMODE_FIELDS_OFFSET = 72;
const DEVMODE_BITS_PER_PIXEL_OFFSET = 168;
const DEVMODE_WIDTH_OFFSET = 172;
const DEVMODE_HEIGHT_OFFSET = 176;
const DEVMODE_FREQUENCY_OFFSET = 184;
const DEVMODE_POSITION_X_OFFSET = 76;
const DEVMODE_POSITION_Y_OFFSET = 80;
const DM_POSITION = 0x20;
const DM_BITSPERPEL = 262_144;
const DM_PELSWIDTH = 524_288;
const DM_PELSHEIGHT = 1_048_576;
const DM_DISPLAYFREQUENCY = 4_194_304;
const EDD_GET_DEVICE_INTERFACE_NAME = 1;
const CDS_UPDATEREGISTRY = 0x1;
const CDS_SET_PRIMARY = 0x10;
const CDS_NORESET = 268_435_456;
const DISP_CHANGE_SUCCESSFUL = 0;
const DISP_CHANGE_RESTART = 1;
const DISP_CHANGE_FAILED = -1;
const DISP_CHANGE_BADMODE = -2;
const DISP_CHANGE_NOTUPDATED = -3;
const DISP_CHANGE_BADFLAGS = -4;
const DISP_CHANGE_BADPARAM = -5;
const DISP_CHANGE_BADDUALVIEW = -6;
const DISP_CHANGE_INCOMPLETE = -7;
const ENUM_CURRENT_SETTINGS = 0xff_ff_ff_ff;
const MONITORINFOEX_SIZE = 104;
const MONITORINFO_FLAGS_OFFSET = 36;
const MONITORINFO_DEVICE_NAME_OFFSET = 40;
const MONITORINFO_DEVICE_NAME_LENGTH = 32;
const MONITOR_ENUM_PRIMARY = 1;
const GAMMA_CHANNEL_LENGTH = 256;
const GAMMA_RAMP_BYTE_LENGTH = GAMMA_CHANNEL_LENGTH * 3 * 2;
const PHYSICAL_MONITOR_SIZE = 264;
const MAX_PHYSICAL_MONITORS = 64;
const EDID_REGISTRY_MAX_BYTES = 32 * 1024;
const HKEY_LOCAL_MACHINE = 0x80_00_00_02n;
const KEY_READ = 131_097;
const REG_BINARY = 3;
const ERROR_SUCCESS = 0;

type NativePointer = Pointer | bigint;

interface BunFfi {
  readonly ptr: typeof ptr;
  readonly read: typeof read;
}

type NativeCallback = JSCallback;

/** A stable identity exposed by Windows display enumeration. */
export interface WindowsDisplayIdentity {
  /** The logical Windows display name used for mode and GDI calls. */
  readonly deviceName: string;
  /** The identity source used to derive the core monitor ID. */
  readonly source: "pnp-device-id" | "logical-device-name";
  /** The PNP device path when Windows exposes one. */
  readonly devicePath?: string;
}

/** One discovered Windows display and its platform-independent snapshot. */
export interface WindowsDisplay {
  /** The validated core snapshot for this display. */
  readonly snapshot: MonitorSnapshot;
  /** The stable identity material used by the adapter. */
  readonly identity: WindowsDisplayIdentity;
  /** Optional EDID metadata read from the Windows monitor registry. */
  readonly edid?: EdidBaseBlock;
}

/** The result of one single-shot Windows monitor enumeration. */
export interface WindowsDisplayDiscovery {
  /** The validated, deterministically ordered core topology. */
  readonly topology: MonitorTopology;
  /** Display records retaining identity metadata but no native handles. */
  readonly displays: readonly WindowsDisplay[];
}

interface WindowsDisplayDiscoveryWithRecords {
  readonly topology: MonitorTopology;
  readonly displays: readonly WindowsDisplay[];
  readonly recordsById: ReadonlyMap<MonitorId, NativeMonitorRecord>;
}

/** A 256-entry, 16-bit-per-channel display gamma ramp. */
export interface GammaRamp {
  /** Red channel values from 0 through 65535. */
  readonly red: readonly number[];
  /** Green channel values from 0 through 65535. */
  readonly green: readonly number[];
  /** Blue channel values from 0 through 65535. */
  readonly blue: readonly number[];
}

/** An external monitor brightness or contrast capability. */
export type ExternalLevelCapability =
  | {
      readonly _tag: "Supported";
      readonly minimum: number;
      readonly current: number;
      readonly maximum: number;
    }
  | { readonly _tag: "Unsupported"; readonly reason: string };

/** The capabilities reported by the physical-monitor DXVA2 interface. */
export interface BrightnessContrastCapabilities {
  /** VCP brightness support, if the physical monitor exposes it. */
  readonly brightness: ExternalLevelCapability;
  /** VCP contrast support, if the physical monitor exposes it. */
  readonly contrast: ExternalLevelCapability;
}

/** Operations that can produce a platform result. */
export type WindowsPlatformOperation =
  | "discover"
  | "getGammaRamp"
  | "setGammaRamp"
  | "getBrightnessContrastCapabilities"
  | "setBrightness"
  | "setContrast"
  | "applyDisplayPlan";

/** A typed success, unsupported capability, or native-call failure. */
export type WindowsPlatformResult<T> =
  | { readonly _tag: "Success"; readonly value: T }
  | {
      readonly _tag: "Unsupported";
      readonly operation: WindowsPlatformOperation;
      readonly reason: string;
    }
  | {
      readonly _tag: "Error";
      readonly operation: WindowsPlatformOperation;
      readonly reason: string;
    };

/** The narrow desktop port implemented by the Windows adapter. */
export interface WindowsDisplayPort {
  /** Enumerate the current display topology once without retaining native resources. */
  readonly discover: () => Promise<
    WindowsPlatformResult<WindowsDisplayDiscovery>
  >;
  /** Read the current GDI device gamma ramp for one monitor. */
  readonly getGammaRamp: (
    monitorId: MonitorId
  ) => Promise<WindowsPlatformResult<GammaRamp>>;
  /** Replace the GDI device gamma ramp for one monitor. */
  readonly setGammaRamp: (
    monitorId: MonitorId,
    ramp: GammaRamp
  ) => Promise<WindowsPlatformResult<void>>;
  /** Query external brightness and contrast support through DXVA2. */
  readonly getBrightnessContrastCapabilities: (
    monitorId: MonitorId
  ) => Promise<WindowsPlatformResult<BrightnessContrastCapabilities>>;
  /** Set external monitor brightness when DXVA2 exposes that control. */
  readonly setBrightness: (
    monitorId: MonitorId,
    value: number
  ) => Promise<WindowsPlatformResult<void>>;
  /** Set external monitor contrast when DXVA2 exposes that control. */
  readonly setContrast: (
    monitorId: MonitorId,
    value: number
  ) => Promise<WindowsPlatformResult<void>>;
  /** Apply a validated display profile plan through ChangeDisplaySettingsExW. */
  readonly applyDisplayPlan: (
    current: MonitorTopology,
    desired: DisplayProfile,
    plan: ApplyPlan
  ) => Promise<WindowsPlatformResult<void>>;
}

interface NativeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface NativeDisplayRecord {
  readonly hMonitor: NativePointer;
  readonly deviceName: string;
  readonly displayName: string;
  readonly devicePath: string;
  readonly bounds: NativeRect;
  readonly workArea: NativeRect;
  readonly mode: {
    readonly width: number;
    readonly height: number;
    readonly refreshRate: number;
    readonly bitsPerPixel: number;
  };
  readonly isPrimary: boolean;
  readonly edid?: EdidBaseBlock;
}

interface NativeMonitorRecord {
  readonly hMonitor: NativePointer;
  readonly deviceName: string;
  readonly identity: WindowsDisplayIdentity;
  readonly snapshot: MonitorSnapshot;
  readonly edid?: EdidBaseBlock;
}

interface User32Symbols {
  readonly EnumDisplayDevicesW: (
    device: Pointer,
    deviceIndex: number,
    displayDevice: Pointer,
    flags: number
  ) => number;
  readonly EnumDisplayMonitors: (
    deviceContext: Pointer | null,
    clipRect: Pointer | null,
    callback: NativeCallback,
    data: bigint
  ) => number;
  readonly EnumDisplaySettingsW: (
    device: Pointer,
    mode: number,
    devMode: Pointer
  ) => number;
  readonly ChangeDisplaySettingsExW: (
    deviceName: Pointer | null,
    devMode: Pointer | null,
    window: Pointer | null,
    flags: number,
    lParam: Pointer | null
  ) => number;
  readonly GetMonitorInfoW: (
    monitor: NativePointer,
    monitorInfo: Pointer
  ) => number;
}

interface Gdi32Symbols {
  readonly CreateDCW: (
    driver: Pointer,
    device: Pointer,
    output: Pointer | null,
    initData: Pointer | null
  ) => NativePointer | null;
  readonly DeleteDC: (deviceContext: NativePointer) => number;
  readonly GetDeviceGammaRamp: (
    deviceContext: NativePointer,
    ramp: Pointer
  ) => number;
  readonly SetDeviceGammaRamp: (
    deviceContext: NativePointer,
    ramp: Pointer
  ) => number;
}

interface Dxva2Symbols {
  readonly GetNumberOfPhysicalMonitorsFromHMONITOR: (
    hMonitor: NativePointer,
    count: Pointer
  ) => number;
  readonly GetPhysicalMonitorsFromHMONITOR: (
    hMonitor: NativePointer,
    count: number,
    monitors: Pointer
  ) => number;
  readonly DestroyPhysicalMonitors: (
    count: number,
    monitors: Pointer
  ) => number;
  readonly GetMonitorBrightness: (
    monitor: NativePointer,
    minimum: Pointer,
    current: Pointer,
    maximum: Pointer
  ) => number;
  readonly SetMonitorBrightness: (
    monitor: NativePointer,
    value: number
  ) => number;
  readonly GetMonitorContrast: (
    monitor: NativePointer,
    minimum: Pointer,
    current: Pointer,
    maximum: Pointer
  ) => number;
  readonly SetMonitorContrast: (
    monitor: NativePointer,
    value: number
  ) => number;
}

interface RegistrySymbols {
  readonly RegCloseKey: (key: NativePointer) => number;
  readonly RegOpenKeyExW: (
    root: NativePointer,
    subKey: Pointer,
    options: number,
    desiredAccess: number,
    result: Pointer
  ) => number;
  readonly RegQueryValueExW: (
    key: NativePointer,
    valueName: Pointer,
    reserved: Pointer | null,
    valueType: Pointer,
    data: Pointer | null,
    dataSize: Pointer
  ) => number;
}

interface BunFfiModule {
  readonly dlopen: typeof dlopen;
  readonly FFIType: typeof FFIType;
  readonly ptr: typeof ptr;
  readonly read: typeof read;
}

const isWindows = (): boolean => process.platform === "win32";

const success = <T>(value: T): WindowsPlatformResult<T> => ({
  _tag: "Success",
  value,
});

const unsupported = <T>(
  operation: WindowsPlatformOperation,
  reason: string
): WindowsPlatformResult<T> => ({
  _tag: "Unsupported",
  operation,
  reason,
});

const failure = <T>(
  operation: WindowsPlatformOperation,
  reason: string
): WindowsPlatformResult<T> => ({
  _tag: "Error",
  operation,
  reason,
});

const unsupportedOffWindows = <T>(
  operation: WindowsPlatformOperation
): WindowsPlatformResult<T> =>
  unsupported(
    operation,
    "The Windows display adapter is unavailable off Windows"
  );

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  if (typeof cause === "object" && cause !== null && "reason" in cause) {
    const { reason } = cause;
    if (typeof reason === "string" && reason.length > 0) {
      return reason;
    }
  }
  return "The Windows native call failed";
};

type CoreResult<T> =
  | { readonly _tag: "Success"; readonly value: T }
  | { readonly _tag: "Failure"; readonly reason: string };

const runCore = <A, E>(effect: Effect.Effect<A, E>): CoreResult<A> => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return { _tag: "Success", value: exit.value };
  }
  const error = Cause.findError(exit.cause);
  if (Result.isSuccess(error)) {
    return { _tag: "Failure", reason: describeFailure(error.success) };
  }
  return { _tag: "Failure", reason: "The display domain rejected native data" };
};

const readWideString = (
  view: DataView,
  byteOffset: number,
  characterCount: number
): string => {
  let length = 0;
  while (
    length < characterCount &&
    view.getUint16(byteOffset + length * 2, true) !== 0
  ) {
    length += 1;
  }
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCodePoint(
      view.getUint16(byteOffset + index * 2, true)
    );
  }
  return result.trim();
};

const wideString = (value: string): Uint16Array => {
  const result = new Uint16Array(value.length + 1);
  let writeIndex = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0xff_ff) {
      result[writeIndex] = codePoint;
      writeIndex += 1;
      continue;
    }
    const surrogateOffset = codePoint - 0x1_00_00;
    result[writeIndex] = 0xd8_00 + Math.floor(surrogateOffset / 1024);
    result[writeIndex + 1] = 0xdc_00 + (surrogateOffset % 1024);
    writeIndex += 2;
  }
  return result;
};

const pointerIsNull = (value: NativePointer | null): value is null =>
  value === null || value === 0 || value === 0n;

const readRect = (view: DataView, byteOffset: number): NativeRect => {
  const left = view.getInt32(byteOffset, true);
  const top = view.getInt32(byteOffset + 4, true);
  const right = view.getInt32(byteOffset + 8, true);
  const bottom = view.getInt32(byteOffset + 12, true);
  return {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  };
};

const makeUser32Symbols = (ffiType: typeof FFIType) => ({
  ChangeDisplaySettingsExW: {
    args: [
      ffiType.ptr,
      ffiType.ptr,
      ffiType.ptr,
      ffiType.uint32_t,
      ffiType.ptr,
    ] as const,
    returns: ffiType.int32_t,
  },
  EnumDisplayDevicesW: {
    args: [
      ffiType.ptr,
      ffiType.uint32_t,
      ffiType.ptr,
      ffiType.uint32_t,
    ] as const,
    returns: ffiType.int32_t,
  },
  EnumDisplayMonitors: {
    args: [
      ffiType.ptr,
      ffiType.ptr,
      ffiType.function,
      ffiType.int64_t,
    ] as const,
    returns: ffiType.int32_t,
  },
  EnumDisplaySettingsW: {
    args: [ffiType.ptr, ffiType.uint32_t, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetMonitorInfoW: {
    args: [ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
});

const readMonitorInterfacePath = (
  symbols: User32Symbols,
  ffi: BunFfi,
  deviceName: Uint16Array
): string => {
  const displayDevice = new Uint8Array(DISPLAY_DEVICE_SIZE);
  const displayDeviceView = new DataView(displayDevice.buffer);
  displayDeviceView.setUint32(0, DISPLAY_DEVICE_SIZE, true);
  if (
    symbols.EnumDisplayDevicesW(
      ffi.ptr(deviceName),
      0,
      ffi.ptr(displayDevice),
      EDD_GET_DEVICE_INTERFACE_NAME
    ) === 0
  ) {
    return "";
  }
  return readWideString(displayDeviceView, 328, DISPLAY_DEVICE_ID_LENGTH);
};

const makeGdi32Symbols = (ffiType: typeof FFIType) => ({
  CreateDCW: {
    args: [ffiType.ptr, ffiType.ptr, ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.ptr,
  },
  DeleteDC: {
    args: [ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetDeviceGammaRamp: {
    args: [ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  SetDeviceGammaRamp: {
    args: [ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
});

const makeDxva2Symbols = (ffiType: typeof FFIType) => ({
  DestroyPhysicalMonitors: {
    args: [ffiType.uint32_t, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetMonitorBrightness: {
    args: [ffiType.ptr, ffiType.ptr, ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetMonitorContrast: {
    args: [ffiType.ptr, ffiType.ptr, ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetNumberOfPhysicalMonitorsFromHMONITOR: {
    args: [ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetPhysicalMonitorsFromHMONITOR: {
    args: [ffiType.ptr, ffiType.uint32_t, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  SetMonitorBrightness: {
    args: [ffiType.ptr, ffiType.uint32_t] as const,
    returns: ffiType.int32_t,
  },
  SetMonitorContrast: {
    args: [ffiType.ptr, ffiType.uint32_t] as const,
    returns: ffiType.int32_t,
  },
});

const makeRegistrySymbols = (ffiType: typeof FFIType) => ({
  RegCloseKey: {
    args: [ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  RegOpenKeyExW: {
    args: [
      ffiType.ptr,
      ffiType.ptr,
      ffiType.uint32_t,
      ffiType.uint32_t,
      ffiType.ptr,
    ] as const,
    returns: ffiType.int32_t,
  },
  RegQueryValueExW: {
    args: [
      ffiType.ptr,
      ffiType.ptr,
      ffiType.ptr,
      ffiType.ptr,
      ffiType.ptr,
      ffiType.ptr,
    ] as const,
    returns: ffiType.int32_t,
  },
});

const registryPathSegment = (value: string): boolean => {
  if (value.length === 0 || value.length > 256) {
    return false;
  }
  if (value === "." || value === ".." || value.includes("\0")) {
    return false;
  }
  return !value.includes("\\") && !value.includes("/");
};

/** Build the registry subkey used by a Windows monitor interface path. */
export const edidRegistrySubkeyForInterfacePath = (
  devicePath: string
): string | undefined => {
  const parts = devicePath.trim().split("#");
  if (parts.length < 3) {
    return undefined;
  }
  const [prefix, vendorProduct, instance] = parts;
  if (prefix === undefined || prefix.toLocaleUpperCase() !== "\\\\?\\DISPLAY") {
    return undefined;
  }
  if (vendorProduct === undefined || !registryPathSegment(vendorProduct)) {
    return undefined;
  }
  if (instance === undefined || !registryPathSegment(instance)) {
    return undefined;
  }
  return `SYSTEM\\CurrentControlSet\\Enum\\DISPLAY\\${vendorProduct}\\${instance}\\Device Parameters`;
};

const readRegistryEdid = (
  ffi: BunFfiModule,
  devicePath: string
): EdidBaseBlock | undefined => {
  const subKey = edidRegistrySubkeyForInterfacePath(devicePath);
  if (subKey === undefined) {
    return undefined;
  }

  try {
    const advapi32 = ffi.dlopen(
      "advapi32.dll",
      makeRegistrySymbols(ffi.FFIType)
    );
    try {
      // SAFETY: These signatures match the handwritten descriptors immediately above and the Windows registry ABI.
      /* oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Bun's generic descriptor inference cannot express the Windows ABI. */
      const symbols = advapi32.symbols as unknown as RegistrySymbols;
      const keyBuffer = new Uint8Array(8);
      const openResult = symbols.RegOpenKeyExW(
        HKEY_LOCAL_MACHINE,
        ffi.ptr(wideString(subKey)),
        0,
        KEY_READ,
        ffi.ptr(keyBuffer)
      );
      if (openResult !== ERROR_SUCCESS) {
        return undefined;
      }

      const key = ffi.read.u64(ffi.ptr(keyBuffer));
      if (key === 0n) {
        return undefined;
      }
      try {
        const valueName = wideString("EDID");
        const typeBuffer = new Uint8Array(4);
        const sizeBuffer = new Uint8Array(4);
        const sizeResult = symbols.RegQueryValueExW(
          key,
          ffi.ptr(valueName),
          null,
          ffi.ptr(typeBuffer),
          null,
          ffi.ptr(sizeBuffer)
        );
        const valueType = new DataView(typeBuffer.buffer).getUint32(0, true);
        const valueSize = new DataView(sizeBuffer.buffer).getUint32(0, true);
        if (
          sizeResult !== ERROR_SUCCESS ||
          valueType !== REG_BINARY ||
          valueSize < 128 ||
          valueSize > EDID_REGISTRY_MAX_BYTES
        ) {
          return undefined;
        }

        const valueBuffer = new Uint8Array(valueSize);
        const readSizeBuffer = new Uint8Array(sizeBuffer);
        const readResult = symbols.RegQueryValueExW(
          key,
          ffi.ptr(valueName),
          null,
          ffi.ptr(typeBuffer),
          ffi.ptr(valueBuffer),
          ffi.ptr(readSizeBuffer)
        );
        if (readResult !== ERROR_SUCCESS) {
          return undefined;
        }
        const readSize = new DataView(readSizeBuffer.buffer).getUint32(0, true);
        if (readSize < 128 || readSize > valueBuffer.byteLength) {
          return undefined;
        }
        const parsed = runCore(
          parseEdidBaseBlock(valueBuffer.slice(0, readSize))
        );
        return parsed._tag === "Success" ? parsed.value : undefined;
      } finally {
        symbols.RegCloseKey(key);
      }
    } finally {
      advapi32.close();
    }
  } catch {
    return undefined;
  }
};

const readExternalLevel = (
  readLevel: Dxva2Symbols["GetMonitorBrightness"],
  monitor: NativePointer,
  ffi: BunFfi
): ExternalLevelCapability => {
  const minimumBuffer = new Uint8Array(4);
  const currentBuffer = new Uint8Array(4);
  const maximumBuffer = new Uint8Array(4);
  const supported = readLevel(
    monitor,
    ffi.ptr(minimumBuffer),
    ffi.ptr(currentBuffer),
    ffi.ptr(maximumBuffer)
  );
  if (supported === 0) {
    return {
      _tag: "Unsupported",
      reason: "The physical monitor does not expose this VCP control",
    };
  }
  const minimum = new DataView(minimumBuffer.buffer).getUint32(0, true);
  const current = new DataView(currentBuffer.buffer).getUint32(0, true);
  const maximum = new DataView(maximumBuffer.buffer).getUint32(0, true);
  if (minimum > current || current > maximum || maximum > 65_535) {
    return {
      _tag: "Unsupported",
      reason: "The physical monitor returned an invalid VCP range",
    };
  }
  return { _tag: "Supported", current, maximum, minimum };
};

const gammaRampError = (ramp: GammaRamp): string | undefined => {
  const channels: readonly (readonly number[])[] = [
    ramp.red,
    ramp.green,
    ramp.blue,
  ];
  for (const channel of channels) {
    if (channel.length !== GAMMA_CHANNEL_LENGTH) {
      return "Each gamma channel must contain exactly 256 entries";
    }
    for (const value of channel) {
      if (!Number.isInteger(value) || value < 0 || value > 65_535) {
        return "Gamma entries must be integers between 0 and 65535";
      }
    }
  }
  return undefined;
};

const makeGammaRamp = (buffer: Uint8Array): GammaRamp => {
  const values = new Uint16Array(
    buffer.buffer,
    buffer.byteOffset,
    GAMMA_CHANNEL_LENGTH * 3
  );
  return {
    blue: [...values.subarray(GAMMA_CHANNEL_LENGTH * 2)],
    green: [...values.subarray(GAMMA_CHANNEL_LENGTH, GAMMA_CHANNEL_LENGTH * 2)],
    red: [...values.subarray(0, GAMMA_CHANNEL_LENGTH)],
  };
};

const writeGammaRamp = (ramp: GammaRamp): Uint8Array => {
  const buffer = new Uint8Array(GAMMA_RAMP_BYTE_LENGTH);
  const values = new Uint16Array(buffer.buffer);
  values.set(ramp.red, 0);
  values.set(ramp.green, GAMMA_CHANNEL_LENGTH);
  values.set(ramp.blue, GAMMA_CHANNEL_LENGTH * 2);
  return buffer;
};

interface DisplayChangeRequest {
  mode: boolean;
  position: boolean;
  primary: boolean;
}

const collectDisplayChangeRequests = (
  plan: ApplyPlan
): ReadonlyMap<MonitorId, DisplayChangeRequest> => {
  const changes = new Map<MonitorId, DisplayChangeRequest>();
  for (const operation of plan.operations) {
    const current = changes.get(operation.monitorId) ?? {
      mode: false,
      position: false,
      primary: false,
    };
    if (operation._tag === "SetDisplayMode") {
      current.mode = true;
    }
    if (operation._tag === "MoveMonitor") {
      current.position = true;
    }
    if (operation._tag === "SetPrimary") {
      current.position = true;
      current.primary = true;
    }
    changes.set(operation.monitorId, current);
  }
  return changes;
};

/**
 * Compare the live display state needed to safely apply a plan.
 *
 * This remains a pure local helper because the native mutation path has no
 * injectable FFI seam; the comparison itself is therefore kept small and
 * side-effect free rather than adding native integration coverage.
 */
const topologiesMatchForApply = (
  expected: MonitorTopology,
  actual: MonitorTopology
): boolean => {
  if (
    expected.primaryId !== actual.primaryId ||
    expected.monitors.length !== actual.monitors.length
  ) {
    return false;
  }

  const actualById = new Map(
    actual.monitors.map((monitor) => [monitor.id, monitor])
  );
  return expected.monitors.every((expectedMonitor) => {
    const actualMonitor = actualById.get(expectedMonitor.id);
    return (
      actualMonitor !== undefined &&
      rectsEqual(expectedMonitor.bounds, actualMonitor.bounds) &&
      displayModesEqual(expectedMonitor.mode, actualMonitor.mode) &&
      expectedMonitor.isPrimary === actualMonitor.isPrimary
    );
  });
};

const isNativeInt32 = (value: number): boolean =>
  Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647;

const isNativeUint32 = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 4_294_967_295;

const isNativeDisplayMode = (target: DisplayProfileMonitor): boolean => {
  if (!isNativeUint32(target.mode.width)) {
    return false;
  }
  if (!isNativeUint32(target.mode.height)) {
    return false;
  }
  if (!isNativeUint32(target.mode.refreshRate)) {
    return false;
  }
  return (
    target.mode.bitsPerPixel === undefined ||
    isNativeUint32(target.mode.bitsPerPixel)
  );
};

const makeDisplayChangeMode = (
  target: DisplayProfileMonitor,
  change: DisplayChangeRequest
): Uint8Array | string => {
  const positionValid =
    isNativeInt32(target.position.x) && isNativeInt32(target.position.y);
  const modeValid = isNativeDisplayMode(target);
  if (change.position && !positionValid) {
    return "Display positions must fit signed 32-bit Windows coordinates";
  }
  if (change.mode && !modeValid) {
    return "Display modes must use integer values supported by Windows";
  }

  const buffer = new Uint8Array(DEVMODE_SIZE);
  const view = new DataView(buffer.buffer);
  view.setUint16(DEVMODE_DM_SIZE_OFFSET, DEVMODE_SIZE, true);
  let fields = 0;
  if (change.position) {
    fields += DM_POSITION;
    view.setInt32(DEVMODE_POSITION_X_OFFSET, target.position.x, true);
    view.setInt32(DEVMODE_POSITION_Y_OFFSET, target.position.y, true);
  }
  if (change.mode) {
    fields += DM_PELSWIDTH + DM_PELSHEIGHT + DM_DISPLAYFREQUENCY;
    view.setUint32(DEVMODE_WIDTH_OFFSET, target.mode.width, true);
    view.setUint32(DEVMODE_HEIGHT_OFFSET, target.mode.height, true);
    view.setUint32(DEVMODE_FREQUENCY_OFFSET, target.mode.refreshRate, true);
    if (target.mode.bitsPerPixel !== undefined) {
      fields += DM_BITSPERPEL;
      view.setUint32(
        DEVMODE_BITS_PER_PIXEL_OFFSET,
        target.mode.bitsPerPixel,
        true
      );
    }
  }
  view.setUint32(DEVMODE_FIELDS_OFFSET, fields, true);
  return buffer;
};

/** The result classification used for one ChangeDisplaySettingsExW call. */
export type WindowsDisplayChangeOutcome =
  | { readonly _tag: "Applied" }
  | { readonly _tag: "RestartRequired" }
  | { readonly _tag: "Failed"; readonly reason: string };

const displayChangeReason = (code: number): string => {
  switch (code) {
    case DISP_CHANGE_FAILED: {
      return "The display driver failed the requested change";
    }
    case DISP_CHANGE_BADMODE: {
      return "The requested display mode is unsupported";
    }
    case DISP_CHANGE_NOTUPDATED: {
      return "Windows could not update the display settings";
    }
    case DISP_CHANGE_BADFLAGS: {
      return "Windows rejected the display-change flags";
    }
    case DISP_CHANGE_BADPARAM: {
      return "Windows rejected a display-change parameter";
    }
    case DISP_CHANGE_BADDUALVIEW: {
      return "The requested change is incompatible with DualView";
    }
    case DISP_CHANGE_INCOMPLETE: {
      return "The display change was incomplete";
    }
    case DISP_CHANGE_RESTART: {
      return "Windows requires a restart before the display change takes effect";
    }
    default: {
      return `ChangeDisplaySettingsExW returned ${code}`;
    }
  }
};

/**
 * Classify a ChangeDisplaySettingsExW return code without performing a native call.
 *
 * `DISP_CHANGE_RESTART` means Windows stored the settings but cannot apply
 * them dynamically. It is distinct from a native failure, while still being
 * unsafe to report as an applied display plan.
 *
 * @param code - The return code from ChangeDisplaySettingsExW.
 * @returns The typed outcome for the native call.
 */
export const classifyDisplayChangeResult = (
  code: number
): WindowsDisplayChangeOutcome => {
  switch (code) {
    case DISP_CHANGE_SUCCESSFUL: {
      return { _tag: "Applied" };
    }
    case DISP_CHANGE_RESTART: {
      return { _tag: "RestartRequired" };
    }
    default: {
      return { _tag: "Failed", reason: displayChangeReason(code) };
    }
  }
};

const buildDisplay = (
  native: NativeDisplayRecord
): CoreResult<NativeMonitorRecord> => {
  const identity = {
    deviceName: native.deviceName,
    devicePath: native.devicePath,
    source: "pnp-device-id" as const,
  };
  const idResult = runCore(
    monitorIdFromIdentity({ devicePath: native.devicePath })
  );
  if (idResult._tag === "Failure") {
    return idResult;
  }

  const modeInput =
    native.mode.bitsPerPixel > 0
      ? {
          bitsPerPixel: native.mode.bitsPerPixel,
          height: native.mode.height,
          refreshRate: native.mode.refreshRate,
          width: native.mode.width,
        }
      : {
          height: native.mode.height,
          refreshRate: native.mode.refreshRate,
          width: native.mode.width,
        };
  const modeResult = runCore(makeDisplayMode(modeInput));
  if (modeResult._tag === "Failure") {
    return modeResult;
  }
  const snapshotResult = runCore(
    makeMonitorSnapshot({
      bounds: native.bounds,
      id: idResult.value,
      isPrimary: native.isPrimary,
      mode: modeResult.value,
      name: native.edid?.displayName ?? native.displayName,
      workArea: native.workArea,
    })
  );
  if (snapshotResult._tag === "Failure") {
    return snapshotResult;
  }
  const record = {
    deviceName: native.deviceName,
    hMonitor: native.hMonitor,
    identity,
    snapshot: snapshotResult.value,
  };
  if (native.edid !== undefined) {
    return { _tag: "Success", value: { ...record, edid: native.edid } };
  }
  return {
    _tag: "Success",
    value: record,
  };
};

const windowsDisplayFromRecord = (
  record: NativeMonitorRecord
): WindowsDisplay => {
  if (record.edid === undefined) {
    return { identity: record.identity, snapshot: record.snapshot };
  }
  return {
    edid: record.edid,
    identity: record.identity,
    snapshot: record.snapshot,
  };
};

const discoverNative = async (): Promise<
  WindowsPlatformResult<readonly NativeDisplayRecord[]>
> => {
  try {
    const ffi = await import("bun:ffi");
    const user32 = ffi.dlopen("user32.dll", makeUser32Symbols(ffi.FFIType));
    try {
      // SAFETY: These signatures match the handwritten descriptors immediately above and the Windows C ABI.
      /* oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Bun's generic descriptor inference cannot express the Windows ABI. */
      const symbols = user32.symbols as unknown as User32Symbols;
      const monitorHandles: NativePointer[] = [];
      const callback = new ffi.JSCallback(
        (
          monitor: NativePointer | null,
          _deviceContext: NativePointer | null,
          _monitorRect: NativePointer | null,
          _data: number | bigint
        ) => {
          if (!pointerIsNull(monitor)) {
            monitorHandles.push(monitor);
          }
          return 1;
        },
        {
          args: [
            ffi.FFIType.ptr,
            ffi.FFIType.ptr,
            ffi.FFIType.ptr,
            ffi.FFIType.int64_t,
          ] as const,
          returns: ffi.FFIType.int32_t,
        }
      );
      try {
        const enumerated = symbols.EnumDisplayMonitors(
          null,
          null,
          callback,
          0n
        );
        if (enumerated === 0) {
          return failure("discover", "EnumDisplayMonitors returned FALSE");
        }
      } finally {
        callback.close();
      }

      if (monitorHandles.length === 0) {
        return failure("discover", "Windows reported no display monitors");
      }

      const records: NativeDisplayRecord[] = [];
      for (const hMonitor of monitorHandles) {
        const monitorInfo = new Uint8Array(MONITORINFOEX_SIZE);
        const monitorInfoView = new DataView(monitorInfo.buffer);
        monitorInfoView.setUint32(0, MONITORINFOEX_SIZE, true);
        if (symbols.GetMonitorInfoW(hMonitor, ffi.ptr(monitorInfo)) === 0) {
          return failure("discover", "GetMonitorInfoW returned FALSE");
        }

        const deviceName = readWideString(
          monitorInfoView,
          MONITORINFO_DEVICE_NAME_OFFSET,
          MONITORINFO_DEVICE_NAME_LENGTH
        );
        if (deviceName.length === 0) {
          return failure(
            "discover",
            "GetMonitorInfoW returned an empty device name"
          );
        }

        const displayDevice = new Uint8Array(DISPLAY_DEVICE_SIZE);
        const displayDeviceView = new DataView(displayDevice.buffer);
        displayDeviceView.setUint32(0, DISPLAY_DEVICE_SIZE, true);
        const deviceNameBuffer = wideString(deviceName);
        const hasPhysicalIdentity =
          symbols.EnumDisplayDevicesW(
            ffi.ptr(deviceNameBuffer),
            0,
            ffi.ptr(displayDevice),
            0
          ) !== 0;
        const devicePath = hasPhysicalIdentity
          ? readWideString(displayDeviceView, 328, DISPLAY_DEVICE_ID_LENGTH)
          : "";
        if (devicePath.length === 0) {
          return failure(
            "discover",
            `Windows did not expose a stable physical identity for ${deviceName}`
          );
        }
        const physicalDeviceName = hasPhysicalIdentity
          ? readWideString(displayDeviceView, 68, DISPLAY_DEVICE_STRING_LENGTH)
          : "";
        const interfacePath = readMonitorInterfacePath(
          symbols,
          ffi,
          deviceNameBuffer
        );

        const modeBuffer = new Uint8Array(DEVMODE_SIZE);
        const modeView = new DataView(modeBuffer.buffer);
        modeView.setUint16(DEVMODE_DM_SIZE_OFFSET, DEVMODE_SIZE, true);
        if (
          symbols.EnumDisplaySettingsW(
            ffi.ptr(deviceNameBuffer),
            ENUM_CURRENT_SETTINGS,
            ffi.ptr(modeBuffer)
          ) === 0
        ) {
          return failure(
            "discover",
            `EnumDisplaySettingsW returned FALSE for ${deviceName}`
          );
        }

        const bounds = readRect(monitorInfoView, 4);
        const workArea = readRect(monitorInfoView, 20);
        const mode = {
          bitsPerPixel: modeView.getUint32(DEVMODE_BITS_PER_PIXEL_OFFSET, true),
          height: modeView.getUint32(DEVMODE_HEIGHT_OFFSET, true),
          refreshRate: modeView.getUint32(DEVMODE_FREQUENCY_OFFSET, true),
          width: modeView.getUint32(DEVMODE_WIDTH_OFFSET, true),
        };
        const displayName =
          physicalDeviceName.length > 0 ? physicalDeviceName : deviceName;
        const record = {
          bounds,
          deviceName,
          displayName,
          hMonitor,
          isPrimary:
            monitorInfoView.getUint32(MONITORINFO_FLAGS_OFFSET, true) %
              (MONITOR_ENUM_PRIMARY + 1) !==
            0,
          mode,
          workArea,
        };
        records.push({
          ...record,
          devicePath,
          edid:
            interfacePath.length === 0
              ? undefined
              : readRegistryEdid(ffi, interfacePath),
        });
      }
      return success(records);
    } finally {
      user32.close();
    }
  } catch (error) {
    return failure("discover", describeFailure(error));
  }
};

const withPhysicalMonitor = async <T>(
  operation: WindowsPlatformOperation,
  record: NativeMonitorRecord,
  action: (
    symbols: Dxva2Symbols,
    physicalMonitor: NativePointer,
    ffi: BunFfi
  ) => WindowsPlatformResult<T>
): Promise<WindowsPlatformResult<T>> => {
  try {
    const ffi = await import("bun:ffi");
    const dxva2 = ffi.dlopen("dxva2.dll", makeDxva2Symbols(ffi.FFIType));
    try {
      // SAFETY: These signatures match the handwritten descriptors immediately above and the Windows C ABI.
      const symbols = dxva2.symbols as Dxva2Symbols;
      const countBuffer = new Uint8Array(4);
      if (
        symbols.GetNumberOfPhysicalMonitorsFromHMONITOR(
          record.hMonitor,
          ffi.ptr(countBuffer)
        ) === 0
      ) {
        return unsupported(
          operation,
          "DXVA2 could not expose a physical monitor for this display"
        );
      }
      const count = new DataView(countBuffer.buffer).getUint32(0, true);
      if (count === 0) {
        return unsupported(operation, "Windows reported no physical monitors");
      }
      if (count > MAX_PHYSICAL_MONITORS) {
        return failure(
          operation,
          "Windows reported an unsafe physical-monitor count"
        );
      }

      const physicalMonitors = new Uint8Array(count * PHYSICAL_MONITOR_SIZE);
      let acquired = false;
      let result: WindowsPlatformResult<T> = failure(
        operation,
        "DXVA2 physical-monitor operation did not complete"
      );
      try {
        if (
          symbols.GetPhysicalMonitorsFromHMONITOR(
            record.hMonitor,
            count,
            ffi.ptr(physicalMonitors)
          ) === 0
        ) {
          result = unsupported(
            operation,
            "DXVA2 could not acquire a physical-monitor handle"
          );
        } else {
          acquired = true;
          const physicalMonitor = ffi.read.u64(ffi.ptr(physicalMonitors));
          result =
            physicalMonitor === 0n
              ? failure(
                  operation,
                  "DXVA2 returned a null physical-monitor handle"
                )
              : action(symbols, physicalMonitor, ffi);
        }
      } finally {
        if (
          acquired &&
          symbols.DestroyPhysicalMonitors(count, ffi.ptr(physicalMonitors)) ===
            0 &&
          result._tag === "Success"
        ) {
          result = failure(
            operation,
            "DXVA2 failed to destroy the physical-monitor handle"
          );
        }
      }
      return result;
    } finally {
      dxva2.close();
    }
  } catch (error) {
    return failure(operation, describeFailure(error));
  }
};

const findMonitorRecord = async (
  monitorId: MonitorId,
  operation: WindowsPlatformOperation,
  discover: () => Promise<
    WindowsPlatformResult<WindowsDisplayDiscoveryWithRecords>
  >
): Promise<WindowsPlatformResult<NativeMonitorRecord>> => {
  const discovery = await discover();
  if (discovery._tag === "Unsupported") {
    return unsupported(operation, discovery.reason);
  }
  if (discovery._tag === "Error") {
    return failure(operation, discovery.reason);
  }
  const record = discovery.value.recordsById.get(monitorId);
  if (record === undefined) {
    return failure(
      operation,
      "The requested monitor is not in the current topology"
    );
  }
  return success(record);
};

/**
 * Create a direct Bun FFI Windows display adapter.
 *
 * Native libraries are loaded only when an operation runs on Windows. The
 * adapter retains no HDC, physical-monitor handle, callback, FFI buffer, or
 * ID-to-device lookup across operations. Each discovery-dependent operation
 * keeps its own discovery context until that operation completes.
 *
 * @returns A typed port for discovery, gamma, brightness, and contrast operations.
 */
export const createWindowsDisplayPort = (): WindowsDisplayPort => {
  const discoverWithRecords = async (): Promise<
    WindowsPlatformResult<WindowsDisplayDiscoveryWithRecords>
  > => {
    if (!isWindows()) {
      return unsupportedOffWindows("discover");
    }
    const nativeResult = await discoverNative();
    if (nativeResult._tag === "Unsupported") {
      return nativeResult;
    }
    if (nativeResult._tag === "Error") {
      return nativeResult;
    }

    const records: NativeMonitorRecord[] = [];
    for (const native of nativeResult.value) {
      const display = buildDisplay(native);
      if (display._tag === "Failure") {
        return failure("discover", display.reason);
      }
      records.push(display.value);
    }
    const topologyResult = runCore(
      makeMonitorTopology(records.map((record) => record.snapshot))
    );
    if (topologyResult._tag === "Failure") {
      return failure("discover", topologyResult.reason);
    }

    return success({
      displays: records.map(windowsDisplayFromRecord),
      recordsById: new Map(
        records.map((record) => [record.snapshot.id, record])
      ),
      topology: topologyResult.value,
    });
  };

  const discover = async (): Promise<
    WindowsPlatformResult<WindowsDisplayDiscovery>
  > => {
    const result = await discoverWithRecords();
    if (result._tag === "Unsupported") {
      return result;
    }
    if (result._tag === "Error") {
      return result;
    }
    return success({
      displays: result.value.displays,
      topology: result.value.topology,
    });
  };

  const getGammaRamp = async (
    monitorId: MonitorId
  ): Promise<WindowsPlatformResult<GammaRamp>> => {
    const operation = "getGammaRamp" as const;
    if (!isWindows()) {
      return unsupportedOffWindows(operation);
    }
    const recordResult = await findMonitorRecord(
      monitorId,
      operation,
      discoverWithRecords
    );
    if (recordResult._tag !== "Success") {
      return recordResult;
    }
    try {
      const ffi = await import("bun:ffi");
      const gdi32 = ffi.dlopen("gdi32.dll", makeGdi32Symbols(ffi.FFIType));
      try {
        // SAFETY: These signatures match the handwritten descriptors immediately above and the Windows C ABI.
        const symbols = gdi32.symbols as Gdi32Symbols;
        const driverName = wideString("DISPLAY");
        const deviceName = wideString(recordResult.value.deviceName);
        const deviceContext = symbols.CreateDCW(
          ffi.ptr(driverName),
          ffi.ptr(deviceName),
          null,
          null
        );
        if (pointerIsNull(deviceContext)) {
          return failure(
            operation,
            "CreateDCW returned a null display context"
          );
        }
        try {
          const rampBuffer = new Uint8Array(GAMMA_RAMP_BYTE_LENGTH);
          if (
            symbols.GetDeviceGammaRamp(deviceContext, ffi.ptr(rampBuffer)) === 0
          ) {
            return unsupported(
              operation,
              "The display driver does not expose a gamma ramp"
            );
          }
          return success(makeGammaRamp(rampBuffer));
        } finally {
          symbols.DeleteDC(deviceContext);
        }
      } finally {
        gdi32.close();
      }
    } catch (error) {
      return failure(operation, describeFailure(error));
    }
  };

  const setGammaRamp = async (
    monitorId: MonitorId,
    ramp: GammaRamp
  ): Promise<WindowsPlatformResult<void>> => {
    const operation = "setGammaRamp" as const;
    if (!isWindows()) {
      return unsupportedOffWindows(operation);
    }
    const rampError = gammaRampError(ramp);
    if (rampError !== undefined) {
      return failure(operation, rampError);
    }
    const recordResult = await findMonitorRecord(
      monitorId,
      operation,
      discoverWithRecords
    );
    if (recordResult._tag !== "Success") {
      return recordResult;
    }
    try {
      const ffi = await import("bun:ffi");
      const gdi32 = ffi.dlopen("gdi32.dll", makeGdi32Symbols(ffi.FFIType));
      try {
        // SAFETY: These signatures match the handwritten descriptors immediately above and the Windows C ABI.
        const symbols = gdi32.symbols as Gdi32Symbols;
        const driverName = wideString("DISPLAY");
        const deviceName = wideString(recordResult.value.deviceName);
        const deviceContext = symbols.CreateDCW(
          ffi.ptr(driverName),
          ffi.ptr(deviceName),
          null,
          null
        );
        if (pointerIsNull(deviceContext)) {
          return failure(
            operation,
            "CreateDCW returned a null display context"
          );
        }
        try {
          const rampBuffer = writeGammaRamp(ramp);
          if (
            symbols.SetDeviceGammaRamp(deviceContext, ffi.ptr(rampBuffer)) === 0
          ) {
            return unsupported(
              operation,
              "The display driver rejected gamma-ramp writes"
            );
          }
          // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
          return success(undefined);
        } finally {
          symbols.DeleteDC(deviceContext);
        }
      } finally {
        gdi32.close();
      }
    } catch (error) {
      return failure(operation, describeFailure(error));
    }
  };

  const getBrightnessContrastCapabilities = async (
    monitorId: MonitorId
  ): Promise<WindowsPlatformResult<BrightnessContrastCapabilities>> => {
    const operation = "getBrightnessContrastCapabilities" as const;
    if (!isWindows()) {
      return unsupportedOffWindows(operation);
    }
    const recordResult = await findMonitorRecord(
      monitorId,
      operation,
      discoverWithRecords
    );
    if (recordResult._tag !== "Success") {
      return recordResult;
    }
    return withPhysicalMonitor(
      operation,
      recordResult.value,
      (symbols, physicalMonitor, ffi) => ({
        _tag: "Success",
        value: {
          brightness: readExternalLevel(
            symbols.GetMonitorBrightness,
            physicalMonitor,
            ffi
          ),
          contrast: readExternalLevel(
            symbols.GetMonitorContrast,
            physicalMonitor,
            ffi
          ),
        },
      })
    );
  };

  const setExternalLevel = async (
    monitorId: MonitorId,
    value: number,
    operation: "setBrightness" | "setContrast",
    readLevel: (symbols: Dxva2Symbols) => Dxva2Symbols["GetMonitorBrightness"],
    writeLevel: (symbols: Dxva2Symbols) => Dxva2Symbols["SetMonitorBrightness"]
  ): Promise<WindowsPlatformResult<void>> => {
    if (!isWindows()) {
      return unsupportedOffWindows(operation);
    }
    if (!Number.isInteger(value) || value < 0 || value > 65_535) {
      return failure(
        operation,
        "External brightness and contrast values must be integers from 0 through 65535"
      );
    }
    const recordResult = await findMonitorRecord(
      monitorId,
      operation,
      discoverWithRecords
    );
    if (recordResult._tag !== "Success") {
      return recordResult;
    }
    return withPhysicalMonitor(
      operation,
      recordResult.value,
      (symbols, physicalMonitor, ffi) => {
        const capability = readExternalLevel(
          readLevel(symbols),
          physicalMonitor,
          ffi
        );
        if (capability._tag === "Unsupported") {
          return unsupported(operation, capability.reason);
        }
        if (value < capability.minimum || value > capability.maximum) {
          return failure(
            operation,
            `Requested value is outside the physical monitor range ${capability.minimum}-${capability.maximum}`
          );
        }
        if (writeLevel(symbols)(physicalMonitor, value) === 0) {
          return failure(
            operation,
            "The physical monitor rejected the requested VCP value"
          );
        }
        // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
        return success(undefined);
      }
    );
  };

  const setBrightness = (
    monitorId: MonitorId,
    value: number
  ): Promise<WindowsPlatformResult<void>> =>
    setExternalLevel(
      monitorId,
      value,
      "setBrightness",
      (symbols) => symbols.GetMonitorBrightness,
      (symbols) => symbols.SetMonitorBrightness
    );

  const setContrast = (
    monitorId: MonitorId,
    value: number
  ): Promise<WindowsPlatformResult<void>> =>
    setExternalLevel(
      monitorId,
      value,
      "setContrast",
      (symbols) => symbols.GetMonitorContrast,
      (symbols) => symbols.SetMonitorContrast
    );

  const applyDisplayPlan = async (
    current: MonitorTopology,
    desired: DisplayProfile,
    plan: ApplyPlan
  ): Promise<WindowsPlatformResult<void>> => {
    const operation = "applyDisplayPlan" as const;
    if (!isWindows()) {
      return unsupportedOffWindows(operation);
    }
    if (plan.dryRun) {
      return failure(operation, "A dry-run display plan cannot be applied");
    }
    if (plan.operations.length === 0) {
      // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
      return success(undefined);
    }

    const discovery = await discoverWithRecords();
    if (discovery._tag === "Unsupported") {
      return unsupported(operation, discovery.reason);
    }
    if (discovery._tag === "Error") {
      return failure(operation, discovery.reason);
    }
    if (!topologiesMatchForApply(current, discovery.value.topology)) {
      return failure(
        operation,
        "The live display topology no longer matches the topology used to generate the plan"
      );
    }

    const desiredById = new Map(
      desired.monitors.map((monitor) => [monitor.id, monitor])
    );
    const changes = collectDisplayChangeRequests(plan);
    try {
      const ffi = await import("bun:ffi");
      const user32 = ffi.dlopen("user32.dll", makeUser32Symbols(ffi.FFIType));
      try {
        // SAFETY: These signatures match the handwritten descriptors immediately above and the Windows C ABI.
        const symbols = user32.symbols as User32Symbols;
        let restartRequired = false;
        for (const [monitorId, change] of changes) {
          const record = discovery.value.recordsById.get(monitorId);
          const target = desiredById.get(monitorId);
          if (record === undefined || target === undefined) {
            return failure(
              operation,
              "The display plan references a monitor missing from the current topology"
            );
          }
          const mode = makeDisplayChangeMode(target, change);
          if (typeof mode === "string") {
            return failure(operation, mode);
          }
          const deviceName = wideString(record.deviceName);
          let flags = CDS_UPDATEREGISTRY + CDS_NORESET;
          if (change.primary) {
            flags += CDS_SET_PRIMARY;
          }
          const result = classifyDisplayChangeResult(
            symbols.ChangeDisplaySettingsExW(
              ffi.ptr(deviceName),
              ffi.ptr(mode),
              null,
              flags,
              null
            )
          );
          if (result._tag === "Failed") {
            return failure(operation, result.reason);
          }
          if (result._tag === "RestartRequired") {
            // The settings were staged successfully; finish staging every device before the documented commit call.
            restartRequired = true;
          }
        }

        const commit = classifyDisplayChangeResult(
          symbols.ChangeDisplaySettingsExW(null, null, null, 0, null)
        );
        if (commit._tag === "Failed") {
          return failure(operation, commit.reason);
        }
        if (restartRequired || commit._tag === "RestartRequired") {
          return failure(operation, displayChangeReason(DISP_CHANGE_RESTART));
        }
        // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
        return success(undefined);
      } finally {
        user32.close();
      }
    } catch (error) {
      return failure(operation, describeFailure(error));
    }
  };

  return {
    applyDisplayPlan,
    discover,
    getBrightnessContrastCapabilities,
    getGammaRamp,
    setBrightness,
    setContrast,
    setGammaRamp,
  };
};
