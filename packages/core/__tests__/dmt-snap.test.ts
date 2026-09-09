import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeDisplayMode } from "../src/display-mode";
import {
  makeSystemSnapAreaGroups,
  makeSystemSnapAreas,
} from "../src/dmt/snap-areas";
import {
  InvalidUserDefinedArea,
  MAX_USER_DEFINED_AREAS,
  UserDefinedAreaLimitExceeded,
  makeUserDefinedAreas,
} from "../src/dmt/user-areas";
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
      workArea: {
        height: height - 40,
        width: width - 20,
        x: x + 10,
        y: y + 20,
      },
    })
  );

const topology = (monitors: readonly MonitorSnapshot[]): MonitorTopology =>
  run(makeMonitorTopology(monitors));

const userAreaInputs = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `Area ${index}`,
    rect: { height: 100, width: 200, x: index * 10, y: -index },
  }));

describe("DMT system snap areas", () => {
  it("divides negative-coordinate, odd-sized work areas without losing pixels", () => {
    const areas = makeSystemSnapAreas({
      height: 901,
      width: 1601,
      x: -1600,
      y: -300,
    });
    const areaById = (value: string) => areas.find((area) => area.id === value);
    const full = areaById("Full");
    const left = areaById("LeftHalf");
    const right = areaById("RightHalf");
    const topLeft = areaById("TopLeftQuarter");
    const bottomRight = areaById("BottomRightQuarter");

    expect(full?.rect).toEqual({
      height: 901,
      width: 1601,
      x: -1600,
      y: -300,
    });
    expect(left?.rect.width).toBe(800);
    expect(right?.rect).toMatchObject({ width: 801, x: -800 });
    expect(topLeft?.rect).toMatchObject({ height: 450, width: 800 });
    expect(bottomRight?.rect).toMatchObject({
      height: 451,
      width: 801,
      x: -800,
      y: 150,
    });
  });

  it("places the primary monitor group first despite desktop ordering", () => {
    const primary = monitor("primary", "Primary", 1920, 0, 2560, 1440, true);
    const left = monitor("left", "Left", -1920, 0, 1920, 1080, false);
    const groups = makeSystemSnapAreaGroups(topology([left, primary]));

    expect(groups).toHaveLength(2);
    expect(groups[0]?.monitorId).toBe(id("primary"));
    expect(groups[0]?.isPrimary).toBe(true);
    expect(groups[0]?.areas).toHaveLength(9);
    expect(groups[1]?.monitorId).toBe(id("left"));
  });
});

describe("DMT user-defined areas", () => {
  it("accepts exactly 100 areas and assigns stable zero-based slots", () => {
    const areas = run(
      makeUserDefinedAreas(userAreaInputs(MAX_USER_DEFINED_AREAS))
    );

    expect(areas).toHaveLength(MAX_USER_DEFINED_AREAS);
    expect(areas[0]?.index).toBe(0);
    expect(areas.at(-1)?.index).toBe(99);
  });

  it("rejects the 101st area and invalid names or rectangles", () => {
    const tooMany = failure(makeUserDefinedAreas(userAreaInputs(101)));
    expect(tooMany).toBeInstanceOf(UserDefinedAreaLimitExceeded);

    const invalidName = failure(
      makeUserDefinedAreas([
        { name: "   ", rect: { height: 10, width: 10, x: 0, y: 0 } },
      ])
    );
    expect(invalidName).toBeInstanceOf(InvalidUserDefinedArea);

    const invalidRect = failure(
      makeUserDefinedAreas([
        { name: "Bad", rect: { height: 0, width: 10, x: 0, y: 0 } },
      ])
    );
    expect(invalidRect).toBeInstanceOf(InvalidUserDefinedArea);
  });
});
