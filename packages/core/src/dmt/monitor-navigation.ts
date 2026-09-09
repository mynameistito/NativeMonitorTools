import { Effect } from "effect";

import { MonitorNotFound } from "../errors";
import { orderMonitors } from "../monitor";
import type { MonitorSnapshot, MonitorTopology } from "../monitor";
import type { MonitorId } from "../monitor-id";

/** All expected failures from deterministic monitor navigation. */
export type MonitorNavigationError = MonitorNotFound;

const monitorNotFound = (monitorId: MonitorId): MonitorNotFound =>
  new MonitorNotFound({ selector: monitorId });

const selectedMonitor = (
  topology: MonitorTopology,
  currentId: MonitorId,
  delta: number
): Effect.Effect<MonitorSnapshot, MonitorNavigationError> => {
  const monitors = orderMonitors(topology.monitors);
  const currentIndex = monitors.findIndex(
    (monitor) => monitor.id === currentId
  );
  if (currentIndex === -1) {
    return Effect.fail(monitorNotFound(currentId));
  }
  if (monitors.length === 0) {
    return Effect.fail(monitorNotFound(currentId));
  }

  const normalizedDelta = Number.isSafeInteger(delta) ? delta : 0;
  const index =
    (((currentIndex + normalizedDelta) % monitors.length) + monitors.length) %
    monitors.length;
  const monitor = monitors[index];
  if (monitor === undefined) {
    return Effect.fail(monitorNotFound(currentId));
  }
  return Effect.succeed(monitor);
};

/**
 * Select a monitor at a deterministic signed offset from the current monitor.
 *
 * Monitors are ordered by desktop coordinates using the core topology order,
 * so negative coordinates and equal-position primary tie-breakers are stable.
 *
 * @param topology - The validated monitor topology.
 * @param currentId - Current monitor identity.
 * @param delta - Signed number of positions to move, wrapping at the ends.
 * @returns The selected monitor or a typed not-found failure.
 */
export const selectMonitorAtOffset = (
  topology: MonitorTopology,
  currentId: MonitorId,
  delta: number
): Effect.Effect<MonitorSnapshot, MonitorNavigationError> =>
  selectedMonitor(topology, currentId, delta);

/**
 * Select the next monitor, wrapping to the first ordered monitor.
 *
 * @param topology - The validated monitor topology.
 * @param currentId - Current monitor identity.
 * @returns The next monitor or a typed not-found failure.
 */
export const selectNextMonitor = (
  topology: MonitorTopology,
  currentId: MonitorId
): Effect.Effect<MonitorSnapshot, MonitorNavigationError> =>
  selectedMonitor(topology, currentId, 1);

/**
 * Select the previous monitor, wrapping to the last ordered monitor.
 *
 * @param topology - The validated monitor topology.
 * @param currentId - Current monitor identity.
 * @returns The previous monitor or a typed not-found failure.
 */
export const selectPreviousMonitor = (
  topology: MonitorTopology,
  currentId: MonitorId
): Effect.Effect<MonitorSnapshot, MonitorNavigationError> =>
  selectedMonitor(topology, currentId, -1);

/** Alias for `selectNextMonitor`. */
export const nextMonitor = selectNextMonitor;

/** Alias for `selectPreviousMonitor`. */
export const previousMonitor = selectPreviousMonitor;
