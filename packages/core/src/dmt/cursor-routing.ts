import { Data, Effect } from "effect";

import type { InvalidGeometry } from "../errors";
import { makePoint } from "../geometry";
import type { Point } from "../geometry";
import { orderMonitors } from "../monitor";
import type { MonitorSnapshot, MonitorTopology } from "../monitor";
import type { MonitorId } from "../monitor-id";
import type {
  MonitorSelector,
  MonitorSelectorError,
  ResolveMonitorSelectorOptions,
} from "../selector";
import { resolveMonitorSelector } from "../selector";

/** A valid cursor point could not be associated with a monitor. */
export class CursorPointUnavailable extends Data.TaggedError(
  "CursorPointUnavailable"
)<{
  /** The point that was not inside any monitor bounds. */
  readonly point: Point;
}> {}

/** All expected failures produced while planning a cursor route. */
export type CursorRoutingError =
  | CursorPointUnavailable
  | InvalidGeometry
  | MonitorSelectorError;

/** A pure cursor move plan for a selected target monitor. */
export interface CursorRoutingResult {
  /** The original cursor point in desktop coordinates. */
  readonly from: Point;
  /** The point an imperative platform adapter may apply. */
  readonly targetPoint: Point;
  /** Stable identity of the monitor containing `from`. */
  readonly sourceMonitorId: MonitorId;
  /** Stable identity of the monitor selected as the destination. */
  readonly targetMonitorId: MonitorId;
}

const containsPoint = (point: Point, monitor: MonitorSnapshot): boolean => {
  const { bounds } = monitor;
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
};

/**
 * Find the monitor containing a cursor point.
 *
 * Bounds use the usual half-open rectangle convention. When monitor bounds
 * overlap, deterministic desktop order supplies the tie-breaker.
 *
 * @param topology - The validated monitor topology.
 * @param point - Cursor point in virtual-desktop coordinates.
 * @returns The containing monitor, or `undefined` for a desktop gap.
 */
export const monitorForCursorPoint = (
  topology: MonitorTopology,
  point: Point
): MonitorSnapshot | undefined =>
  orderMonitors(topology.monitors).find((monitor) =>
    containsPoint(point, monitor)
  );

const clampCoordinate = (value: number, start: number, size: number): number =>
  Math.min(Math.max(value, start), start + Math.max(size - 1, 0));

const translatePointBetweenMonitors = (
  point: Point,
  source: MonitorSnapshot,
  target: MonitorSnapshot
): Point => {
  if (source.id === target.id) {
    return { x: point.x, y: point.y };
  }

  return {
    x: clampCoordinate(
      target.bounds.x + point.x - source.bounds.x,
      target.bounds.x,
      target.bounds.width
    ),
    y: clampCoordinate(
      target.bounds.y + point.y - source.bounds.y,
      target.bounds.y,
      target.bounds.height
    ),
  };
};

/**
 * Plan routing a cursor point to a monitor selected by DMT selector rules.
 *
 * Numeric selectors are one-based in deterministic desktop order, names are
 * case-insensitive exact matches, and `x`/`current` use `currentId` from the
 * selector options. The returned point preserves its offset from the source
 * monitor's origin and is clamped to the destination's pixel bounds.
 *
 * This function performs no platform calls and does not mutate display state;
 * a platform adapter may apply `targetPoint` after inspecting the plan.
 *
 * @param topology - The validated monitor topology.
 * @param point - Cursor point in virtual-desktop coordinates.
 * @param target - Parsed or textual DMT monitor selector.
 * @param options - Current monitor context for `x`/`current`.
 * @returns A deterministic route plan or a typed routing failure.
 */
export const routeCursorPoint = (
  topology: MonitorTopology,
  point: Point,
  target: MonitorSelector | string,
  options: ResolveMonitorSelectorOptions = {}
): Effect.Effect<CursorRoutingResult, CursorRoutingError> =>
  Effect.gen(function* routeCursorPointEffect() {
    const validPoint = yield* makePoint(point);
    const targetMonitor = yield* resolveMonitorSelector(
      topology,
      target,
      options
    );
    const sourceMonitor = monitorForCursorPoint(topology, validPoint);
    if (sourceMonitor === undefined) {
      return yield* Effect.fail(
        new CursorPointUnavailable({ point: validPoint })
      );
    }

    return {
      from: { x: validPoint.x, y: validPoint.y },
      sourceMonitorId: sourceMonitor.id,
      targetMonitorId: targetMonitor.id,
      targetPoint: translatePointBetweenMonitors(
        validPoint,
        sourceMonitor,
        targetMonitor
      ),
    };
  });

/** Alias emphasizing that the returned value is a plan, not an OS operation. */
export const planCursorRoute = routeCursorPoint;

/** Alias using the target-monitor terminology used by DMT commands. */
export const routeCursorToMonitor = routeCursorPoint;
