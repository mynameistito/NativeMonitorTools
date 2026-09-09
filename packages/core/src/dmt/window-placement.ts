import type { Rect } from "../geometry";
import type { MonitorSnapshot } from "../monitor";
import type { MonitorId } from "../monitor-id";
import { usableMonitorArea } from "./snap-areas";

/** The tagged window states relevant to a platform placement plan. */
export type WindowState =
  | { readonly _tag: "Normal" }
  | { readonly _tag: "Minimized" }
  | { readonly _tag: "Maximized" };

/** A normal-state window. */
export const normalWindowState: WindowState = { _tag: "Normal" };

/** A minimized window state. */
export const minimizedWindowState: WindowState = { _tag: "Minimized" };

/** A maximized window state. */
export const maximizedWindowState: WindowState = { _tag: "Maximized" };

/** A pure request to translate a window from one monitor to another. */
export interface WindowPlacementInput {
  /** Current normal-position rectangle. */
  readonly rect: Rect;
  /** Monitor containing the current window position. */
  readonly sourceMonitor: MonitorSnapshot;
  /** Destination monitor. */
  readonly targetMonitor: MonitorSnapshot;
  /** Current show state; omitted values are treated as normal. */
  readonly state?: WindowState;
}

/** Alternate input spelling used by platform adapters. */
export interface WindowPlacementInputWithWindowRect {
  /** Current normal-position rectangle. */
  readonly windowRect: Rect;
  /** Monitor containing the current window position. */
  readonly sourceMonitor: MonitorSnapshot;
  /** Destination monitor. */
  readonly targetMonitor: MonitorSnapshot;
  /** Current show state; omitted values are treated as normal. */
  readonly state?: WindowState;
}

/** A platform-independent operation in a window placement plan. */
export type WindowPlacementOperation =
  | { readonly _tag: "Restore" }
  | { readonly _tag: "Move"; readonly rect: Rect }
  | { readonly _tag: "SetState"; readonly state: WindowState };

/** The result of planning a move or snap without performing it. */
export interface WindowPlacementPlan {
  /** Original normal-position rectangle. */
  readonly from: Rect;
  /** Target normal-position rectangle. */
  readonly targetRect: Rect;
  /** Alias for `targetRect` convenient for geometry consumers. */
  readonly rect: Rect;
  /** State before the plan is applied. */
  readonly previousState: WindowState;
  /** State after the plan is applied. */
  readonly state: WindowState;
  /** Monitors involved in the translation. */
  readonly sourceMonitorId?: MonitorId;
  readonly targetMonitorId?: MonitorId;
  /** Ordered abstract steps for an OS adapter to interpret. */
  readonly operations: readonly WindowPlacementOperation[];
}

const copyRect = (rect: Rect): Rect => ({
  height: rect.height,
  width: rect.width,
  x: rect.x,
  y: rect.y,
});

const stateTag = (state: WindowState): WindowState["_tag"] => state._tag;

const normalizedState = (state: WindowState | undefined): WindowState =>
  state ?? normalWindowState;

const rectFromInput = (
  input: WindowPlacementInput | WindowPlacementInputWithWindowRect
): Rect => ("rect" in input ? input.rect : input.windowRect);

interface ClampedAxis {
  readonly start: number;
  readonly size: number;
}

const clampAxis = (
  start: number,
  size: number,
  areaStart: number,
  areaSize: number
): ClampedAxis => {
  const clampedSize = Math.min(size, areaSize);
  const latestStart = areaStart + areaSize - clampedSize;
  return {
    size: clampedSize,
    start: Math.min(Math.max(start, areaStart), latestStart),
  };
};

/**
 * Clamp a rectangle to a usable work area.
 *
 * Position is clamped while preserving dimensions whenever possible. If a
 * window is larger than the usable area, the corresponding dimension is
 * reduced so the returned rectangle is usable rather than left off-screen.
 *
 * @param rect - Rectangle to constrain.
 * @param usableArea - Destination usable rectangle.
 * @returns A new rectangle contained by `usableArea`.
 */
export const clampRectToUsableArea = (rect: Rect, usableArea: Rect): Rect => {
  const horizontal = clampAxis(
    rect.x,
    rect.width,
    usableArea.x,
    usableArea.width
  );
  const vertical = clampAxis(
    rect.y,
    rect.height,
    usableArea.y,
    usableArea.height
  );
  return {
    height: vertical.size,
    width: horizontal.size,
    x: horizontal.start,
    y: vertical.start,
  };
};

/** Alias using the shorter rectangle terminology. */
export const clampRect = clampRectToUsableArea;

/**
 * Translate a rectangle by its relative offset between two work areas.
 *
 * @param rect - Source rectangle in desktop coordinates.
 * @param sourceWorkArea - Work area containing the source offset.
 * @param targetWorkArea - Work area receiving the translated offset.
 * @returns A rectangle with unchanged size at the corresponding target offset.
 */
export const translateRectBetweenWorkAreas = (
  rect: Rect,
  sourceWorkArea: Rect,
  targetWorkArea: Rect
): Rect => ({
  height: rect.height,
  width: rect.width,
  x: targetWorkArea.x + rect.x - sourceWorkArea.x,
  y: targetWorkArea.y + rect.y - sourceWorkArea.y,
});

/**
 * Translate and clamp a window's normal rectangle between monitor work areas.
 *
 * @param rect - Current normal-position rectangle.
 * @param sourceMonitor - Monitor containing the current position.
 * @param targetMonitor - Destination monitor.
 * @returns The translated rectangle clamped to the destination work area.
 */
export const translateWindowBetweenMonitors = (
  rect: Rect,
  sourceMonitor: MonitorSnapshot,
  targetMonitor: MonitorSnapshot
): Rect =>
  clampRectToUsableArea(
    translateRectBetweenWorkAreas(
      rect,
      usableMonitorArea(sourceMonitor),
      usableMonitorArea(targetMonitor)
    ),
    usableMonitorArea(targetMonitor)
  );

/** Alias for callers that name the operation after its geometric primitive. */
export const translateRectBetweenMonitors = translateWindowBetweenMonitors;

const makeOperations = (
  previousState: WindowState,
  state: WindowState,
  targetRect: Rect
): readonly WindowPlacementOperation[] => {
  const operations: WindowPlacementOperation[] = [];
  if (stateTag(previousState) !== "Normal") {
    operations.push({ _tag: "Restore" });
  }
  operations.push({ _tag: "Move", rect: copyRect(targetRect) });
  if (stateTag(state) !== "Normal") {
    operations.push({ _tag: "SetState", state });
  }
  return operations;
};

/**
 * Plan a monitor-to-monitor move while preserving a window's normal size.
 *
 * Minimized and maximized windows are represented in the plan rather than
 * touched here: the adapter can restore, move the normal rectangle, and then
 * reapply the original state without this module importing an OS API.
 *
 * @param input - Source rectangle, monitors, and optional show state.
 * @returns A deterministic placement plan.
 */
export const planWindowPlacement = (
  input: WindowPlacementInput | WindowPlacementInputWithWindowRect
): WindowPlacementPlan => {
  const previousState = normalizedState(input.state);
  const from = rectFromInput(input);
  const targetRect = translateWindowBetweenMonitors(
    from,
    input.sourceMonitor,
    input.targetMonitor
  );
  return {
    from: copyRect(from),
    operations: makeOperations(previousState, previousState, targetRect),
    previousState,
    rect: copyRect(targetRect),
    sourceMonitorId: input.sourceMonitor.id,
    state: previousState,
    targetMonitorId: input.targetMonitor.id,
    targetRect: copyRect(targetRect),
  };
};

/** Alias emphasizing that the result is only a move plan. */
export const planWindowMove = planWindowPlacement;

/**
 * Plan snapping a window to a supplied area on its current monitor.
 *
 * Snapping restores minimized/maximized windows and leaves them normal, which
 * mirrors the DMT snap command while keeping the state transition explicit.
 *
 * @param input - Window, monitor, destination area, and current state.
 * @returns A deterministic snap plan.
 */
export const planWindowSnap = (input: {
  readonly rect: Rect;
  readonly monitor: MonitorSnapshot;
  readonly area: Rect;
  readonly state?: WindowState;
}): WindowPlacementPlan => {
  const previousState = normalizedState(input.state);
  const targetRect = clampRectToUsableArea(
    input.area,
    usableMonitorArea(input.monitor)
  );
  const state: WindowState = normalWindowState;
  return {
    from: copyRect(input.rect),
    operations: makeOperations(previousState, state, targetRect),
    previousState,
    rect: copyRect(targetRect),
    sourceMonitorId: input.monitor.id,
    state,
    targetMonitorId: input.monitor.id,
    targetRect: copyRect(targetRect),
  };
};

/** Alias using the noun-first DMT terminology. */
export const snapWindowToArea = planWindowSnap;
