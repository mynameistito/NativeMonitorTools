/// <reference types="bun-types" />
/* oxlint-disable anti-slop/no-runtime-typeof -- Values cross a native FFI boundary. */

import type { FFIType } from "bun:ffi";

import {
  routeCursorPoint,
  routeCursorToNextMonitor as planCursorToNextMonitor,
  routeCursorToPreviousMonitor as planCursorToPreviousMonitor,
  routeCursorToPrimaryMonitor as planCursorToPrimaryMonitor,
} from "@native-monitor-tools/core";
import type {
  CursorRoutingResult,
  MonitorSelector,
  MonitorTopology,
  ResolveMonitorSelectorOptions,
} from "@native-monitor-tools/core";
import { Cause, Effect, Exit, Result } from "effect";

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const POINT_SIZE = 8;
const RECT_SIZE = 16;

/** A bounded virtual-desktop cursor point. */
export interface WindowsCursorPoint {
  /** The signed desktop x coordinate. */
  readonly x: number;
  /** The signed desktop y coordinate. */
  readonly y: number;
}

/** A bounded virtual-desktop rectangle used for cursor clipping. */
export interface WindowsCursorRect {
  /** The signed desktop x coordinate of the left edge. */
  readonly x: number;
  /** The signed desktop y coordinate of the top edge. */
  readonly y: number;
  /** The positive width of the clipping rectangle. */
  readonly width: number;
  /** The positive height of the clipping rectangle. */
  readonly height: number;
}

/** The operations exposed by the isolated Windows cursor port. */
export type WindowsCursorOperation =
  | "getCursorPosition"
  | "setCursorPosition"
  | "routeCursor"
  | "clipCursor"
  | "releaseCursorClip"
  | "lockCursor";

/** A typed success, unsupported capability, or native/validation failure. */
export type WindowsCursorResult<T> =
  | { readonly _tag: "Success"; readonly value: T }
  | {
      readonly _tag: "Unsupported";
      readonly operation: WindowsCursorOperation;
      readonly reason: string;
    }
  | {
      readonly _tag: "Error";
      readonly operation: WindowsCursorOperation;
      readonly reason: string;
    };

/** A lock that must release the process cursor clip when it is no longer needed. */
export interface WindowsCursorLockLease {
  /** Release the clip; repeated calls are idempotent after a successful release. */
  readonly release: () => Promise<WindowsCursorResult<undefined>>;
}

/** The pointer-free native surface used by the Windows cursor adapter tests. */
export interface WindowsCursorNativeApi {
  /** Read the current cursor point, or return null when GetCursorPos fails. */
  readonly getCursorPosition: () => WindowsCursorPoint | null;
  /** Set the current cursor point. */
  readonly setCursorPosition: (x: number, y: number) => number | boolean;
  /** Apply a RECT clip, or pass null to release the process cursor clip. */
  readonly clipCursor: (
    rectangle: WindowsCursorRect | null
  ) => number | boolean;
}

/** Optional platform and native dependencies for a Windows cursor port. */
export interface WindowsCursorPortOptions {
  /** Override the runtime platform, primarily for deterministic tests. */
  readonly platform?: string;
  /** Supply pointer-free native bindings instead of loading Bun FFI. */
  readonly nativeApi?: WindowsCursorNativeApi;
}

/** The bounded cursor capability exposed by this module. */
export interface WindowsCursorPort {
  /** Read the current cursor position in virtual-desktop coordinates. */
  readonly getCursorPosition: () => Promise<
    WindowsCursorResult<WindowsCursorPoint>
  >;
  /** Set the cursor position after validating signed Windows coordinates. */
  readonly setCursorPosition: (
    point: WindowsCursorPoint
  ) => Promise<WindowsCursorResult<undefined>>;
  /** Route the current cursor through the pure DMT cursor plan and execute it. */
  readonly routeCursor: (
    topology: MonitorTopology,
    target: MonitorSelector | string,
    options?: ResolveMonitorSelectorOptions
  ) => Promise<WindowsCursorResult<CursorRoutingResult>>;
  /** Execute a previously computed pure cursor route without recomputing it. */
  readonly executeCursorRoute: (
    plan: CursorRoutingResult
  ) => Promise<WindowsCursorResult<CursorRoutingResult>>;
  /** Route the current cursor to the next monitor in deterministic DMT order. */
  readonly routeCursorToNextMonitor: (
    topology: MonitorTopology
  ) => Promise<WindowsCursorResult<CursorRoutingResult>>;
  /** Route the current cursor to the previous monitor in deterministic DMT order. */
  readonly routeCursorToPreviousMonitor: (
    topology: MonitorTopology
  ) => Promise<WindowsCursorResult<CursorRoutingResult>>;
  /** Route the current cursor to the primary monitor's center pixel. */
  readonly routeCursorToPrimaryMonitor: (
    topology: MonitorTopology
  ) => Promise<WindowsCursorResult<CursorRoutingResult>>;
  /** Apply a bounded process cursor clip. */
  readonly clipCursor: (
    rectangle: WindowsCursorRect
  ) => Promise<WindowsCursorResult<undefined>>;
  /** Release the process cursor clip through ClipCursor(NULL). */
  readonly releaseCursorClip: () => Promise<WindowsCursorResult<undefined>>;
  /** Apply a clip and return a lease with an explicit safe release operation. */
  readonly lockCursor: (
    rectangle: WindowsCursorRect
  ) => Promise<WindowsCursorResult<WindowsCursorLockLease>>;
  /** Run an async operation while guaranteeing a successful cursor-lock release attempt. */
  readonly withCursorLock: <T>(
    rectangle: WindowsCursorRect,
    action: () => Promise<T> | T
  ) => Promise<WindowsCursorResult<T>>;
  /** Alias for getCursorPosition used by native callers. */
  readonly getCursorPos: WindowsCursorPort["getCursorPosition"];
  /** Alias for setCursorPosition used by native callers. */
  readonly setCursorPos: WindowsCursorPort["setCursorPosition"];
  /** Alias for setCursorPosition using DMT move terminology. */
  readonly moveCursor: WindowsCursorPort["setCursorPosition"];
  /** Alias for routeCursor using DMT monitor terminology. */
  readonly routeCursorToMonitor: WindowsCursorPort["routeCursor"];
  /** Alias for releaseCursorClip. */
  readonly unlockCursor: WindowsCursorPort["releaseCursorClip"];
}

interface WindowsCursorNativeSession {
  readonly api: WindowsCursorNativeApi;
  readonly close: () => void;
}

interface NativeUser32Symbols {
  readonly GetCursorPos: (point: WindowsNativePointer) => number;
  readonly SetCursorPos: (x: number, y: number) => number;
  readonly ClipCursor: (rectangle: WindowsNativePointer | null) => number;
}

/** The native pointer type required only by the Bun FFI implementation. */
type WindowsNativePointer = number | bigint;

const success = <T>(value: T): WindowsCursorResult<T> => ({
  _tag: "Success",
  value,
});

const unsupported = <T>(
  operation: WindowsCursorOperation,
  reason: string
): WindowsCursorResult<T> => ({
  _tag: "Unsupported",
  operation,
  reason,
});

const failure = <T>(
  operation: WindowsCursorOperation,
  reason: string
): WindowsCursorResult<T> => ({
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

const nativeCallSucceeded = (value: number | boolean): boolean =>
  typeof value === "boolean" ? value : Number.isFinite(value) && value !== 0;

const isNativeInt32 = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= INT32_MIN &&
  value <= INT32_MAX;

const isNativeDimension = (value: unknown): value is number =>
  isNativeInt32(value) && value > 0;

interface CursorPointCandidate {
  readonly x?: unknown;
  readonly y?: unknown;
}

interface CursorRectCandidate extends CursorPointCandidate {
  readonly width?: unknown;
  readonly height?: unknown;
}

const isRecord = (value: unknown): value is CursorRectCandidate =>
  typeof value === "object" && value !== null;

const cursorPointError = (
  operation: "getCursorPosition" | "setCursorPosition",
  reason: string
): WindowsCursorResult<WindowsCursorPoint> => failure(operation, reason);

/** Parse a cursor point into the signed integer range accepted by Win32. */
export const parseCursorPoint = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an FFI/input boundary parser.
  input: unknown,
  operation: "getCursorPosition" | "setCursorPosition" = "setCursorPosition"
): WindowsCursorResult<WindowsCursorPoint> => {
  if (!isRecord(input)) {
    return cursorPointError(operation, "Cursor position must be an object");
  }
  if (!isNativeInt32(input.x) || !isNativeInt32(input.y)) {
    return cursorPointError(
      operation,
      "Cursor coordinates must be signed 32-bit integers"
    );
  }
  return success({ x: input.x, y: input.y });
};

/** Alias for parseCursorPoint using the position terminology of the port. */
export const parseCursorPosition = parseCursorPoint;

/** Parse a cursor clip rectangle and prove that both RECT endpoints fit Win32. */
export const parseCursorClipRect = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an FFI/input boundary parser.
  input: unknown
): WindowsCursorResult<WindowsCursorRect> => {
  if (!isRecord(input)) {
    return failure("clipCursor", "Cursor clip geometry must be an object");
  }
  if (
    !isNativeInt32(input.x) ||
    !isNativeInt32(input.y) ||
    !isNativeDimension(input.width) ||
    !isNativeDimension(input.height)
  ) {
    return failure(
      "clipCursor",
      "Cursor clip coordinates must be signed 32-bit integers with positive dimensions"
    );
  }
  const right = input.x + input.width;
  const bottom = input.y + input.height;
  if (!isNativeInt32(right) || !isNativeInt32(bottom)) {
    return failure(
      "clipCursor",
      "Cursor clip RECT endpoints must fit signed 32-bit Windows coordinates"
    );
  }
  return success({
    height: input.height,
    width: input.width,
    x: input.x,
    y: input.y,
  });
};

const makeUser32Symbols = (ffiType: typeof FFIType) => ({
  ClipCursor: {
    args: [ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  GetCursorPos: {
    args: [ffiType.ptr] as const,
    returns: ffiType.int32_t,
  },
  SetCursorPos: {
    args: [ffiType.int32_t, ffiType.int32_t] as const,
    returns: ffiType.int32_t,
  },
});

const loadNativeApi = async (): Promise<WindowsCursorNativeSession> => {
  const ffi = await import("bun:ffi");
  const user32 = ffi.dlopen("user32.dll", makeUser32Symbols(ffi.FFIType));
  // SAFETY: The descriptors above match the handwritten Windows ABI signatures.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Bun's generic symbol type needs the ABI projection here.
  const symbols = user32.symbols as unknown as NativeUser32Symbols;
  return {
    api: {
      clipCursor: (rectangle) => {
        if (rectangle === null) {
          return symbols.ClipCursor(null);
        }
        const buffer = new Uint8Array(RECT_SIZE);
        const view = new DataView(buffer.buffer);
        view.setInt32(0, rectangle.x, true);
        view.setInt32(4, rectangle.y, true);
        view.setInt32(8, rectangle.x + rectangle.width, true);
        view.setInt32(12, rectangle.y + rectangle.height, true);
        return symbols.ClipCursor(ffi.ptr(buffer));
      },
      getCursorPosition: () => {
        const buffer = new Uint8Array(POINT_SIZE);
        if (symbols.GetCursorPos(ffi.ptr(buffer)) === 0) {
          return null;
        }
        const view = new DataView(buffer.buffer);
        return {
          x: view.getInt32(0, true),
          y: view.getInt32(4, true),
        };
      },
      setCursorPosition: (x, y) => symbols.SetCursorPos(x, y),
    },
    close: () => user32.close(),
  };
};

const runWithNativeApi = async <T>(
  operation: WindowsCursorOperation,
  nativeApi: WindowsCursorNativeApi | undefined,
  action: (api: WindowsCursorNativeApi) => WindowsCursorResult<T>
): Promise<WindowsCursorResult<T>> => {
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

const unsupportedOffWindows = <T>(
  operation: WindowsCursorOperation
): WindowsCursorResult<T> =>
  unsupported(operation, "The Windows cursor port is unavailable off Windows");

const relabel = <T, U>(
  result: WindowsCursorResult<T>,
  operation: WindowsCursorOperation
): WindowsCursorResult<U> => {
  if (result._tag === "Success") {
    return failure(
      operation,
      "The cursor operation returned an unexpected success result"
    );
  }
  return result._tag === "Unsupported"
    ? unsupported(operation, result.reason)
    : failure(operation, result.reason);
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
  return { _tag: "Failure", reason: "The cursor routing plan failed" };
};

/**
 * Create the isolated Windows cursor port.
 *
 * Bun FFI is loaded only when a Windows operation executes. The optional native
 * seam makes all tests inert and keeps the mutation boundary explicit.
 *
 * @param options - Runtime platform and native binding overrides.
 * @returns A bounded Windows cursor port.
 */
export const createWindowsCursorPort = (
  options: WindowsCursorPortOptions = {}
): WindowsCursorPort => {
  const platform = options.platform ?? process.platform;

  const getCursorPosition = (): Promise<
    WindowsCursorResult<WindowsCursorPoint>
  > => {
    const operation = "getCursorPosition" as const;
    if (platform !== "win32") {
      return Promise.resolve(unsupportedOffWindows(operation));
    }
    return runWithNativeApi<WindowsCursorPoint>(
      operation,
      options.nativeApi,
      (api) => {
        const point = api.getCursorPosition();
        if (point === null) {
          return unsupported(operation, "GetCursorPos returned FALSE");
        }
        return parseCursorPoint(point, operation);
      }
    );
  };

  const setCursorPosition = (
    point: WindowsCursorPoint
  ): Promise<WindowsCursorResult<undefined>> => {
    const operation = "setCursorPosition" as const;
    if (platform !== "win32") {
      return Promise.resolve(unsupportedOffWindows(operation));
    }
    const parsed = parseCursorPoint(point);
    if (parsed._tag !== "Success") {
      return Promise.resolve(parsed);
    }
    return runWithNativeApi<undefined>(operation, options.nativeApi, (api) => {
      if (
        !nativeCallSucceeded(
          api.setCursorPosition(parsed.value.x, parsed.value.y)
        )
      ) {
        return failure(operation, "SetCursorPos returned FALSE");
      }
      // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
      return success(undefined);
    });
  };

  const executeCursorRoute = async (
    plan: CursorRoutingResult
  ): Promise<WindowsCursorResult<CursorRoutingResult>> => {
    const operation = "routeCursor" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const moved = await setCursorPosition(plan.targetPoint);
    if (moved._tag !== "Success") {
      return relabel(moved, operation);
    }
    return success(plan);
  };

  const routeCursor = async (
    topology: MonitorTopology,
    target: MonitorSelector | string,
    selectorOptions: ResolveMonitorSelectorOptions = {}
  ): Promise<WindowsCursorResult<CursorRoutingResult>> => {
    const operation = "routeCursor" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const current = await getCursorPosition();
    if (current._tag !== "Success") {
      return relabel(current, operation);
    }
    const plan = runCore(
      routeCursorPoint(topology, current.value, target, selectorOptions)
    );
    if (plan._tag === "Failure") {
      return failure(operation, plan.reason);
    }
    return executeCursorRoute(plan.value);
  };

  const routeCursorWithPlanner = async (
    topology: MonitorTopology,
    planner: (
      currentTopology: MonitorTopology,
      point: WindowsCursorPoint
    ) => Effect.Effect<CursorRoutingResult, unknown>
  ): Promise<WindowsCursorResult<CursorRoutingResult>> => {
    const operation = "routeCursor" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const current = await getCursorPosition();
    if (current._tag !== "Success") {
      return relabel(current, operation);
    }
    const plan = runCore(planner(topology, current.value));
    if (plan._tag === "Failure") {
      return failure(operation, plan.reason);
    }
    return executeCursorRoute(plan.value);
  };

  const routeCursorToNextMonitor = (
    topology: MonitorTopology
  ): Promise<WindowsCursorResult<CursorRoutingResult>> =>
    routeCursorWithPlanner(topology, planCursorToNextMonitor);

  const routeCursorToPreviousMonitor = (
    topology: MonitorTopology
  ): Promise<WindowsCursorResult<CursorRoutingResult>> =>
    routeCursorWithPlanner(topology, planCursorToPreviousMonitor);

  const routeCursorToPrimaryMonitor = (
    topology: MonitorTopology
  ): Promise<WindowsCursorResult<CursorRoutingResult>> =>
    routeCursorWithPlanner(topology, planCursorToPrimaryMonitor);

  const clipCursor = (
    rectangle: WindowsCursorRect
  ): Promise<WindowsCursorResult<undefined>> => {
    const operation = "clipCursor" as const;
    if (platform !== "win32") {
      return Promise.resolve(unsupportedOffWindows(operation));
    }
    const parsed = parseCursorClipRect(rectangle);
    if (parsed._tag !== "Success") {
      return Promise.resolve(parsed);
    }
    return runWithNativeApi<undefined>(operation, options.nativeApi, (api) => {
      if (!nativeCallSucceeded(api.clipCursor(parsed.value))) {
        return failure(operation, "ClipCursor returned FALSE");
      }
      // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
      return success(undefined);
    });
  };

  const releaseCursorClip = (): Promise<WindowsCursorResult<undefined>> => {
    const operation = "releaseCursorClip" as const;
    if (platform !== "win32") {
      return Promise.resolve(unsupportedOffWindows(operation));
    }
    return runWithNativeApi<undefined>(operation, options.nativeApi, (api) => {
      if (!nativeCallSucceeded(api.clipCursor(null))) {
        return failure(operation, "ClipCursor(NULL) returned FALSE");
      }
      // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
      return success(undefined);
    });
  };

  const lockCursor = async (
    rectangle: WindowsCursorRect
  ): Promise<WindowsCursorResult<WindowsCursorLockLease>> => {
    const operation = "lockCursor" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const clipped = await clipCursor(rectangle);
    if (clipped._tag !== "Success") {
      return relabel(clipped, operation);
    }
    let released = false;
    const release = async (): Promise<WindowsCursorResult<undefined>> => {
      if (released) {
        // oxlint-disable-next-line unicorn/no-useless-undefined -- The success payload is intentionally void.
        return success(undefined);
      }
      const result = await releaseCursorClip();
      if (result._tag === "Success") {
        released = true;
      }
      return result;
    };
    return success({ release });
  };

  const withCursorLock = async <T>(
    rectangle: WindowsCursorRect,
    action: () => Promise<T> | T
  ): Promise<WindowsCursorResult<T>> => {
    const operation = "lockCursor" as const;
    if (platform !== "win32") {
      return unsupportedOffWindows(operation);
    }
    const lock = await lockCursor(rectangle);
    if (lock._tag !== "Success") {
      return relabel(lock, operation);
    }
    let result: WindowsCursorResult<T>;
    try {
      result = success(await action());
    } catch (error) {
      result = failure(operation, describeFailure(error));
    }
    const released = await lock.value.release();
    if (released._tag !== "Success") {
      return relabel(released, operation);
    }
    return result;
  };

  return {
    clipCursor,
    executeCursorRoute,
    getCursorPos: getCursorPosition,
    getCursorPosition,
    lockCursor,
    moveCursor: setCursorPosition,
    releaseCursorClip,
    routeCursor,
    routeCursorToMonitor: routeCursor,
    routeCursorToNextMonitor,
    routeCursorToPreviousMonitor,
    routeCursorToPrimaryMonitor,
    setCursorPos: setCursorPosition,
    setCursorPosition,
    unlockCursor: releaseCursorClip,
    withCursorLock,
  };
};
