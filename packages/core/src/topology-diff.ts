import { displayModesEqual } from "./display-mode";
import { pointsEqual, rectsEqual } from "./geometry";
import { orderMonitors } from "./monitor";
import type { MonitorSnapshot, MonitorTopology } from "./monitor";
import type { MonitorId } from "./monitor-id";

/** A field-level change detected for an existing monitor. */
export type MonitorChangeKind =
  | "Moved"
  | "ModeChanged"
  | "Renamed"
  | "PrimaryChanged"
  | "WorkAreaChanged";

/** The before/after state for a monitor whose configuration changed. */
export interface MonitorChanged {
  readonly id: MonitorId;
  readonly kinds: readonly MonitorChangeKind[];
  readonly before: MonitorSnapshot;
  readonly after: MonitorSnapshot;
}

/** A deterministic comparison of two monitor topologies. */
export interface TopologyDiff {
  readonly added: readonly MonitorSnapshot[];
  readonly removed: readonly MonitorSnapshot[];
  readonly changed: readonly MonitorChanged[];
  readonly isChanged: boolean;
}

const sameWorkArea = (
  left: MonitorSnapshot,
  right: MonitorSnapshot
): boolean => {
  if (left.workArea === undefined) {
    return right.workArea === undefined;
  }
  return (
    right.workArea !== undefined && rectsEqual(left.workArea, right.workArea)
  );
};

/**
 * Compute a deterministic, side-effect-free diff between two topologies.
 *
 * @param before - The currently observed topology.
 * @param after - The newly observed topology.
 * @returns Added, removed, and changed monitors in stable coordinate order.
 */
export const diffTopologies = (
  before: MonitorTopology,
  after: MonitorTopology
): TopologyDiff => {
  const beforeById = new Map(
    before.monitors.map((monitor) => [monitor.id, monitor])
  );
  const afterById = new Map(
    after.monitors.map((monitor) => [monitor.id, monitor])
  );
  const added = orderMonitors(
    after.monitors.filter((monitor) => !beforeById.has(monitor.id))
  );
  const removed = orderMonitors(
    before.monitors.filter((monitor) => !afterById.has(monitor.id))
  );
  const changed: MonitorChanged[] = [];

  for (const afterMonitor of orderMonitors(after.monitors)) {
    const beforeMonitor = beforeById.get(afterMonitor.id);
    if (beforeMonitor === undefined) {
      continue;
    }

    const kinds: MonitorChangeKind[] = [];
    if (
      !pointsEqual(
        { x: beforeMonitor.bounds.x, y: beforeMonitor.bounds.y },
        { x: afterMonitor.bounds.x, y: afterMonitor.bounds.y }
      )
    ) {
      kinds.push("Moved");
    }
    if (!displayModesEqual(beforeMonitor.mode, afterMonitor.mode)) {
      kinds.push("ModeChanged");
    }
    if (beforeMonitor.name !== afterMonitor.name) {
      kinds.push("Renamed");
    }
    if (beforeMonitor.isPrimary !== afterMonitor.isPrimary) {
      kinds.push("PrimaryChanged");
    }
    if (!sameWorkArea(beforeMonitor, afterMonitor)) {
      kinds.push("WorkAreaChanged");
    }

    if (kinds.length > 0) {
      changed.push({
        after: afterMonitor,
        before: beforeMonitor,
        id: afterMonitor.id,
        kinds,
      });
    }
  }

  return {
    added,
    changed,
    isChanged: added.length > 0 || removed.length > 0 || changed.length > 0,
    removed,
  };
};

/** Alias using the singular noun for callers that compare one topology pair. */
export const diffTopology = diffTopologies;
