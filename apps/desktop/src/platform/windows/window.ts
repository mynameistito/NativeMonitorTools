/// <reference types="bun-types" />
/* oxlint-disable anti-slop/no-runtime-typeof -- Values cross a native FFI boundary. */

import type { FFIType } from "bun:ffi";

import {
  monitorForRect,
  resolveMonitorSelector,
} from "@native-monitor-tools/core";
import type {
  MonitorId,
  MonitorSelector,
  MonitorSnapshot,
  MonitorTopology,
} from "@native-monitor-tools/core";
import { Cause, Effect, Exit, Result } from "effect";

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const WINDOW_PLACEMENT_SIZE = 44;
const WINDOW_PLACEMENT_NORMAL_RECT_OFFSET = 28;
const SWP_NOACTIVATE = 0x10;
const SWP_NOZORDER = 0x04;
const SET_WINDOW_POSITION_FLAGS = SWP_NOACTIVATE + SWP_NOZORDER;
const MONITOR_DEFAULTTONEAREST = 0x02;
const SW_RESTORE = 0x09;
const WINDOW_HANDLE_REQUIRED_REASON = "A window handle is required";

/** A native Windows pointer as represented by Bun FFI. */
export type WindowsNativePointer = number | bigint;

/** A non-null foreground window handle normalized to a bigint. */
// oxlint-disable-next-line sonarjs/redundant-type-aliases -- The name prevents mixing HWNDs with unrelated bigint values.
export type WindowsWindowHandle = bigint;

/** A normal window rectangle or a position-and-size request in desktop coordinates. */
export interface WindowsWindowRect {
  /** The left desktop coordinate. */
  readonly x: number;
  /** The top desktop coordinate. */
  readonly y: number;
  /** The window width in pixels. */
  readonly width: number;
  /** The window height in pixels. */
  readonly height: number;
}

/** A selected monitor target accepted by the foreground-window move operation. */
export type WindowsWindowMonitorTarget = MonitorSelector | string;

/** A request to move the current foreground window using a fresh topology. */
export interface WindowsForegroundWindowMoveRequest {
  /** The topology captured when the caller selected the target monitor. */
  readonly topology: MonitorTopology;
  /** A monitor ID, DMT selector, or exact monitor name. */
  readonly targetMonitor: WindowsWindowMonitorTarget;
  /** The topology reader used to reject stale placement plans. */
  readonly readTopology: () => Promise<MonitorTopology>;
  /** The current monitor identity used by the `x`/`current` selector. */
  readonly currentMonitorId?: MonitorId;
}

/** The observable result of a foreground-window monitor move. */
export interface WindowsForegroundWindowMoveResult {
  /** The HWND that was checked immediately before mutation. */
  readonly window: WindowsWindowHandle;
  /** The monitor inferred from the window's normal rectangle. */
  readonly sourceMonitorId: MonitorId;
  /** The monitor selected by the request. */
  readonly targetMonitorId: MonitorId;
  /** The bounded normal rectangle submitted to SetWindowPos. */
  readonly rectangle: WindowsWindowRect;
}

/** The operations exposed by the isolated Windows window port. */
export type WindowsWindowOperation =
  | "getForegroundWindow"
  | "getNormalWindowRect"
  | "restoreWindow"
  | "setWindowPosition"
  | "moveForegroundWindow";

/** A typed success, unsupported capability, or native/validation failure. */
export type WindowsWindowResult<T> =
  | { readonly _tag: "Success"; readonly value: T }
  | {
      readonly _tag: "Unsupported";
      readonly operation: WindowsWindowOperation;
      readonly reason: string;
    }
  | {
      readonly _tag: "Error";
      readonly operation: WindowsWindowOperation;
      readonly reason: string;
    };

/** The Win32 RECT representation used to parse a normal window placement. */
export interface WindowsNativeRect {
  /** The native RECT left coordinate. */
  readonly left: number;
  /** The native RECT top coordinate. */
  readonly top: number;
  /** The native RECT right coordinate. */
  readonly right: number;
  /** The native RECT bottom coordinate. */
  readonly bottom: number;
}

/** The small native surface required by the window adapter. */
export interface WindowsWindowNativeApi {
  /** Read the current foreground HWND. */
  readonly getForegroundWindow: () => WindowsNativePointer | null;
  /** Return the monitor nearest to the supplied window. */
  readonly getWindowMonitor?: (
    window: WindowsNativePointer
  ) => WindowsNativePointer | null;
  /** Read the owning process identifier for a window when exclusion is enabled. */
  readonly getWindowProcessId?: (window: WindowsNativePointer) => number;
  /** Fill a caller-owned WINDOWPLACEMENT buffer. */
  readonly getWindowPlacement: (
    window: WindowsNativePointer,
    placement: Uint8Array
  ) => number;
  /** Set a window's position and size without changing activation or z-order. */
  readonly setWindowPos: (
    window: WindowsNativePointer,
    insertAfter: WindowsNativePointer | null,
    x: number,
    y: number,
    width: number,
    height: number,
    flags: number
  ) => number;
  /** Restore a minimized or maximized window to its normal state. */
  readonly showWindow?: (
    window: WindowsNativePointer,
    command: number
  ) => number;
}

/** Optional construction dependencies, including an inert native seam for tests. */
export interface WindowsWindowPortOptions {
  /** Override the runtime platform, primarily for deterministic tests. */
  readonly platform?: string;
  /** Supply native bindings instead of loading Bun FFI. */
  readonly nativeApi?: WindowsWindowNativeApi;
  /** Process identifiers that must never be moved by this port. */
  readonly excludedProcessIds?: readonly number[];
}

/** The foreground-window geometry capability exposed by this module. */
export interface WindowsWindowPort {
  /** Read and normalize the current foreground HWND. */
  readonly getForegroundWindow: () => Promise<
    WindowsWindowResult<WindowsWindowHandle>
  >;
  /** Read the normal-position rectangle for a supplied HWND. */
  readonly getNormalWindowRect: (
    window: WindowsWindowHandle
  ) => Promise<WindowsWindowResult<WindowsWindowRect>>;
  /** Set a supplied HWND's position and size. */
  readonly setWindowPosition: (
    window: WindowsWindowHandle,
    rectangle: WindowsWindowRect
  ) => Promise<WindowsWindowResult<undefined>>;
  /** Restore a window before applying its normal-position snap rectangle. */
  readonly restoreWindow?: (
    window: WindowsWindowHandle
  ) => Promise<WindowsWindowResult<undefined>>;
  /** Move the selected foreground window after topology and HWND rechecks. */
  readonly moveForegroundWindow?: (
    request: WindowsForegroundWindowMoveRequest
  ) => Promise<WindowsWindowResult<WindowsForegroundWindowMoveResult>>;
}

interface WindowsWindowNativeSession {
  readonly api: WindowsWindowNativeApi;
  readonly close: () => void;
}

interface NativeUser32Symbols {
  readonly GetForegroundWindow: () => WindowsNativePointer | null;
  readonly MonitorFromWindow: (
    window: WindowsNativePointer,
    flags: number
  ) => WindowsNativePointer | null;
  readonly GetWindowThreadProcessId: (
    window: WindowsNativePointer,
    processId: WindowsNativePointer
  ) => number;
  readonly GetWindowPlacement: (
    window: WindowsNativePointer,
    placement: WindowsNativePointer
  ) => number;
  readonly SetWindowPos: (
    window: WindowsNativePointer,
    insertAfter: WindowsNativePointer | null,
    x: number,
    y: number,
    width: number,
    height: number,
    flags: number
  ) => number;
  readonly ShowWindow: (
    window: WindowsNativePointer,
    command: number
  ) => number;
}

const success = <T>(value: T): WindowsWindowResult<T> => ({
  _tag: "Success",
  value,
});

const unsupported = <T>(
  operation: WindowsWindowOperation,
  reason: string
): WindowsWindowResult<T> => ({
  _tag: "Unsupported",
  operation,
  reason,
});

const failure = <T>(
  operation: WindowsWindowOperation,
  reason: string
): WindowsWindowResult<T> => ({
  _tag: "Error",
  operation,
  reason,
});

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return "The Windows native call failed";
};

const isNativeInt32 = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= INT32_MIN &&
  value <= INT32_MAX;

const isNativeDimension = (value: unknown): value is number =>
  isNativeInt32(value) && value > 0;

interface WindowGeometryCandidate {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
}

interface NativeRectCandidate {
  readonly left?: unknown;
  readonly top?: unknown;
  readonly right?: unknown;
  readonly bottom?: unknown;
}

const isRecord = (
  value: unknown
): value is WindowGeometryCandidate & NativeRectCandidate =>
  typeof value === "object" && value !== null;

const nativeCallSucceeded = (value: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value !== 0;

const isNullWindowPointer = (value: WindowsNativePointer | null): boolean =>
  value === null || value === 0 || value === 0n;

type NormalizedHandle =
  | { readonly _tag: "Value"; readonly value: WindowsWindowHandle }
  | { readonly _tag: "Null" }
  | { readonly _tag: "Invalid"; readonly reason: string };

const normalizeWindowHandle = (
  value: WindowsNativePointer | null
): NormalizedHandle => {
  if (isNullWindowPointer(value)) {
    return { _tag: "Null" };
  }
  if (typeof value === "bigint" && value > 0n) {
    return { _tag: "Value", value };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return { _tag: "Value", value: BigInt(value) };
  }
  return {
    _tag: "Invalid",
    reason: "Windows returned an invalid window handle",
  };
};

const makeUser32Symbols = (ffiType: typeof FFIType) => ({
  GetForegroundWindow: {
    args: [] as const,
    returns: ffiType.ptr,
  },
  GetWindowPlacement: {
    args: [ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetWindowThreadProcessId: {
    args: [ffiType.ptr, ffiType.ptr] as const,
    returns: ffiType.uint32_t,
  },
  MonitorFromWindow: {
    args: [ffiType.ptr, ffiType.uint32_t] as const,
    returns: ffiType.ptr,
  },
  SetWindowPos: {
    args: [
      ffiType.ptr,
      ffiType.ptr,
      ffiType.int32_t,
      ffiType.int32_t,
      ffiType.int32_t,
      ffiType.int32_t,
      ffiType.uint32_t,
    ] as const,
    returns: ffiType.int32_t,
  },
  ShowWindow: {
    args: [ffiType.ptr, ffiType.int32_t] as const,
    returns: ffiType.int32_t,
  },
});

const loadNativeApi = async (): Promise<WindowsWindowNativeSession> => {
  const ffi = await import("bun:ffi");
  const user32 = ffi.dlopen("user32.dll", makeUser32Symbols(ffi.FFIType));
  // SAFETY: The descriptors above match the handwritten Windows ABI signatures.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Bun's generic symbol type needs the ABI projection here.
  const symbols = user32.symbols as unknown as NativeUser32Symbols;
  return {
    api: {
      getForegroundWindow: () => symbols.GetForegroundWindow(),
      getWindowMonitor: (window) =>
        symbols.MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST),
      getWindowPlacement: (window, placement) =>
        symbols.GetWindowPlacement(window, ffi.ptr(placement)),
      getWindowProcessId: (window) => {
        const processId = new Uint32Array(1);
        if (
          symbols.GetWindowThreadProcessId(window, ffi.ptr(processId)) === 0
        ) {
          return 0;
        }
        return processId[0] ?? 0;
      },
      setWindowPos: (window, insertAfter, x, y, width, height, flags) =>
        symbols.SetWindowPos(window, insertAfter, x, y, width, height, flags),
      showWindow: (window, command) => symbols.ShowWindow(window, command),
    },
    close: () => user32.close(),
  };
};

const runWithNativeApi = async <T>(
  operation: WindowsWindowOperation,
  nativeApi: WindowsWindowNativeApi | undefined,
  action: (api: WindowsWindowNativeApi) => WindowsWindowResult<T>
): Promise<WindowsWindowResult<T>> => {
  if (nativeApi !== undefined) {
    try {
      return action(nativeApi);
    } catch (error) {
      return failure(operation, describeFailure(error));
    }
  }

  try {
    const session = await loadNativeApi();
    try {
      return action(session.api);
    } finally {
      session.close();
    }
  } catch (error) {
    return failure(operation, describeFailure(error));
  }
};

/**
 * Parse and bound a position-and-size value before it reaches SetWindowPos.
 *
 * @param input - An untrusted rectangle-like value.
 * @returns A typed rectangle or a set-operation error.
 */
export const parseWindowGeometry = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the untrusted input parser at the adapter boundary.
  input: unknown
): WindowsWindowResult<WindowsWindowRect> => {
  if (!isRecord(input)) {
    return failure("setWindowPosition", "Window geometry must be an object");
  }
  if (!isNativeInt32(input.x) || !isNativeInt32(input.y)) {
    return failure(
      "setWindowPosition",
      "Window coordinates must be signed 32-bit integers"
    );
  }
  if (!isNativeDimension(input.width) || !isNativeDimension(input.height)) {
    return failure(
      "setWindowPosition",
      "Window dimensions must be positive signed 32-bit integers"
    );
  }
  return success({
    height: input.height,
    width: input.width,
    x: input.x,
    y: input.y,
  });
};

/**
 * Parse a native RECT into the port's normal-window rectangle shape.
 *
 * @param input - An untrusted Win32 RECT-like value.
 * @returns A typed rectangle or a normal-rectangle error.
 */
export const parseWindowsNativeRect = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the untrusted native RECT parser.
  input: unknown
): WindowsWindowResult<WindowsWindowRect> => {
  if (!isRecord(input)) {
    return failure(
      "getNormalWindowRect",
      "Windows returned an invalid normal window rectangle"
    );
  }
  if (
    !isNativeInt32(input.left) ||
    !isNativeInt32(input.top) ||
    !isNativeInt32(input.right) ||
    !isNativeInt32(input.bottom)
  ) {
    return failure(
      "getNormalWindowRect",
      "Windows returned non-native rectangle coordinates"
    );
  }
  const width = input.right - input.left;
  const height = input.bottom - input.top;
  if (!isNativeDimension(width) || !isNativeDimension(height)) {
    return failure(
      "getNormalWindowRect",
      "Windows returned a rectangle with unsupported dimensions"
    );
  }
  return success({
    height,
    width,
    x: input.left,
    y: input.top,
  });
};

const readNormalWindowRect = (
  placement: Uint8Array
): WindowsWindowResult<WindowsWindowRect> => {
  if (placement.byteLength < WINDOW_PLACEMENT_SIZE) {
    return failure(
      "getNormalWindowRect",
      "The WINDOWPLACEMENT buffer is smaller than the Win32 structure"
    );
  }
  const view = new DataView(
    placement.buffer,
    placement.byteOffset,
    placement.byteLength
  );
  return parseWindowsNativeRect({
    bottom: view.getInt32(WINDOW_PLACEMENT_NORMAL_RECT_OFFSET + 12, true),
    left: view.getInt32(WINDOW_PLACEMENT_NORMAL_RECT_OFFSET, true),
    right: view.getInt32(WINDOW_PLACEMENT_NORMAL_RECT_OFFSET + 8, true),
    top: view.getInt32(WINDOW_PLACEMENT_NORMAL_RECT_OFFSET + 4, true),
  });
};

const unsupportedOffWindows = <T>(
  operation: WindowsWindowOperation
): WindowsWindowResult<T> =>
  unsupported(
    operation,
    "The Windows foreground-window port is unavailable off Windows"
  );

const validateWindowOwner = (
  api: WindowsWindowNativeApi,
  window: WindowsNativePointer,
  excludedProcessIds: ReadonlySet<number>,
  operation: WindowsWindowOperation,
  excludedReason: string
): WindowsWindowResult<undefined> => {
  if (excludedProcessIds.size === 0) {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
    return success(undefined);
  }
  if (api.getWindowProcessId === undefined) {
    return unsupported(
      operation,
      "Window ownership cannot be verified while excluded Native Monitor Tools processes are configured"
    );
  }
  const processId = api.getWindowProcessId(window);
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    return failure(
      operation,
      "Windows did not return a valid owning process identifier"
    );
  }
  if (excludedProcessIds.has(processId)) {
    return unsupported(operation, excludedReason);
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
  return success(undefined);
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
  return { _tag: "Failure", reason: "The window placement plan failed" };
};

const resolveWindowTarget = (
  topology: MonitorTopology,
  target: WindowsWindowMonitorTarget,
  currentMonitorId: MonitorId | undefined
): CoreResult<MonitorSnapshot> => {
  if (typeof target === "string") {
    const directMatch = topology.monitors.find(
      (monitor) => String(monitor.id) === target
    );
    if (directMatch !== undefined) {
      return { _tag: "Success", value: directMatch };
    }
  }
  return runCore(
    resolveMonitorSelector(topology, target, { currentId: currentMonitorId })
  );
};

const rectsMatch = (
  left: WindowsWindowRect | undefined,
  right: WindowsWindowRect | undefined
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
};

const monitorsMatch = (
  expected: MonitorSnapshot,
  actual: MonitorSnapshot
): boolean => {
  if (!rectsMatch(expected.bounds, actual.bounds)) {
    return false;
  }
  if (!rectsMatch(expected.workArea, actual.workArea)) {
    return false;
  }
  if (expected.isPrimary !== actual.isPrimary) {
    return false;
  }
  return (
    expected.mode.width === actual.mode.width &&
    expected.mode.height === actual.mode.height &&
    expected.mode.refreshRate === actual.mode.refreshRate &&
    expected.mode.bitsPerPixel === actual.mode.bitsPerPixel
  );
};

const topologiesMatchForWindowMove = (
  expected: MonitorTopology,
  actual: MonitorTopology
): boolean => {
  if (
    expected.primaryId !== actual.primaryId ||
    expected.monitors.length !== actual.monitors.length
  ) {
    return false;
  }

  return expected.monitors.every((expectedMonitor) => {
    const actualMonitor = actual.monitors.find(
      (monitor) => monitor.id === expectedMonitor.id
    );
    return (
      actualMonitor !== undefined &&
      monitorsMatch(expectedMonitor, actualMonitor)
    );
  });
};

interface ClampedAxis {
  readonly start: number;
  readonly size: number;
}

const clampAxis = (
  start: number,
  size: number,
  areaStart: number,
  areaSize: number
): ClampedAxis => {
  const clampedSize = Math.min(size, areaSize);
  return {
    size: clampedSize,
    start: Math.min(
      Math.max(start, areaStart),
      areaStart + areaSize - clampedSize
    ),
  };
};

const moveRectBetweenMonitors = (
  rectangle: WindowsWindowRect,
  source: MonitorSnapshot,
  target: MonitorSnapshot
): WindowsWindowRect => {
  const sourceArea = source.workArea ?? source.bounds;
  const targetArea = target.workArea ?? target.bounds;
  const horizontal = clampAxis(
    targetArea.x + rectangle.x - sourceArea.x,
    rectangle.width,
    targetArea.x,
    targetArea.width
  );
  const vertical = clampAxis(
    targetArea.y + rectangle.y - sourceArea.y,
    rectangle.height,
    targetArea.y,
    targetArea.height
  );
  return {
    height: vertical.size,
    width: horizontal.size,
    x: horizontal.start,
    y: vertical.start,
  };
};

const reclassifyWindowResult = <T, U>(
  result: WindowsWindowResult<T>,
  operation: WindowsWindowOperation
): WindowsWindowResult<U> => {
  if (result._tag === "Success") {
    return failure(
      operation,
      "The window operation returned an unexpected success result"
    );
  }
  return result._tag === "Unsupported"
    ? unsupported(operation, result.reason)
    : failure(operation, result.reason);
};

/**
 * Create the isolated Windows foreground-window geometry port.
 *
 * Bun FFI is imported and user32.dll is opened only when a Windows operation is
 * executed on the Windows platform. The optional native seam keeps tests from
 * mutating a real window.
 *
 * @param options - Runtime platform and native binding overrides.
 * @returns A typed foreground-window geometry port.
 */
export const createWindowsWindowPort = (
  options: WindowsWindowPortOptions = {}
): WindowsWindowPort => {
  const platform = options.platform ?? process.platform;
  const excludedProcessIds = new Set(
    (options.excludedProcessIds ?? []).filter((value) =>
      Number.isSafeInteger(value)
    )
  );

  const getForegroundWindow = async (): Promise<
    WindowsWindowResult<WindowsWindowHandle>
  > => {
    const operation = "getForegroundWindow" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const result = await runWithNativeApi<WindowsWindowHandle>(
      operation,
      options.nativeApi,
      (api) => {
        const normalized = normalizeWindowHandle(api.getForegroundWindow());
        if (normalized._tag === "Null") {
          return unsupported(
            operation,
            "Windows reported no foreground window"
          );
        }
        if (normalized._tag === "Invalid") {
          return failure(operation, normalized.reason);
        }
        const ownerValidation = validateWindowOwner(
          api,
          normalized.value,
          excludedProcessIds,
          operation,
          "The foreground window belongs to an excluded Native Monitor Tools process"
        );
        if (ownerValidation._tag !== "Success") {
          return ownerValidation;
        }
        if (
          api.getWindowMonitor !== undefined &&
          isNullWindowPointer(api.getWindowMonitor(normalized.value))
        ) {
          return unsupported(
            operation,
            "The foreground window is not associated with a display monitor"
          );
        }
        return success(normalized.value);
      }
    );
    return result;
  };

  const getNormalWindowRect = async (
    window: WindowsWindowHandle
  ): Promise<WindowsWindowResult<WindowsWindowRect>> => {
    const operation = "getNormalWindowRect" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const normalized = normalizeWindowHandle(window);
    if (normalized._tag === "Null") {
      return unsupported(operation, WINDOW_HANDLE_REQUIRED_REASON);
    }
    if (normalized._tag === "Invalid") {
      return failure(operation, normalized.reason);
    }
    const result = await runWithNativeApi<WindowsWindowRect>(
      operation,
      options.nativeApi,
      (api) => {
        const placement = new Uint8Array(WINDOW_PLACEMENT_SIZE);
        new DataView(placement.buffer).setUint32(
          0,
          WINDOW_PLACEMENT_SIZE,
          true
        );
        if (
          !nativeCallSucceeded(
            api.getWindowPlacement(normalized.value, placement)
          )
        ) {
          return failure(operation, "GetWindowPlacement returned FALSE");
        }
        return readNormalWindowRect(placement);
      }
    );
    return result;
  };

  const setWindowPosition = async (
    window: WindowsWindowHandle,
    rectangle: WindowsWindowRect
  ): Promise<WindowsWindowResult<undefined>> => {
    const operation = "setWindowPosition" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const geometry = parseWindowGeometry(rectangle);
    if (geometry._tag !== "Success") {
      return geometry;
    }
    const normalized = normalizeWindowHandle(window);
    if (normalized._tag === "Null") {
      return unsupported(operation, WINDOW_HANDLE_REQUIRED_REASON);
    }
    if (normalized._tag === "Invalid") {
      return failure(operation, normalized.reason);
    }
    const result = await runWithNativeApi<undefined>(
      operation,
      options.nativeApi,
      (api) => {
        const ownerValidation = validateWindowOwner(
          api,
          normalized.value,
          excludedProcessIds,
          operation,
          "The target window belongs to an excluded Native Monitor Tools process"
        );
        if (ownerValidation._tag !== "Success") {
          return ownerValidation;
        }
        const nativeResult = api.setWindowPos(
          normalized.value,
          null,
          geometry.value.x,
          geometry.value.y,
          geometry.value.width,
          geometry.value.height,
          SET_WINDOW_POSITION_FLAGS
        );
        if (!nativeCallSucceeded(nativeResult)) {
          return failure(operation, "SetWindowPos returned FALSE");
        }
        // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
        return success(undefined);
      }
    );
    return result;
  };

  const restoreWindow = async (
    window: WindowsWindowHandle
  ): Promise<WindowsWindowResult<undefined>> => {
    const operation = "restoreWindow" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const normalized = normalizeWindowHandle(window);
    if (normalized._tag === "Null") {
      return unsupported(operation, WINDOW_HANDLE_REQUIRED_REASON);
    }
    if (normalized._tag === "Invalid") {
      return failure(operation, normalized.reason);
    }
    const result = await runWithNativeApi<undefined>(
      operation,
      options.nativeApi,
      (api) => {
        if (api.showWindow === undefined) {
          return unsupported(operation, "ShowWindow is unavailable");
        }
        const ownerValidation = validateWindowOwner(
          api,
          normalized.value,
          excludedProcessIds,
          operation,
          "The target window belongs to an excluded Native Monitor Tools process"
        );
        if (ownerValidation._tag !== "Success") {
          return ownerValidation;
        }
        if (
          !nativeCallSucceeded(api.showWindow(normalized.value, SW_RESTORE))
        ) {
          return failure(operation, "ShowWindow returned FALSE");
        }
        // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
        return success(undefined);
      }
    );
    return result;
  };

  const moveForegroundWindow = async (
    request: WindowsForegroundWindowMoveRequest
  ): Promise<WindowsWindowResult<WindowsForegroundWindowMoveResult>> => {
    const operation = "moveForegroundWindow" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    if (request.topology.monitors.length === 0) {
      return failure(operation, "A window move requires a non-empty topology");
    }

    const selectedTarget = resolveWindowTarget(
      request.topology,
      request.targetMonitor,
      request.currentMonitorId
    );
    if (selectedTarget._tag === "Failure") {
      return failure(operation, selectedTarget.reason);
    }

    const foreground = await getForegroundWindow();
    if (foreground._tag !== "Success") {
      return reclassifyWindowResult(foreground, operation);
    }
    const window = foreground.value;
    const rectangle = await getNormalWindowRect(window);
    if (rectangle._tag !== "Success") {
      return reclassifyWindowResult(rectangle, operation);
    }

    let latestTopology: MonitorTopology;
    try {
      latestTopology = await request.readTopology();
    } catch (error) {
      return failure(operation, describeFailure(error));
    }
    if (!topologiesMatchForWindowMove(request.topology, latestTopology)) {
      return failure(
        operation,
        "The live display topology no longer matches the topology used to select the target"
      );
    }

    const latestTarget = resolveWindowTarget(
      latestTopology,
      request.targetMonitor,
      request.currentMonitorId
    );
    if (latestTarget._tag === "Failure") {
      return failure(operation, latestTarget.reason);
    }
    const source = monitorForRect(latestTopology, rectangle.value);
    const target = latestTarget.value;
    const targetRect = parseWindowGeometry(
      moveRectBetweenMonitors(rectangle.value, source, target)
    );
    if (targetRect._tag !== "Success") {
      return reclassifyWindowResult(targetRect, operation);
    }

    const stableForeground = await getForegroundWindow();
    if (stableForeground._tag !== "Success") {
      return reclassifyWindowResult(stableForeground, operation);
    }
    if (stableForeground.value !== window) {
      return failure(
        operation,
        "The foreground window changed before the move could be applied"
      );
    }

    if (restoreWindow !== undefined) {
      const restored = await restoreWindow(window);
      if (restored._tag !== "Success") {
        return reclassifyWindowResult(restored, operation);
      }
      const postRestoreForeground = await getForegroundWindow();
      if (postRestoreForeground._tag !== "Success") {
        return reclassifyWindowResult(postRestoreForeground, operation);
      }
      if (postRestoreForeground.value !== window) {
        return failure(
          operation,
          "The foreground window changed before the move could be applied"
        );
      }
    }

    const moved = await setWindowPosition(window, targetRect.value);
    if (moved._tag !== "Success") {
      return reclassifyWindowResult(moved, operation);
    }
    return success({
      rectangle: targetRect.value,
      sourceMonitorId: source.id,
      targetMonitorId: target.id,
      window,
    });
  };

  return {
    getForegroundWindow,
    getNormalWindowRect,
    moveForegroundWindow,
    restoreWindow,
    setWindowPosition,
  };
};
