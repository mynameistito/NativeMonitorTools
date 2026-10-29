/* oxlint-disable anti-slop/no-runtime-typeof -- Text selectors are a deliberate boundary input. */

import type { Effect } from "effect";

import type { Rect } from "../geometry";
import type { MonitorSnapshot, MonitorTopology } from "../monitor";
import type { MonitorId } from "../monitor-id";
import type {
  MonitorSelector,
  MonitorSelectorError,
  ResolveMonitorSelectorOptions,
} from "../selector";
import { resolveMonitorSelector } from "../selector";

/** The canonical parsed selector for the current monitor. */
export const CURRENT_MONITOR_SELECTOR: MonitorSelector = { _tag: "Current" };

/**
 * Create a fresh current-monitor selector value.
 *
 * @returns The parsed current selector.
 */
export const currentMonitorSelector = (): MonitorSelector => ({
  _tag: "Current",
});

/**
 * Test whether a parsed or textual selector means the current monitor.
 *
 * @param selector - Parsed selector or user-facing selector text.
 * @returns Whether the selector is `x` or `current`.
 */
export const isCurrentMonitorSelector = (
  selector: MonitorSelector | string
): boolean => {
  if (typeof selector === "string") {
    const normalized = selector.trim().toLocaleLowerCase();
    return normalized === "x" || normalized === "current";
  }
  return selector._tag === "Current";
};

/**
 * Resolve any DMT selector while supplying the current monitor context.
 *
 * @param topology - The validated monitor topology.
 * @param selector - Parsed or textual monitor selector.
 * @param currentId - Current monitor identity, when available.
 * @returns The selected monitor or the existing selector error vocabulary.
 */
export const resolveDmtMonitorSelector = (
  topology: MonitorTopology,
  selector: MonitorSelector | string,
  currentId?: MonitorId
): Effect.Effect<MonitorSnapshot, MonitorSelectorError> =>
  resolveMonitorSelector(topology, selector, { currentId });

/**
 * Resolve a selector using the same options object as the core selector API.
 *
 * @param topology - The validated monitor topology.
 * @param selector - Parsed or textual monitor selector.
 * @param options - Current monitor context for `x`/`current`.
 * @returns The selected monitor or a typed selector failure.
 */
export const resolveCurrentMonitorSelector = (
  topology: MonitorTopology,
  selector: MonitorSelector | string,
  options: ResolveMonitorSelectorOptions = {}
): Effect.Effect<MonitorSnapshot, MonitorSelectorError> =>
  resolveMonitorSelector(topology, selector, options);

/**
 * Resolve the current-monitor selector through the existing core selector API.
 *
 * @param topology - The validated monitor topology.
 * @param currentId - Current monitor identity.
 * @returns The current monitor or a typed selector failure.
 */
export const selectCurrentMonitor = (
  topology: MonitorTopology,
  currentId?: MonitorId
): Effect.Effect<MonitorSnapshot, MonitorSelectorError> =>
  resolveMonitorSelector(topology, CURRENT_MONITOR_SELECTOR, { currentId });

/** Alias for `selectCurrentMonitor`. */
export const resolveCurrentMonitor = selectCurrentMonitor;

const intersectionArea = (left: Rect, right: Rect): number => {
  const width =
    Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  const height =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
};

const centerDistance = (left: Rect, right: Rect): number => {
  const leftCenterX = left.x + left.width / 2;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterX = right.x + right.width / 2;
  const rightCenterY = right.y + right.height / 2;
  const xDistance = leftCenterX - rightCenterX;
  const yDistance = leftCenterY - rightCenterY;
  return xDistance * xDistance + yDistance * yDistance;
};

/**
 * Infer the current monitor for a rectangle without querying the platform.
 *
 * The monitor with the greatest overlap wins. If there is no overlap, the
 * nearest monitor center wins; ties retain the topology's deterministic order.
 *
 * @param topology - The validated monitor topology.
 * @param rect - Window or cursor rectangle in desktop coordinates.
 * @returns The best matching monitor.
 */
export const monitorForRect = (
  topology: MonitorTopology,
  rect: Rect
): MonitorSnapshot => {
  const [first, ...remaining] = topology.monitors;
  if (first === undefined) {
    throw new Error("A validated topology must contain a monitor");
  }

  let best = first;
  let bestOverlap = intersectionArea(rect, first.bounds);
  let bestDistance = bestOverlap > 0 ? 0 : centerDistance(rect, first.bounds);
  for (const monitor of remaining) {
    const overlap = intersectionArea(rect, monitor.bounds);
    const distance = overlap > 0 ? 0 : centerDistance(rect, monitor.bounds);
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && distance < bestDistance)
    ) {
      best = monitor;
      bestOverlap = overlap;
      bestDistance = distance;
    }
  }
  return best;
};

/** Alias using the active-window terminology. */
export const currentMonitorForRect = monitorForRect;
