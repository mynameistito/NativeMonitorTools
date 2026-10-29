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

import {
  createWindowsCursorPort,
  parseCursorClipRect,
  parseCursorPoint,
} from "../cursor";
import type { WindowsCursorNativeApi, WindowsCursorRect } from "../cursor";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const monitor = (
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
    })
  );

const topology = (): MonitorTopology =>
  run(
    makeMonitorTopology([
      monitor("left", "Left", -1600, 1600, false),
      monitor("primary", "Primary", 0, 1920, true),
    ])
  );

describe("Windows cursor port", () => {
  it("bounds cursor points and clip rectangles before native calls", () => {
    expect(parseCursorPoint({ x: -2_147_483_648, y: 2_147_483_647 })).toEqual({
      _tag: "Success",
      value: { x: -2_147_483_648, y: 2_147_483_647 },
    });
    expect(parseCursorPoint({ x: 0.5, y: 0 })).toMatchObject({
      _tag: "Error",
      operation: "setCursorPosition",
    });
    expect(
      parseCursorClipRect({
        height: 10,
        width: 10,
        x: 2_147_483_640,
        y: 0,
      })
    ).toMatchObject({
      _tag: "Error",
      operation: "clipCursor",
    });
  });

  it("reads and moves the cursor through the injected native seam", async () => {
    const setCalls: number[][] = [];
    let current = { x: -100, y: 240 };
    const nativeApi: WindowsCursorNativeApi = {
      clipCursor: () => 1,
      getCursorPosition: () => current,
      setCursorPosition: (x, y) => {
        setCalls.push([x, y]);
        current = { x, y };
        return 1;
      },
    };
    const port = createWindowsCursorPort({
      nativeApi,
      platform: "win32",
    });

    const position = await port.getCursorPosition();
    const moved = await port.setCursorPosition({ x: 20, y: 30 });

    expect(position).toEqual({
      _tag: "Success",
      value: { x: -100, y: 240 },
    });
    expect(moved._tag).toBe("Success");
    expect(setCalls).toEqual([[20, 30]]);
  });

  it("executes the pure DMT cursor route without mutating the topology", async () => {
    const setCalls: number[][] = [];
    const nativeApi: WindowsCursorNativeApi = {
      clipCursor: () => 1,
      getCursorPosition: () => ({ x: -100, y: 240 }),
      setCursorPosition: (x, y) => {
        setCalls.push([x, y]);
        return 1;
      },
    };
    const current = topology();
    const result = await createWindowsCursorPort({
      nativeApi,
      platform: "win32",
    }).routeCursor(current, "Primary");

    expect(result).toEqual({
      _tag: "Success",
      value: {
        from: { x: -100, y: 240 },
        sourceMonitorId: run(monitorIdFromIdentity({ devicePath: "left" })),
        targetMonitorId: run(monitorIdFromIdentity({ devicePath: "primary" })),
        targetPoint: { x: 1800, y: 240 },
      },
    });
    expect(setCalls).toEqual([[1800, 240]]);
    expect(current.monitors[0]?.bounds.x).toBe(-1600);
  });

  it("executes the primary-monitor cursor plan through SetCursorPos", async () => {
    const setCalls: number[][] = [];
    const nativeApi: WindowsCursorNativeApi = {
      clipCursor: () => 1,
      getCursorPosition: () => ({ x: -100, y: 240 }),
      setCursorPosition: (x, y) => {
        setCalls.push([x, y]);
        return 1;
      },
    };

    const result = await createWindowsCursorPort({
      nativeApi,
      platform: "win32",
    }).routeCursorToPrimaryMonitor(topology());

    expect(result).toMatchObject({
      _tag: "Success",
      value: { targetPoint: { x: 960, y: 540 } },
    });
    expect(setCalls).toEqual([[960, 540]]);
  });

  it("releases a cursor lock idempotently and releases it on scoped failure", async () => {
    const clips: (WindowsCursorRect | null)[] = [];
    const nativeApi: WindowsCursorNativeApi = {
      clipCursor: (rectangle) => {
        clips.push(rectangle);
        return 1;
      },
      getCursorPosition: () => ({ x: 0, y: 0 }),
      setCursorPosition: () => 1,
    };
    const port = createWindowsCursorPort({
      nativeApi,
      platform: "win32",
    });
    const rectangle = { height: 100, width: 200, x: -20, y: 10 };
    const lock = await port.lockCursor(rectangle);
    if (lock._tag !== "Success") {
      throw new Error("Expected the cursor lock to succeed");
    }
    await lock.value.release();
    await lock.value.release();
    const scoped = await port.withCursorLock(rectangle, () => {
      throw new Error("operation failed");
    });

    expect(scoped).toMatchObject({
      _tag: "Error",
      operation: "lockCursor",
      reason: "operation failed",
    });
    expect(clips).toEqual([rectangle, null, rectangle, null]);
  });

  it("returns unsupported results off Windows without invoking native operations", async () => {
    let nativeCalls = 0;
    const nativeApi: WindowsCursorNativeApi = {
      clipCursor: () => {
        nativeCalls += 1;
        return 1;
      },
      getCursorPosition: () => {
        nativeCalls += 1;
        return { x: 0, y: 0 };
      },
      setCursorPosition: () => {
        nativeCalls += 1;
        return 1;
      },
    };
    const port = createWindowsCursorPort({
      nativeApi,
      platform: "linux",
    });

    const results = await Promise.all([
      port.getCursorPosition(),
      port.setCursorPosition({ x: 0, y: 0 }),
      port.routeCursor(topology(), "Primary"),
      port.clipCursor({ height: 10, width: 10, x: 0, y: 0 }),
      port.releaseCursorClip(),
      port.lockCursor({ height: 10, width: 10, x: 0, y: 0 }),
    ]);

    expect(results.map((result) => result._tag)).toEqual([
      "Unsupported",
      "Unsupported",
      "Unsupported",
      "Unsupported",
      "Unsupported",
      "Unsupported",
    ]);
    expect(nativeCalls).toBe(0);
  });
});
