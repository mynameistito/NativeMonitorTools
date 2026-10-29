import {
  makeDisplayMode,
  makeMonitorSnapshot,
  makeMonitorTopology,
  monitorIdFromIdentity,
} from "@native-monitor-tools/core";
import type {
  MonitorSnapshot,
  MonitorTopology,
} from "@native-monitor-tools/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type {
  WindowsForegroundWindowMoveRequest,
  WindowsNativePointer,
  WindowsWindowNativeApi,
  WindowsWindowRect,
} from "../window";
import { createWindowsWindowPort } from "../window";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const makeMonitor = (
  id: string,
  name: string,
  x: number,
  width: number,
  isPrimary: boolean
): MonitorSnapshot =>
  run(
    makeMonitorSnapshot({
      bounds: { height: 1080, width, x, y: 0 },
      id: run(monitorIdFromIdentity({ devicePath: id })),
      isPrimary,
      mode: run(makeDisplayMode({ height: 1080, refreshRate: 60, width })),
      name,
      workArea: { height: 1040, width, x, y: 0 },
    })
  );

const makeTopology = (rightX = 1920): MonitorTopology =>
  run(
    makeMonitorTopology([
      makeMonitor("left", "Left", 0, 1920, true),
      makeMonitor("right", "Right", rightX, 1280, false),
    ])
  );

const writePlacement = (
  placement: Uint8Array,
  rectangle: WindowsWindowRect
): void => {
  const view = new DataView(placement.buffer);
  view.setInt32(28, rectangle.x, true);
  view.setInt32(32, rectangle.y, true);
  view.setInt32(36, rectangle.x + rectangle.width, true);
  view.setInt32(40, rectangle.y + rectangle.height, true);
};

const makeRequest = (
  topology: MonitorTopology,
  targetMonitor: WindowsForegroundWindowMoveRequest["targetMonitor"],
  readTopology: () => Promise<MonitorTopology>
): WindowsForegroundWindowMoveRequest => ({
  readTopology,
  targetMonitor,
  topology,
});

const makeNativeApi = (
  foreground: readonly bigint[],
  overrides: Partial<WindowsWindowNativeApi> = {}
): WindowsWindowNativeApi => {
  const windows = [...foreground];
  return {
    getForegroundWindow: () => windows.shift() ?? foreground.at(-1) ?? 1n,
    getWindowPlacement: (_window, placement) => {
      writePlacement(placement, { height: 600, width: 800, x: 100, y: 100 });
      return 1;
    },
    setWindowPos: () => 1,
    ...overrides,
  };
};

describe("Windows foreground-window monitor moves", () => {
  it("routes a selected foreground window using the fresh topology and bounded SetWindowPos call", async () => {
    const topology = makeTopology();
    const target = topology.monitors.find(
      (monitor) => monitor.name === "Right"
    );
    if (target === undefined) {
      throw new Error("Expected the target monitor");
    }
    let restoreCalls = 0;
    let setRequest:
      | {
          readonly window: WindowsNativePointer;
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
          readonly flags: number;
        }
      | undefined;
    const api = makeNativeApi([1n, 1n, 1n], {
      getWindowMonitor: () => 3n,
      getWindowProcessId: () => 100,
      setWindowPos: (window, _insertAfter, x, y, width, height, flags) => {
        setRequest = { flags, height, width, window, x, y };
        return 1;
      },
      showWindow: () => {
        restoreCalls += 1;
        return 1;
      },
    });
    const port = createWindowsWindowPort({
      excludedProcessIds: [200],
      nativeApi: api,
      platform: "win32",
    });
    const result = await port.moveForegroundWindow?.(
      makeRequest(topology, target.id, () => Promise.resolve(topology))
    );

    expect(result).toEqual({
      _tag: "Success",
      value: {
        rectangle: { height: 600, width: 800, x: 2020, y: 100 },
        sourceMonitorId: topology.monitors[0]?.id,
        targetMonitorId: target.id,
        window: 1n,
      },
    });
    expect(restoreCalls).toBe(1);
    expect(setRequest).toEqual({
      flags: 0x14,
      height: 600,
      width: 800,
      window: 1n,
      x: 2020,
      y: 100,
    });
  });

  it("rejects a stale topology before any window mutation", async () => {
    const topology = makeTopology();
    let readTopologyCalls = 0;
    let mutations = 0;
    const api = makeNativeApi([1n], {
      getWindowMonitor: () => 3n,
      getWindowProcessId: () => 100,
      setWindowPos: () => {
        mutations += 1;
        return 1;
      },
      showWindow: () => {
        mutations += 1;
        return 1;
      },
    });
    const port = createWindowsWindowPort({
      nativeApi: api,
      platform: "win32",
    });
    const result = await port.moveForegroundWindow?.(
      makeRequest(topology, "Right", () => {
        readTopologyCalls += 1;
        return Promise.resolve(makeTopology(2000));
      })
    );

    expect(result).toMatchObject({
      _tag: "Error",
      operation: "moveForegroundWindow",
    });
    expect(readTopologyCalls).toBe(1);
    expect(mutations).toBe(0);
  });

  it("rejects a changed foreground HWND before restore or SetWindowPos", async () => {
    let mutations = 0;
    const topology = makeTopology();
    const api = makeNativeApi([1n, 2n], {
      getWindowMonitor: () => 3n,
      getWindowProcessId: () => 100,
      setWindowPos: () => {
        mutations += 1;
        return 1;
      },
      showWindow: () => {
        mutations += 1;
        return 1;
      },
    });
    const port = createWindowsWindowPort({
      nativeApi: api,
      platform: "win32",
    });
    const result = await port.moveForegroundWindow?.(
      makeRequest(topology, "Right", () => Promise.resolve(topology))
    );

    expect(result).toMatchObject({
      _tag: "Error",
      operation: "moveForegroundWindow",
      reason: "The foreground window changed before the move could be applied",
    });
    expect(mutations).toBe(0);
  });

  it("rechecks the foreground HWND after restore before SetWindowPos", async () => {
    let restoreCalls = 0;
    let setCalls = 0;
    const topology = makeTopology();
    const api = makeNativeApi([1n, 1n, 2n], {
      getWindowMonitor: () => 3n,
      getWindowProcessId: () => 100,
      setWindowPos: () => {
        setCalls += 1;
        return 1;
      },
      showWindow: () => {
        restoreCalls += 1;
        return 1;
      },
    });
    const port = createWindowsWindowPort({
      nativeApi: api,
      platform: "win32",
    });
    const result = await port.moveForegroundWindow?.(
      makeRequest(topology, "Right", () => Promise.resolve(topology))
    );

    expect(result).toMatchObject({
      _tag: "Error",
      operation: "moveForegroundWindow",
      reason: "The foreground window changed before the move could be applied",
    });
    expect(restoreCalls).toBe(1);
    expect(setCalls).toBe(0);
  });

  it("does not inspect topology or mutate an excluded foreground process", async () => {
    let topologyCalls = 0;
    let mutations = 0;
    const topology = makeTopology();
    const api = makeNativeApi([1n], {
      getWindowProcessId: () => 42,
      setWindowPos: () => {
        mutations += 1;
        return 1;
      },
      showWindow: () => {
        mutations += 1;
        return 1;
      },
    });
    const port = createWindowsWindowPort({
      excludedProcessIds: [42],
      nativeApi: api,
      platform: "win32",
    });
    const result = await port.moveForegroundWindow?.(
      makeRequest(topology, "Right", () => {
        topologyCalls += 1;
        return Promise.resolve(topology);
      })
    );

    expect(result).toMatchObject({
      _tag: "Unsupported",
      operation: "moveForegroundWindow",
    });
    expect(topologyCalls).toBe(0);
    expect(mutations).toBe(0);
  });

  it("returns unsupported off Windows without invoking native or topology seams", async () => {
    let nativeCalls = 0;
    let topologyCalls = 0;
    const topology = makeTopology();
    const api = makeNativeApi([1n], {
      getForegroundWindow: () => {
        nativeCalls += 1;
        return 1n;
      },
    });
    const port = createWindowsWindowPort({
      nativeApi: api,
      platform: "linux",
    });
    const result = await port.moveForegroundWindow?.(
      makeRequest(topology, "Right", () => {
        topologyCalls += 1;
        return Promise.resolve(topology);
      })
    );

    expect(result).toMatchObject({
      _tag: "Unsupported",
      operation: "moveForegroundWindow",
    });
    expect(nativeCalls).toBe(0);
    expect(topologyCalls).toBe(0);
  });
});
