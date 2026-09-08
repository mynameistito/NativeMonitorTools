import { Effect } from "effect";

import { displayModesEqual } from "./display-mode";
import type { DisplayMode } from "./display-mode";
import { InvalidTopology } from "./errors";
import { rectsEqual } from "./geometry";
import type { Rect } from "./geometry";
import type { MonitorId } from "./monitor-id";

/** A platform-independent snapshot of one currently visible monitor. */
export interface MonitorSnapshot {
  readonly id: MonitorId;
  readonly name: string;
  readonly bounds: Rect;
  readonly mode: DisplayMode;
  readonly isPrimary: boolean;
  readonly workArea?: Rect;
}

/** A validated collection of monitor snapshots with one deterministic primary monitor. */
export interface MonitorTopology {
  readonly monitors: readonly MonitorSnapshot[];
  readonly primaryId: MonitorId;
}

interface MonitorSnapshotInput {
  readonly id: MonitorId;
  readonly name: string;
  readonly bounds: Rect;
  readonly mode: DisplayMode;
  readonly isPrimary: boolean;
  readonly workArea?: Rect;
}

const compareStrings = (left: string, right: string): number => {
  const leftKey = left.toLocaleLowerCase();
  const rightKey = right.toLocaleLowerCase();
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return 0;
};

const isValidRect = (rect: Rect): boolean => {
  const hasFiniteCoordinates =
    Number.isFinite(rect.x) && Number.isFinite(rect.y);
  const hasPositiveDimensions = rect.width > 0 && rect.height > 0;
  const hasFiniteDimensions =
    Number.isFinite(rect.width) && Number.isFinite(rect.height);
  return hasFiniteCoordinates && hasFiniteDimensions && hasPositiveDimensions;
};

const isValidMode = (mode: DisplayMode): boolean => {
  const hasDimensions =
    Number.isInteger(mode.width) &&
    mode.width > 0 &&
    Number.isInteger(mode.height) &&
    mode.height > 0;
  const hasRefreshRate =
    Number.isFinite(mode.refreshRate) && mode.refreshRate > 0;
  const hasValidColorDepth =
    mode.bitsPerPixel === undefined ||
    (Number.isInteger(mode.bitsPerPixel) && mode.bitsPerPixel > 0);
  return hasDimensions && hasRefreshRate && hasValidColorDepth;
};

/**
 * Construct a validated monitor snapshot.
 *
 * @param input - The platform-neutral monitor data.
 * @returns An Effect that succeeds with a MonitorSnapshot or fails with InvalidTopology.
 */
export const makeMonitorSnapshot = (
  input: MonitorSnapshotInput
): Effect.Effect<MonitorSnapshot, InvalidTopology> => {
  const name = input.name.trim();
  if (name.length === 0) {
    return Effect.fail(
      new InvalidTopology({
        monitorId: input.id,
        reason: "Monitor name cannot be empty",
      })
    );
  }
  if (!isValidRect(input.bounds)) {
    return Effect.fail(
      new InvalidTopology({
        monitorId: input.id,
        reason: "Monitor bounds are invalid",
      })
    );
  }
  if (!isValidMode(input.mode)) {
    return Effect.fail(
      new InvalidTopology({
        monitorId: input.id,
        reason: "Monitor display mode is invalid",
      })
    );
  }
  if (input.workArea !== undefined && !isValidRect(input.workArea)) {
    return Effect.fail(
      new InvalidTopology({
        monitorId: input.id,
        reason: "Monitor work area is invalid",
      })
    );
  }

  const snapshot = {
    bounds: { ...input.bounds },
    id: input.id,
    isPrimary: input.isPrimary,
    mode: { ...input.mode },
    name,
  };
  if (input.workArea === undefined) {
    return Effect.succeed(snapshot);
  }
  return Effect.succeed({ ...snapshot, workArea: { ...input.workArea } });
};

/**
 * Sort monitors from left to right, then top to bottom, with stable tie-breakers.
 *
 * This order deliberately uses desktop coordinates rather than platform-assigned
 * display numbers, so negative-coordinate layouts remain deterministic.
 *
 * @param monitors - The monitor snapshots to order.
 * @returns A new array; the input is never mutated.
 */
export const orderMonitors = (
  monitors: readonly MonitorSnapshot[]
): readonly MonitorSnapshot[] =>
  monitors.toSorted((left, right) => {
    const xOrder = left.bounds.x - right.bounds.x;
    if (xOrder !== 0) {
      return xOrder;
    }

    const yOrder = left.bounds.y - right.bounds.y;
    if (yOrder !== 0) {
      return yOrder;
    }

    if (left.isPrimary !== right.isPrimary) {
      return left.isPrimary ? -1 : 1;
    }

    const nameOrder = compareStrings(left.name, right.name);
    if (nameOrder !== 0) {
      return nameOrder;
    }
    return compareStrings(left.id, right.id);
  });

/** Return monitor IDs in the same deterministic order used for numeric selectors. */
export const orderedMonitorIds = (
  topology: MonitorTopology
): readonly MonitorId[] =>
  orderMonitors(topology.monitors).map((monitor) => monitor.id);

/**
 * Construct a topology and enforce unique identities and exactly one primary monitor.
 *
 * @param monitors - The snapshots reported by a platform adapter.
 * @returns An Effect that succeeds with a MonitorTopology or fails with InvalidTopology.
 */
export const makeMonitorTopology = (
  monitors: readonly MonitorSnapshot[]
): Effect.Effect<MonitorTopology, InvalidTopology> => {
  if (monitors.length === 0) {
    return Effect.fail(
      new InvalidTopology({
        reason: "A topology must contain at least one monitor",
      })
    );
  }

  const ids = new Set<MonitorId>();
  let primaryId: MonitorId | undefined;
  for (const monitor of monitors) {
    if (ids.has(monitor.id)) {
      return Effect.fail(
        new InvalidTopology({
          monitorId: monitor.id,
          reason: "Monitor IDs must be unique",
        })
      );
    }
    ids.add(monitor.id);

    if (monitor.isPrimary) {
      if (primaryId !== undefined) {
        return Effect.fail(
          new InvalidTopology({
            reason: "A topology must contain exactly one primary monitor",
          })
        );
      }
      primaryId = monitor.id;
    }
  }

  if (primaryId === undefined) {
    return Effect.fail(
      new InvalidTopology({
        reason: "A topology must contain exactly one primary monitor",
      })
    );
  }

  return Effect.succeed({ monitors: orderMonitors(monitors), primaryId });
};

/** Find a monitor by its stable identity without changing topology order. */
export const findMonitor = (
  topology: MonitorTopology,
  id: MonitorId
): MonitorSnapshot | undefined =>
  topology.monitors.find((monitor) => monitor.id === id);

/** Compare the fields of two snapshots that affect display configuration. */
export const monitorSnapshotsEqual = (
  left: MonitorSnapshot,
  right: MonitorSnapshot
): boolean => {
  if (left.id !== right.id || left.name !== right.name) {
    return false;
  }
  if (
    !rectsEqual(left.bounds, right.bounds) ||
    !displayModesEqual(left.mode, right.mode)
  ) {
    return false;
  }
  if (left.isPrimary !== right.isPrimary) {
    return false;
  }
  if (left.workArea === undefined) {
    return right.workArea === undefined;
  }
  return (
    right.workArea !== undefined && rectsEqual(left.workArea, right.workArea)
  );
};
