import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeDisplayMode } from "../src/display-mode";
import {
  makeSystemSnapAreaGroups,
  makeSystemSnapAreas,
  makeSystemSnapAreasForTopology,
  makeUserDefinedSnapAreas,
} from "../src/dmt/snap-areas";
import {
  DuplicateUserDefinedAreaIndex,
  InvalidUserDefinedAreaStore,
  InvalidUserDefinedArea,
  MAX_USER_DEFINED_AREAS,
  UserDefinedAreaLimitExceeded,
  makeUserDefinedAreaStore,
  makeUserDefinedAreas,
  parseUserDefinedAreaStore,
  removeUserDefinedArea,
  serializeUserDefinedAreaStore,
  setUserDefinedArea,
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

  it("adds the SDA0 supersize target over the virtual working area", () => {
    const primary = monitor("primary", "Primary", 1920, 0, 2560, 1440, true);
    const left = monitor("left", "Left", -1920, 0, 1920, 1080, false);
    const areas = makeSystemSnapAreasForTopology(topology([left, primary]));

    expect(areas[0]).toMatchObject({
      id: "SDA0",
      kind: "SuperSize",
      name: "Super size",
      source: "System",
    });
    expect(areas[0]?.rect).toEqual({
      height: 1400,
      width: 6380,
      x: -1910,
      y: 20,
    });
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

  it("round-trips sparse slots and maps them to stable UDA snap targets", () => {
    const store = run(
      makeUserDefinedAreaStore({
        areas: [
          {
            index: 4,
            name: "Fourth",
            rect: { height: 100, width: 200, x: 400, y: 0 },
          },
          {
            index: 1,
            name: "Second",
            rect: { height: 80, width: 160, x: 100, y: 20 },
          },
        ],
        version: 1,
      })
    );

    expect(store.areas.map((area) => area.index)).toEqual([1, 4]);
    expect(makeUserDefinedSnapAreas(store.areas)).toMatchObject([
      { id: "UDA1", name: "Second", source: "User" },
      { id: "UDA4", name: "Fourth", source: "User" },
    ]);

    const serialized = serializeUserDefinedAreaStore(store);
    expect(run(parseUserDefinedAreaStore(serialized))).toEqual(store);
  });

  it("rejects malformed stores and duplicate sparse slots", () => {
    expect(failure(parseUserDefinedAreaStore("{not json"))).toBeInstanceOf(
      InvalidUserDefinedAreaStore
    );
    expect(
      failure(
        parseUserDefinedAreaStore(
          JSON.stringify({
            areas: [
              {
                name: 42,
                rect: { height: 10, width: 10, x: 0, y: 0 },
              },
            ],
            version: 1,
          })
        )
      )
    ).toBeInstanceOf(InvalidUserDefinedAreaStore);
    expect(
      failure(makeUserDefinedAreaStore({ areas: [], version: 2 }))
    ).toBeInstanceOf(InvalidUserDefinedAreaStore);

    const duplicate = failure(
      makeUserDefinedAreaStore({
        areas: [
          {
            index: 2,
            name: "First",
            rect: { height: 10, width: 10, x: 0, y: 0 },
          },
          {
            index: 2,
            name: "Second",
            rect: { height: 10, width: 10, x: 1, y: 1 },
          },
        ],
      })
    );
    expect(duplicate).toBeInstanceOf(DuplicateUserDefinedAreaIndex);
  });

  it("updates and removes slots without mutating the original store", () => {
    const store = run(
      makeUserDefinedAreaStore([
        {
          index: 1,
          name: "Original",
          rect: { height: 100, width: 200, x: 0, y: 0 },
        },
      ])
    );
    const updated = run(
      setUserDefinedArea(
        store,
        {
          name: "Replacement",
          rect: { height: 120, width: 220, x: 10, y: 10 },
        },
        1
      )
    );

    expect(store.areas[0]?.name).toBe("Original");
    expect(updated.areas[0]?.name).toBe("Replacement");
    expect(removeUserDefinedArea(updated, 1).areas).toEqual([]);
    expect(updated.areas).toHaveLength(1);
  });
});
