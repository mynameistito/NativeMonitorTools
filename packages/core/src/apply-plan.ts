import { Effect } from "effect";

import { displayModesEqual } from "./display-mode";
import type { DisplayMode } from "./display-mode";
import type { DisplayProfile, DisplayProfileMonitor } from "./display-profile";
import { InvalidApplyPlan } from "./errors";
import type { Point } from "./geometry";
import { orderMonitors } from "./monitor";
import type { MonitorSnapshot, MonitorTopology } from "./monitor";
import type { MonitorId } from "./monitor-id";

/** A requested display configuration change in deterministic execution order. */
export type ApplyOperation =
  | {
      readonly _tag: "SetDisplayMode";
      readonly monitorId: MonitorId;
      readonly from: DisplayMode;
      readonly to: DisplayMode;
    }
  | {
      readonly _tag: "MoveMonitor";
      readonly monitorId: MonitorId;
      readonly from: Point;
      readonly to: Point;
    }
  | {
      readonly _tag: "SetPrimary";
      readonly monitorId: MonitorId;
      readonly from: boolean;
      readonly to: true;
    };

/** A deterministic plan that can be previewed before a platform applies it. */
export interface ApplyPlan {
  readonly dryRun: boolean;
  readonly operations: readonly ApplyOperation[];
  readonly isNoop: boolean;
}

/** Options for generating an apply plan. Plans are dry runs by default. */
export interface ApplyPlanOptions {
  readonly dryRun?: boolean;
}

const samePosition = (
  monitor: MonitorSnapshot,
  desired: DisplayProfileMonitor
): boolean =>
  monitor.bounds.x === desired.position.x &&
  monitor.bounds.y === desired.position.y;

const monitorById = (
  profile: DisplayProfile
): ReadonlyMap<MonitorId, DisplayProfileMonitor> =>
  new Map(profile.monitors.map((monitor) => [monitor.id, monitor]));

/**
 * Generate a dry-run-first plan from a current topology to a desired profile.
 *
 * The full monitor set must be represented in the profile. Operations are
 * ordered by current desktop position and apply mode, then position, then
 * primary status for each monitor.
 *
 * @param current - The validated current topology.
 * @param desired - The validated desired profile.
 * @param options - Whether the returned plan is marked as dry-run.
 * @returns An Effect that succeeds with an ApplyPlan or fails with InvalidApplyPlan.
 */
export const generateApplyPlan = (
  current: MonitorTopology,
  desired: DisplayProfile,
  options: ApplyPlanOptions = {}
): Effect.Effect<ApplyPlan, InvalidApplyPlan> => {
  const desiredById = monitorById(desired);
  const currentIds = new Set(current.monitors.map((monitor) => monitor.id));

  for (const desiredMonitor of desired.monitors) {
    if (!currentIds.has(desiredMonitor.id)) {
      return Effect.fail(
        new InvalidApplyPlan({
          monitorId: desiredMonitor.id,
          reason:
            "Display profile references a monitor missing from the current topology",
        })
      );
    }
  }
  for (const currentMonitor of current.monitors) {
    if (!desiredById.has(currentMonitor.id)) {
      return Effect.fail(
        new InvalidApplyPlan({
          monitorId: currentMonitor.id,
          reason: "Display profile does not describe every current monitor",
        })
      );
    }
  }

  const operations: ApplyOperation[] = [];
  for (const currentMonitor of orderMonitors(current.monitors)) {
    const desiredMonitor = desiredById.get(currentMonitor.id);
    if (desiredMonitor === undefined) {
      return Effect.fail(
        new InvalidApplyPlan({
          monitorId: currentMonitor.id,
          reason: "Desired monitor lookup failed",
        })
      );
    }

    if (!displayModesEqual(currentMonitor.mode, desiredMonitor.mode)) {
      operations.push({
        _tag: "SetDisplayMode",
        from: currentMonitor.mode,
        monitorId: currentMonitor.id,
        to: desiredMonitor.mode,
      });
    }
    if (!samePosition(currentMonitor, desiredMonitor)) {
      operations.push({
        _tag: "MoveMonitor",
        from: { x: currentMonitor.bounds.x, y: currentMonitor.bounds.y },
        monitorId: currentMonitor.id,
        to: desiredMonitor.position,
      });
    }
    if (desiredMonitor.isPrimary && !currentMonitor.isPrimary) {
      operations.push({
        _tag: "SetPrimary",
        from: false,
        monitorId: currentMonitor.id,
        to: true,
      });
    }
  }

  return Effect.succeed({
    dryRun: options.dryRun ?? true,
    isNoop: operations.length === 0,
    operations,
  });
};

/** Alias emphasizing that plan generation does not perform platform mutation. */
export const planDisplayProfile = generateApplyPlan;
