import { Data, Effect } from "effect";

import type { InvalidGeometry } from "../errors";
import { makePoint } from "../geometry";
import type { Point, Rect } from "../geometry";
import { orderMonitors } from "../monitor";
import type { MonitorSnapshot, MonitorTopology } from "../monitor";
import type { MonitorId } from "../monitor-id";
import type {
  MonitorSelector,
  MonitorSelectorError,
  ResolveMonitorSelectorOptions,
} from "../selector";
import { resolveMonitorSelector } from "../selector";
import { selectMonitorAtOffset } from "./monitor-navigation";
import type { MonitorNavigationError } from "./monitor-navigation";

/** A valid cursor point could not be associated with a monitor. */
export class CursorPointUnavailable extends Data.TaggedError(
  "CursorPointUnavailable"
)<{
  /** The point for which no monitor was available. */
  readonly point: Point;
}> {}

/** All expected failures produced while planning a cursor route. */
export type CursorRoutingError =
  | CursorPointUnavailable
  | InvalidGeometry
  | MonitorNavigationError
  | MonitorSelectorError;

/** A pure cursor move plan for a selected target monitor. */
export interface CursorRoutingResult {
  /** The original cursor point in desktop coordinates. */
  readonly from: Point;
  /** The point an imperative platform adapter may apply. */
  readonly targetPoint: Point;
  /** Stable identity of the monitor containing or nearest to `from`. */
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

const distanceOutside = (
  value: number,
  start: number,
  size: number
): number => {
  if (value < start) {
    return start - value;
  }
  if (value >= start + size) {
    return value - start - size + 1;
  }
  return 0;
};

const distanceFromPoint = (point: Point, monitor: MonitorSnapshot): number => {
  const { bounds } = monitor;
  const xDistance = distanceOutside(point.x, bounds.x, bounds.width);
  const yDistance = distanceOutside(point.y, bounds.y, bounds.height);
  return xDistance + yDistance;
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

/**
 * Find the monitor DMT would use for a cursor point.
 *
 * DMT first checks containment and then chooses the nearest monitor using the
 * sum of horizontal and vertical distances. Ordered topology supplies the
 * tie-breaker, making dead-space routing deterministic.
 *
 * @param topology - The validated monitor topology.
 * @param point - Cursor point in virtual-desktop coordinates.
 * @returns The containing or nearest monitor, or `undefined` for an empty topology.
 */
export const nearestMonitorForCursorPoint = (
  topology: MonitorTopology,
  point: Point
): MonitorSnapshot | undefined => {
  const monitors = orderMonitors(topology.monitors);
  const containing = monitors.find((monitor) => containsPoint(point, monitor));
  if (containing !== undefined) {
    return containing;
  }

  const [first, ...remaining] = monitors;
  if (first === undefined) {
    return undefined;
  }

  let nearest = first;
  let nearestDistance = distanceFromPoint(point, first);
  for (const monitor of remaining) {
    const distance = distanceFromPoint(point, monitor);
    if (distance < nearestDistance) {
      nearest = monitor;
      nearestDistance = distance;
    }
  }
  return nearest;
};

const clampCoordinate = (value: number, start: number, size: number): number =>
  Math.min(Math.max(value, start), start + Math.max(size - 1, 0));

const scaleCoordinate = (
  value: number,
  sourceStart: number,
  sourceSize: number,
  targetStart: number,
  targetSize: number
): number =>
  clampCoordinate(
    targetStart + Math.round(((value - sourceStart) * targetSize) / sourceSize),
    targetStart,
    targetSize
  );

const translatePointBetweenMonitors = (
  point: Point,
  source: MonitorSnapshot,
  target: MonitorSnapshot
): Point => {
  if (source.id === target.id) {
    return {
      x: clampCoordinate(point.x, target.bounds.x, target.bounds.width),
      y: clampCoordinate(point.y, target.bounds.y, target.bounds.height),
    };
  }

  return {
    x: scaleCoordinate(
      point.x,
      source.bounds.x,
      source.bounds.width,
      target.bounds.x,
      target.bounds.width
    ),
    y: scaleCoordinate(
      point.y,
      source.bounds.y,
      source.bounds.height,
      target.bounds.y,
      target.bounds.height
    ),
  };
};

const virtualDesktopBounds = (topology: MonitorTopology): Rect | undefined => {
  const [first, ...remaining] = topology.monitors;
  if (first === undefined) {
    return undefined;
  }

  let left = first.bounds.x;
  let top = first.bounds.y;
  let right = first.bounds.x + first.bounds.width;
  let bottom = first.bounds.y + first.bounds.height;
  for (const monitor of remaining) {
    left = Math.min(left, monitor.bounds.x);
    top = Math.min(top, monitor.bounds.y);
    right = Math.max(right, monitor.bounds.x + monitor.bounds.width);
    bottom = Math.max(bottom, monitor.bounds.y + monitor.bounds.height);
  }
  return { height: bottom - top, width: right - left, x: left, y: top };
};

/** The direction of a pure cursor barrier at a monitor edge. */
export type CursorBarrierDirection = "Left" | "Right" | "Top" | "Bottom";

/** A pure description of one edge barrier used by DMT cursor modes. */
export interface CursorBarrierPlan {
  /** Edge controlled by the barrier. */
  readonly direction: CursorBarrierDirection;
  /** Whether the edge is inside the virtual desktop and therefore relevant. */
  readonly active: boolean;
  /** Inclusive pixel limit used by a platform hook. */
  readonly limit: number;
  /** Maximum accumulated force; `Infinity` means a solid barrier. */
  readonly minForce: number;
}

/**
 * Plan the four edge barriers for a monitor without installing a hook.
 *
 * This captures the geometry contract used by DMT's free, sticky, and locked
 * cursor modes. The platform adapter owns accumulated mouse force and hook
 * installation; this function only returns stable edge data.
 *
 * @param topology - The validated monitor topology.
 * @param monitorId - Stable identity of the monitor being constrained.
 * @param minForce - Extra pixels required to cross an active edge.
 * @returns Edge plans, or `undefined` if `monitorId` is not present.
 */
export const planCursorBarriers = (
  topology: MonitorTopology,
  monitorId: MonitorId,
  minForce = 0
): readonly CursorBarrierPlan[] | undefined => {
  const monitor = topology.monitors.find((item) => item.id === monitorId);
  const desktop = virtualDesktopBounds(topology);
  if (monitor === undefined || desktop === undefined) {
    return undefined;
  }

  const force = Number.isNaN(minForce) ? 0 : Math.max(0, minForce);
  const barrier = (
    direction: CursorBarrierDirection,
    active: boolean,
    limit: number
  ): CursorBarrierPlan => ({
    active,
    direction,
    limit: active ? limit : 0,
    minForce: active ? force : 0,
  });
  return [
    barrier("Left", monitor.bounds.x > desktop.x, monitor.bounds.x),
    barrier(
      "Right",
      monitor.bounds.x + monitor.bounds.width < desktop.x + desktop.width,
      monitor.bounds.x + monitor.bounds.width - 1
    ),
    barrier("Top", monitor.bounds.y > desktop.y, monitor.bounds.y),
    barrier(
      "Bottom",
      monitor.bounds.y + monitor.bounds.height < desktop.y + desktop.height,
      monitor.bounds.y + monitor.bounds.height - 1
    ),
  ];
};

const routePointToMonitor = (
  point: Point,
  sourceMonitor: MonitorSnapshot,
  targetMonitor: MonitorSnapshot
): CursorRoutingResult => ({
  from: { x: point.x, y: point.y },
  sourceMonitorId: sourceMonitor.id,
  targetMonitorId: targetMonitor.id,
  targetPoint: translatePointBetweenMonitors(
    point,
    sourceMonitor,
    targetMonitor
  ),
});

const monitorCenter = (monitor: MonitorSnapshot): Point => ({
  x: monitor.bounds.x + Math.floor(monitor.bounds.width / 2),
  y: monitor.bounds.y + Math.floor(monitor.bounds.height / 2),
});

/**
 * Plan routing a cursor point to a monitor selected by DMT selector rules.
 *
 * Numeric selectors are one-based in deterministic desktop order, names are
 * case-insensitive exact matches, and `x`/`current` use the explicit
 * `currentId` when supplied or the nearest monitor to `point` otherwise. The
 * returned point is scaled between monitor bounds and clamped to a valid
 * destination pixel.
 *
 * This function performs no platform calls and does not mutate display state;
 * a platform adapter may apply `targetPoint` after inspecting the plan.
 *
 * @param topology - The validated monitor topology.
 * @param point - Cursor point in virtual-desktop coordinates.
 * @param target - Parsed or textual DMT monitor selector.
 * @param options - Optional explicit current monitor context.
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
    const sourceMonitor = nearestMonitorForCursorPoint(topology, validPoint);
    if (sourceMonitor === undefined) {
      return yield* Effect.fail(
        new CursorPointUnavailable({ point: validPoint })
      );
    }

    const targetMonitor = yield* resolveMonitorSelector(
      topology,
      target,
      options.currentId === undefined
        ? { currentId: sourceMonitor.id }
        : options
    );
    return routePointToMonitor(validPoint, sourceMonitor, targetMonitor);
  });

/** Alias emphasizing that the returned value is a plan, not an OS operation. */
export const planCursorRoute = routeCursorPoint;

/** Alias using the target-monitor terminology used by DMT commands. */
export const routeCursorToMonitor = routeCursorPoint;

const routeCursorByOffset = (
  topology: MonitorTopology,
  point: Point,
  delta: number
): Effect.Effect<CursorRoutingResult, CursorRoutingError> =>
  Effect.gen(function* routeCursorByOffsetEffect() {
    const validPoint = yield* makePoint(point);
    const sourceMonitor = nearestMonitorForCursorPoint(topology, validPoint);
    if (sourceMonitor === undefined) {
      return yield* Effect.fail(
        new CursorPointUnavailable({ point: validPoint })
      );
    }
    const targetMonitor = yield* selectMonitorAtOffset(
      topology,
      sourceMonitor.id,
      delta
    );
    return routePointToMonitor(validPoint, sourceMonitor, targetMonitor);
  });

/**
 * Plan moving the cursor to the next monitor in deterministic DMT order.
 *
 * @param topology - The validated monitor topology.
 * @param point - Current cursor point in desktop coordinates.
 * @returns A next-monitor route plan or a typed failure.
 */
export const routeCursorToNextMonitor = (
  topology: MonitorTopology,
  point: Point
): Effect.Effect<CursorRoutingResult, CursorRoutingError> =>
  routeCursorByOffset(topology, point, 1);

/**
 * Plan moving the cursor to the previous monitor in deterministic DMT order.
 *
 * @param topology - The validated monitor topology.
 * @param point - Current cursor point in desktop coordinates.
 * @returns A previous-monitor route plan or a typed failure.
 */
export const routeCursorToPreviousMonitor = (
  topology: MonitorTopology,
  point: Point
): Effect.Effect<CursorRoutingResult, CursorRoutingError> =>
  routeCursorByOffset(topology, point, -1);

/**
 * Plan moving the cursor to the center pixel of the primary monitor.
 *
 * @param topology - The validated monitor topology.
 * @param point - Current cursor point in desktop coordinates.
 * @returns A primary-monitor route plan or a typed failure.
 */
export const routeCursorToPrimaryMonitor = (
  topology: MonitorTopology,
  point: Point
): Effect.Effect<CursorRoutingResult, CursorRoutingError> =>
  Effect.gen(function* routeCursorToPrimaryMonitorEffect() {
    const validPoint = yield* makePoint(point);
    const sourceMonitor = nearestMonitorForCursorPoint(topology, validPoint);
    const primaryMonitor = topology.monitors.find(
      (monitor) => monitor.id === topology.primaryId
    );
    if (sourceMonitor === undefined || primaryMonitor === undefined) {
      return yield* Effect.fail(
        new CursorPointUnavailable({ point: validPoint })
      );
    }

    return {
      ...routePointToMonitor(validPoint, sourceMonitor, primaryMonitor),
      targetPoint: monitorCenter(primaryMonitor),
    };
  });

/** Alias naming the plan rather than the eventual cursor operation. */
export const planCursorToPrimaryMonitor = routeCursorToPrimaryMonitor;
