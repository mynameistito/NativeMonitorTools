import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  AmbiguousMonitorSelector,
  diffTopologies,
  displayProfilesEqual,
  generateApplyPlan,
  makeDisplayMode,
  makeDisplayProfile,
  makeMonitorSnapshot,
  makeMonitorTopology,
  MonitorRuntime,
  MonitorRuntimeLive,
  monitorIdFromIdentity,
  parseDisplayProfile,
  parseMonitorId,
  resolveMonitorSelector,
  serializeDisplayProfile,
} from "../src/index";
import type {
  DisplayProfileMonitor,
  MonitorId,
  MonitorSnapshot,
  MonitorTopology,
} from "../src/index";

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

const id = (value: string): MonitorId => run(parseMonitorId(value));

const mode = (width = 1920, height = 1080, refreshRate = 60) =>
  run(makeDisplayMode({ height, refreshRate, width }));

const monitor = (
  value: string,
  name: string,
  x: number,
  y: number,
  isPrimary: boolean,
  displayMode = mode()
): MonitorSnapshot =>
  run(
    makeMonitorSnapshot({
      bounds: { height: displayMode.height, width: displayMode.width, x, y },
      id: id(value),
      isPrimary,
      mode: displayMode,
      name,
    })
  );

const topology = (monitors: readonly MonitorSnapshot[]): MonitorTopology =>
  run(makeMonitorTopology(monitors));

describe("monitor domain", () => {
  it("preserves negative desktop coordinates in deterministic monitor order", () => {
    const primary = monitor("primary", "Primary", 0, 0, true);
    const left = monitor("left", "Left", -1920, 0, false);
    const above = monitor("above", "Above", 0, -1080, false);
    const current = topology([primary, left, above]);

    expect(current.monitors.map((item) => item.id)).toEqual([
      id("left"),
      id("above"),
      id("primary"),
    ]);
    expect(run(resolveMonitorSelector(current, "1")).id).toBe(id("left"));
  });

  it("derives the same stable identity from the same hardware source", () => {
    const first = run(
      monitorIdFromIdentity({ devicePath: "DISPLAY\\A", serialNumber: "one" })
    );
    const second = run(
      monitorIdFromIdentity({
        devicePath: " DISPLAY\\A ",
        serialNumber: "different",
      })
    );
    const differentSource = run(monitorIdFromIdentity({ edid: "DISPLAY\\A" }));

    expect(first).toBe(second);
    expect(first).not.toBe(differentSource);
  });

  it("resolves numeric, name, and current selectors and reports selector failures", () => {
    const primary = monitor("primary", "Studio", 0, 0, true);
    const right = monitor("right", "Desk", 1920, 0, false);
    const duplicate = monitor("duplicate", "Desk", 3840, 0, false);
    const current = topology([primary, right, duplicate]);

    expect(
      run(
        resolveMonitorSelector(current, "studio", { currentId: id("primary") })
      )
    ).toEqual(primary);
    expect(
      run(
        resolveMonitorSelector(current, "current", { currentId: id("primary") })
      )
    ).toEqual(primary);

    const ambiguous = failure(resolveMonitorSelector(current, "Desk"));
    expect(ambiguous).toBeInstanceOf(AmbiguousMonitorSelector);
    expect(ambiguous._tag).toBe("AmbiguousMonitorSelector");

    const missing = failure(resolveMonitorSelector(current, "missing"));
    expect(missing._tag).toBe("MonitorNotFound");

    const invalid = failure(resolveMonitorSelector(current, "0"));
    expect(invalid._tag).toBe("InvalidMonitorSelector");
  });

  it("round-trips a canonical display profile and rejects invalid profiles", () => {
    const primary = monitor("primary", "Primary", 0, 0, true);
    const left = monitor("left", "Left", -1920, 0, false);
    const current = topology([primary, left]);
    const desiredMonitors: DisplayProfileMonitor[] = current.monitors.map(
      (item) => ({
        id: item.id,
        isPrimary: item.isPrimary,
        mode: item.mode,
        name: item.name,
        position: { x: item.bounds.x, y: item.bounds.y },
      })
    );
    const profile = run(makeDisplayProfile({ monitors: desiredMonitors }));
    const serialized = serializeDisplayProfile(profile);
    const parsed = run(parseDisplayProfile(serialized));

    expect(displayProfilesEqual(profile, parsed)).toBe(true);
    expect(JSON.parse(serialized)).toMatchObject({ version: 1 });
    expect(failure(parseDisplayProfile("not-json"))._tag).toBe(
      "InvalidDisplayProfile"
    );
    expect(
      failure(parseDisplayProfile(JSON.stringify({ monitors: [], version: 1 })))
        ._tag
    ).toBe("InvalidDisplayProfile");
  });

  it("creates a deterministic dry-run plan without mutating the current topology", () => {
    const currentPrimary = monitor("primary", "Primary", 0, 0, true);
    const currentLeft = monitor("left", "Left", -1920, 0, false);
    const current = topology([currentPrimary, currentLeft]);
    const desiredMode = mode(2560, 1440, 120);
    const desired = run(
      makeDisplayProfile({
        monitors: [
          {
            id: id("primary"),
            isPrimary: true,
            mode: desiredMode,
            name: "Primary",
            position: { x: -2560, y: 0 },
          },
          {
            id: id("left"),
            isPrimary: false,
            mode: currentLeft.mode,
            name: "Left",
            position: { x: 0, y: 0 },
          },
        ],
      })
    );

    const plan = run(generateApplyPlan(current, desired));

    expect(plan.dryRun).toBe(true);
    expect(plan.isNoop).toBe(false);
    expect(plan.operations.map((operation) => operation._tag)).toEqual([
      "MoveMonitor",
      "SetDisplayMode",
      "MoveMonitor",
    ]);
    expect(
      current.monitors.find((item) => item.id === id("primary"))?.bounds.x
    ).toBe(0);
  });

  it("reports topology additions, removals, and field changes", () => {
    const beforePrimary = monitor("primary", "Primary", 0, 0, true);
    const before = topology([beforePrimary]);
    const afterPrimary = monitor(
      "primary",
      "Renamed",
      100,
      0,
      true,
      mode(2560, 1440, 60)
    );
    const afterExtra = monitor("extra", "Extra", 2660, 0, false);
    const after = topology([afterPrimary, afterExtra]);

    const diff = diffTopologies(before, after);

    expect(diff.added.map((item) => item.id)).toEqual([id("extra")]);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed[0]?.kinds).toEqual(["Moved", "ModeChanged", "Renamed"]);
    expect(diff.isChanged).toBe(true);
  });

  it("provides the pure operations through the Effect runtime layer", () => {
    const current = topology([monitor("primary", "Primary", 0, 0, true)]);
    const program = MonitorRuntime.use((runtime) =>
      Effect.succeed(runtime.diff(current, current).isChanged)
    );

    expect(run(Effect.provide(MonitorRuntimeLive)(program))).toBe(false);
  });
});
