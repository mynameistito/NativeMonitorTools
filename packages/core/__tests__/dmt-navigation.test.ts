import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeDisplayMode } from "../src/display-mode";
import {
  isCurrentMonitorSelector,
  resolveDmtMonitorSelector,
  selectCurrentMonitor,
} from "../src/dmt/current-monitor";
import {
  selectNextMonitor,
  selectPreviousMonitor,
} from "../src/dmt/monitor-navigation";
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
  isPrimary: boolean
): MonitorSnapshot =>
  run(
    makeMonitorSnapshot({
      bounds: { height: 900, width: 1200, x, y },
      id: id(value),
      isPrimary,
      mode: run(makeDisplayMode({ height: 900, refreshRate: 60, width: 1200 })),
      name,
    })
  );

const topology = (monitors: readonly MonitorSnapshot[]): MonitorTopology =>
  run(makeMonitorTopology(monitors));

describe("DMT monitor navigation", () => {
  it("wraps next and previous in deterministic negative-coordinate order", () => {
    const left = monitor("left", "Left", -2400, 0, false);
    const above = monitor("above", "Above", 0, -900, false);
    const primary = monitor("primary", "Primary", 0, 0, true);
    const current = topology([primary, left, above]);

    expect(run(selectNextMonitor(current, id("primary"))).id).toBe(id("left"));
    expect(run(selectPreviousMonitor(current, id("left"))).id).toBe(
      id("primary")
    );
    expect(run(selectPreviousMonitor(current, id("primary"))).id).toBe(
      id("above")
    );
  });

  it("reports a missing current monitor rather than choosing by position", () => {
    const current = topology([monitor("primary", "Primary", 0, 0, true)]);
    expect(failure(selectNextMonitor(current, id("missing")))._tag).toBe(
      "MonitorNotFound"
    );
  });
});

describe("DMT current-monitor selector helpers", () => {
  it("recognizes x/current and resolves through core selector semantics", () => {
    const primary = monitor("primary", "Primary", 0, 0, true);
    const right = monitor("right", "Right", 1200, 0, false);
    const current = topology([primary, right]);

    expect(isCurrentMonitorSelector(" X ")).toBe(true);
    expect(isCurrentMonitorSelector("current")).toBe(true);
    expect(isCurrentMonitorSelector("1")).toBe(false);
    expect(run(selectCurrentMonitor(current, id("right")))).toEqual(right);
    expect(run(resolveDmtMonitorSelector(current, "x", id("primary")))).toEqual(
      primary
    );
  });
});
