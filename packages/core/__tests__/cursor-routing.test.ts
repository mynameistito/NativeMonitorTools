import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeDisplayMode } from "../src/display-mode";
import {
  nearestMonitorForCursorPoint,
  planCursorBarriers,
  routeCursorPoint,
  routeCursorToNextMonitor,
  routeCursorToPreviousMonitor,
  routeCursorToPrimaryMonitor,
} from "../src/dmt/cursor-routing";
import { InvalidGeometry, MonitorNotFound } from "../src/errors";
import { makeMonitorSnapshot, makeMonitorTopology } from "../src/monitor";
import type { MonitorSnapshot, MonitorTopology } from "../src/monitor";
import { parseMonitorId } from "../src/monitor-id";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const failure = <A, E>(effect: Effect.Effect<A, E>): E => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected an Effect failure");
  }
  const found = Cause.findError(exit.cause);
  if (!Result.isSuccess(found)) {
    throw new Error("Expected a typed Effect failure");
  }
  return found.success;
};

const id = (value: string) => run(parseMonitorId(value));

const monitor = (
  value: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  isPrimary: boolean
): MonitorSnapshot =>
  run(
    makeMonitorSnapshot({
      bounds: { height, width, x, y },
      id: id(value),
      isPrimary,
      mode: run(makeDisplayMode({ height, refreshRate: 60, width })),
      name,
    })
  );

const topology = (monitors: readonly MonitorSnapshot[]): MonitorTopology =>
  run(makeMonitorTopology(monitors));

describe("DMT cursor routing", () => {
  it("resolves a target selector and scales the cursor position across monitors", () => {
    const left = monitor("left", "Left", -1600, 0, 1600, 900, false);
    const primary = monitor("primary", "Primary", 0, 0, 1920, 1080, true);
    const current = topology([primary, left]);
    const original = { x: -100, y: 240 };

    const route = run(routeCursorPoint(current, original, "PRIMARY"));

    expect(route).toEqual({
      from: original,
      sourceMonitorId: id("left"),
      targetMonitorId: id("primary"),
      targetPoint: { x: 1800, y: 288 },
    });
    expect(original).toEqual({ x: -100, y: 240 });
    expect(
      current.monitors.find((item) => item.id === id("left"))?.bounds.x
    ).toBe(-1600);

    const currentRoute = run(
      routeCursorPoint(current, original, "current", {
        currentId: id("primary"),
      })
    );
    expect(currentRoute.targetMonitorId).toBe(id("primary"));

    const inferredCurrentRoute = run(
      routeCursorPoint(current, original, "current")
    );
    expect(inferredCurrentRoute.targetMonitorId).toBe(id("left"));
  });

  it("uses one-based deterministic order and clamps a point to a smaller target", () => {
    const left = monitor("left", "Left", -100, 0, 100, 100, false);
    const primary = monitor("primary", "Primary", 0, 0, 50, 50, true);
    const current = topology([primary, left]);

    const route = run(routeCursorPoint(current, { x: -1, y: 99 }, "2"));

    expect(route.sourceMonitorId).toBe(id("left"));
    expect(route.targetMonitorId).toBe(id("primary"));
    expect(route.targetPoint).toEqual({ x: 49, y: 49 });
  });

  it("reports invalid and missing routing inputs as typed failures", () => {
    const primary = monitor("primary", "Primary", 0, 0, 100, 100, true);
    const current = topology([primary]);

    expect(failure(routeCursorPoint(current, { x: 10, y: 10 }, "0"))._tag).toBe(
      "InvalidMonitorSelector"
    );
    expect(
      failure(routeCursorPoint(current, { x: 10, y: 10 }, "missing"))
    ).toBeInstanceOf(MonitorNotFound);
    expect(
      run(routeCursorPoint(current, { x: 10, y: 10 }, "current"))
        .targetMonitorId
    ).toBe(id("primary"));
    expect(
      failure(routeCursorPoint(current, { x: Number.NaN, y: 10 }, "1"))
    ).toBeInstanceOf(InvalidGeometry);

    const right = monitor("right", "Right", 200, 0, 100, 100, false);
    const gapTopology = topology([primary, right]);
    const gapRoute = run(routeCursorPoint(gapTopology, { x: 120, y: 10 }, "2"));
    expect(gapRoute.sourceMonitorId).toBe(id("primary"));
    expect(gapRoute.targetPoint).toEqual({ x: 299, y: 10 });
    expect(
      run(routeCursorPoint(gapTopology, { x: 120, y: 10 }, "1")).targetPoint
    ).toEqual({ x: 99, y: 10 });
    expect(
      nearestMonitorForCursorPoint(gapTopology, { x: 120, y: 10 })?.id
    ).toBe(id("primary"));
  });

  it("plans edge barriers and deterministic next, previous, and primary routes", () => {
    const primary = monitor("primary", "Primary", 0, 0, 100, 100, true);
    const right = monitor("right", "Right", 100, 0, 200, 200, false);
    const current = topology([right, primary]);

    expect(planCursorBarriers(current, id("primary"), 12)).toEqual([
      { active: false, direction: "Left", limit: 0, minForce: 0 },
      { active: true, direction: "Right", limit: 99, minForce: 12 },
      { active: false, direction: "Top", limit: 0, minForce: 0 },
      { active: true, direction: "Bottom", limit: 99, minForce: 12 },
    ]);
    expect(planCursorBarriers(current, id("missing"))).toBeUndefined();

    expect(
      run(routeCursorToNextMonitor(current, { x: 10, y: 20 })).targetMonitorId
    ).toBe(id("right"));
    expect(
      run(routeCursorToPreviousMonitor(current, { x: 150, y: 20 }))
        .targetMonitorId
    ).toBe(id("primary"));
    expect(
      run(routeCursorToPrimaryMonitor(current, { x: 150, y: 20 })).targetPoint
    ).toEqual({ x: 50, y: 50 });
  });
});
