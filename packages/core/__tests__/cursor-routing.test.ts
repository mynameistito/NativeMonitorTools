import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeDisplayMode } from "../src/display-mode";
import {
  CursorPointUnavailable,
  routeCursorPoint,
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
  it("resolves a target selector and preserves the cursor offset across monitors", () => {
    const left = monitor("left", "Left", -1600, 0, 1600, 900, false);
    const primary = monitor("primary", "Primary", 0, 0, 1920, 1080, true);
    const current = topology([primary, left]);
    const original = { x: -100, y: 240 };

    const route = run(routeCursorPoint(current, original, "PRIMARY"));

    expect(route).toEqual({
      from: original,
      sourceMonitorId: id("left"),
      targetMonitorId: id("primary"),
      targetPoint: { x: 1500, y: 240 },
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

  it("reports invalid, unavailable, and off-topology routing inputs as typed failures", () => {
    const primary = monitor("primary", "Primary", 0, 0, 100, 100, true);
    const current = topology([primary]);

    expect(failure(routeCursorPoint(current, { x: 10, y: 10 }, "0"))._tag).toBe(
      "InvalidMonitorSelector"
    );
    expect(
      failure(routeCursorPoint(current, { x: 10, y: 10 }, "missing"))
    ).toBeInstanceOf(MonitorNotFound);
    expect(
      failure(routeCursorPoint(current, { x: 10, y: 10 }, "current"))._tag
    ).toBe("CurrentMonitorUnavailable");
    expect(
      failure(routeCursorPoint(current, { x: Number.NaN, y: 10 }, "1"))
    ).toBeInstanceOf(InvalidGeometry);

    const gap = failure(routeCursorPoint(current, { x: 100, y: 10 }, "1"));
    expect(gap).toBeInstanceOf(CursorPointUnavailable);
    expect(gap._tag).toBe("CursorPointUnavailable");
  });
});
