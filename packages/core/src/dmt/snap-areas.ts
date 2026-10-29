import type { Rect } from "../geometry";
import { orderMonitors } from "../monitor";
import type { MonitorSnapshot, MonitorTopology } from "../monitor";
import type { MonitorId } from "../monitor-id";
import type { UserDefinedArea } from "./user-areas";

/** The system-defined shapes understood by the DMT snap commands. */
export type SnapAreaKind =
  | "SuperSize"
  | "Full"
  | "LeftHalf"
  | "RightHalf"
  | "TopHalf"
  | "BottomHalf"
  | "TopLeftQuarter"
  | "TopRightQuarter"
  | "BottomLeftQuarter"
  | "BottomRightQuarter";

/** Identifies whether a snap area was supplied by DMT or by a user. */
export type SnapAreaSource = "System" | "User";

/** A named rectangle that can be used as a window placement target. */
export interface SnapArea {
  /** Stable name for the area within its monitor group. */
  readonly id: string;
  /** The geometric shape represented by a system area. */
  readonly kind: SnapAreaKind | "User";
  /** Human-readable area name. */
  readonly name: string;
  /** The desktop rectangle occupied by the area. */
  readonly rect: Rect;
  /** Whether this area is built in or user supplied. */
  readonly source: SnapAreaSource;
}

/** System snap areas belonging to one monitor. */
export interface SnapAreaGroup {
  /** The monitor whose usable work area is divided. */
  readonly monitorId: MonitorId;
  /** Whether the group belongs to the primary monitor. */
  readonly isPrimary: boolean;
  /** Areas in stable system order. */
  readonly areas: readonly SnapArea[];
}

const copyRect = (rect: Rect): Rect => ({
  height: rect.height,
  width: rect.width,
  x: rect.x,
  y: rect.y,
});

const area = (id: SnapAreaKind, name: string, rect: Rect): SnapArea => ({
  id,
  kind: id,
  name,
  rect: copyRect(rect),
  source: "System",
});

/**
 * Build the full, half, and quarter areas for one usable monitor rectangle.
 *
 * The second half receives the remainder when a dimension is odd, so the
 * system areas cover the entire work area without losing a pixel.
 *
 * @param workArea - The usable rectangle to divide.
 * @returns The nine system-defined areas in DMT numpad order.
 */
export const makeSystemSnapAreas = (workArea: Rect): readonly SnapArea[] => {
  const halfWidth = Math.floor(workArea.width / 2);
  const halfHeight = Math.floor(workArea.height / 2);
  const rightWidth = workArea.width - halfWidth;
  const bottomHeight = workArea.height - halfHeight;
  const leftX = workArea.x;
  const rightX = workArea.x + halfWidth;
  const topY = workArea.y;
  const bottomY = workArea.y + halfHeight;

  const leftHalf: Rect = {
    height: workArea.height,
    width: halfWidth,
    x: leftX,
    y: workArea.y,
  };
  const rightHalf: Rect = {
    height: workArea.height,
    width: rightWidth,
    x: rightX,
    y: workArea.y,
  };
  const topHalf: Rect = {
    height: halfHeight,
    width: workArea.width,
    x: workArea.x,
    y: topY,
  };
  const bottomHalf: Rect = {
    height: bottomHeight,
    width: workArea.width,
    x: workArea.x,
    y: bottomY,
  };
  const topLeftQuarter: Rect = {
    height: halfHeight,
    width: halfWidth,
    x: leftX,
    y: topY,
  };
  const topRightQuarter: Rect = {
    height: halfHeight,
    width: rightWidth,
    x: rightX,
    y: topY,
  };
  const bottomLeftQuarter: Rect = {
    height: bottomHeight,
    width: halfWidth,
    x: leftX,
    y: bottomY,
  };
  const bottomRightQuarter: Rect = {
    height: bottomHeight,
    width: rightWidth,
    x: rightX,
    y: bottomY,
  };

  return [
    area("BottomLeftQuarter", "Bottom-left quarter", bottomLeftQuarter),
    area("BottomHalf", "Bottom half", bottomHalf),
    area("BottomRightQuarter", "Bottom-right quarter", bottomRightQuarter),
    area("LeftHalf", "Left half", leftHalf),
    area("Full", "Full", workArea),
    area("RightHalf", "Right half", rightHalf),
    area("TopLeftQuarter", "Top-left quarter", topLeftQuarter),
    area("TopHalf", "Top half", topHalf),
    area("TopRightQuarter", "Top-right quarter", topRightQuarter),
  ];
};

/**
 * Build DMT's `SDA0` area covering the virtual working rectangle.
 *
 * The legacy implementation uses the bounding rectangle of all monitor work
 * areas. This deliberately remains a rectangle rather than a union, matching
 * the coordinates accepted by the later Windows placement adapter.
 *
 * @param workArea - The virtual working rectangle.
 * @returns The supersize system snap area.
 */
export const makeSuperSizeSnapArea = (workArea: Rect): SnapArea => ({
  ...area("SuperSize", "Super size", workArea),
  id: "SDA0",
});

/** Alias for callers that use the noun-first DMT terminology. */
export const systemSnapAreas = makeSystemSnapAreas;

/** Alias naming the built-in areas explicitly. */
export const systemDefinedSnapAreas = makeSystemSnapAreas;

/**
 * Return the usable area used by placement algorithms for a monitor.
 *
 * Platform adapters may omit `workArea`; in that case the monitor bounds are
 * the only usable rectangle available to the platform-independent core.
 *
 * @param monitor - A monitor snapshot.
 * @returns A copied work area or bounds rectangle.
 */
export const usableMonitorArea = (monitor: MonitorSnapshot): Rect =>
  copyRect(monitor.workArea ?? monitor.bounds);

/**
 * Build system-area groups with the primary monitor first.
 *
 * Grouping is independent of desktop coordinates. This keeps the primary
 * monitor's commands stable when a negative-coordinate monitor is added.
 *
 * @param topology - The validated monitor topology.
 * @returns One system-area group per monitor, primary group first.
 */
export const makeSystemSnapAreaGroups = (
  topology: MonitorTopology
): readonly SnapAreaGroup[] => {
  const ordered = orderMonitors(topology.monitors);
  const primary = ordered.find((monitor) => monitor.id === topology.primaryId);
  const nonPrimary = ordered.filter(
    (monitor) => monitor.id !== topology.primaryId
  );
  const monitors =
    primary === undefined ? nonPrimary : [primary, ...nonPrimary];

  return monitors.map((monitor) => ({
    areas: makeSystemSnapAreas(usableMonitorArea(monitor)),
    isPrimary: monitor.id === topology.primaryId,
    monitorId: monitor.id,
  }));
};

/** Alias emphasizing that the result is grouped per monitor. */
export const systemSnapAreaGroups = makeSystemSnapAreaGroups;

/** Alias naming the built-in groups explicitly. */
export const systemDefinedSnapAreaGroups = makeSystemSnapAreaGroups;

/**
 * Flatten primary-first system-area groups into one deterministic collection.
 *
 * @param topology - The validated monitor topology.
 * @returns The SDA0 supersize area followed by primary-first monitor areas.
 */
export const makeSystemSnapAreasForTopology = (
  topology: MonitorTopology
): readonly SnapArea[] => {
  const workAreas = topology.monitors.map(usableMonitorArea);
  const [first, ...remaining] = workAreas;
  if (first === undefined) {
    return [];
  }

  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const workArea of remaining) {
    left = Math.min(left, workArea.x);
    top = Math.min(top, workArea.y);
    right = Math.max(right, workArea.x + workArea.width);
    bottom = Math.max(bottom, workArea.y + workArea.height);
  }
  const virtualWorkArea: Rect = {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  };

  return [
    makeSuperSizeSnapArea(virtualWorkArea),
    ...makeSystemSnapAreaGroups(topology).flatMap((group) => group.areas),
  ];
};

/** Alias for the flattened topology operation. */
export const systemSnapAreasForTopology = makeSystemSnapAreasForTopology;

/**
 * Convert validated DMT user areas into snap-area targets.
 *
 * User-area identities are slot-based (`UDA0` through `UDA99`) and do not
 * include a monitor name, so renaming or reordering monitors cannot change a
 * persisted user-area identity.
 *
 * @param areas - Validated user areas.
 * @returns User snap areas in their supplied slot order.
 */
export const makeUserDefinedSnapAreas = (
  areas: readonly UserDefinedArea[]
): readonly SnapArea[] =>
  areas.map((userArea) => ({
    id: `UDA${userArea.index}`,
    kind: "User",
    name: userArea.name,
    rect: copyRect(userArea.rect),
    source: "User",
  }));

/** Alias using the shorter user-area terminology. */
export const userDefinedSnapAreas = makeUserDefinedSnapAreas;
