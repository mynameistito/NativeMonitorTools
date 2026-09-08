import { Effect } from "effect";
/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- Profile parsing is the explicit untrusted JSON boundary. */

import { makeDisplayMode } from "./display-mode";
import type { DisplayMode } from "./display-mode";
import { InvalidDisplayProfile } from "./errors";
import { makePoint } from "./geometry";
import type { Point } from "./geometry";
import type { MonitorTopology } from "./monitor";
import { parseMonitorId } from "./monitor-id";
import type { MonitorId } from "./monitor-id";

/** One monitor's desired position and display mode in a profile. */
export interface DisplayProfileMonitor {
  readonly id: MonitorId;
  readonly position: Point;
  readonly mode: DisplayMode;
  readonly isPrimary: boolean;
  readonly name?: string;
}

/** The versioned, platform-independent display profile format. */
export interface DisplayProfile {
  readonly version: 1;
  readonly monitors: readonly DisplayProfileMonitor[];
}

/** Input accepted when constructing a profile from already-parsed domain values. */
export interface DisplayProfileInput {
  readonly monitors: readonly DisplayProfileMonitor[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const invalid = (
  path: string,
  reason: string
): Effect.Effect<never, InvalidDisplayProfile> =>
  Effect.fail(new InvalidDisplayProfile({ path, reason }));

const compareProfileMonitors = (
  left: DisplayProfileMonitor,
  right: DisplayProfileMonitor
): number => {
  const xOrder = left.position.x - right.position.x;
  if (xOrder !== 0) {
    return xOrder;
  }
  const yOrder = left.position.y - right.position.y;
  if (yOrder !== 0) {
    return yOrder;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
};

const normalizedName = (
  value: unknown,
  path: string
): Effect.Effect<string | null, InvalidDisplayProfile> => {
  if (value === undefined) {
    return Effect.succeed(null);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid(
      path,
      "Monitor name must be a non-empty string when present"
    );
  }
  return Effect.succeed(value.trim());
};

const normalizeProfileMonitor = (
  input: unknown,
  path: string
): Effect.Effect<DisplayProfileMonitor, InvalidDisplayProfile> =>
  Effect.gen(function* normalizeProfileMonitorEffect() {
    if (!isRecord(input)) {
      return yield* invalid(path, "Profile monitor must be an object");
    }
    if (typeof input.id !== "string") {
      return yield* invalid(
        `${path}.id`,
        "Profile monitor id must be a string"
      );
    }
    const id = yield* parseMonitorId(input.id).pipe(
      Effect.mapError(
        (error) =>
          new InvalidDisplayProfile({
            path: `${path}.id`,
            reason: error.reason,
          })
      )
    );

    if (
      !isRecord(input.position) ||
      !isFiniteNumber(input.position.x) ||
      !isFiniteNumber(input.position.y)
    ) {
      return yield* invalid(
        `${path}.position`,
        "Profile position requires finite x and y numbers"
      );
    }
    const position = yield* makePoint({
      x: input.position.x,
      y: input.position.y,
    }).pipe(
      Effect.mapError(
        (error) =>
          new InvalidDisplayProfile({
            path: `${path}.position`,
            reason: error.reason,
          })
      )
    );

    if (!isRecord(input.mode)) {
      return yield* invalid(`${path}.mode`, "Profile mode must be an object");
    }
    const { bitsPerPixel, height, refreshRate, width } = input.mode;
    const hasValidModeNumbers =
      isFiniteNumber(width) &&
      isFiniteNumber(height) &&
      isFiniteNumber(refreshRate);
    const hasValidColorDepth =
      bitsPerPixel === undefined || isFiniteNumber(bitsPerPixel);
    if (!hasValidModeNumbers || !hasValidColorDepth) {
      return yield* invalid(
        `${path}.mode`,
        "Profile mode contains an invalid number"
      );
    }
    const modeInput =
      bitsPerPixel === undefined
        ? {
            height,
            refreshRate,
            width,
          }
        : {
            bitsPerPixel,
            height,
            refreshRate,
            width,
          };
    const mode = yield* makeDisplayMode(modeInput).pipe(
      Effect.mapError(
        (error) =>
          new InvalidDisplayProfile({
            path: `${path}.mode`,
            reason: error.reason,
          })
      )
    );

    if (typeof input.isPrimary !== "boolean") {
      return yield* invalid(
        `${path}.isPrimary`,
        "Profile primary flag must be boolean"
      );
    }
    const name = yield* normalizedName(input.name, `${path}.name`);
    const monitor = {
      id,
      isPrimary: input.isPrimary,
      mode,
      position,
    };
    if (name === null) {
      return monitor;
    }
    return { ...monitor, name };
  });

const normalizeProfile = (
  input: unknown
): Effect.Effect<DisplayProfile, InvalidDisplayProfile> =>
  Effect.gen(function* normalizeProfileEffect() {
    if (!isRecord(input)) {
      return yield* invalid("$", "Display profile must be an object");
    }
    if (input.version !== 1) {
      return yield* invalid(
        "version",
        "Only display profile version 1 is supported"
      );
    }
    if (!Array.isArray(input.monitors) || input.monitors.length === 0) {
      return yield* invalid(
        "monitors",
        "Display profile must contain at least one monitor"
      );
    }

    const monitors: DisplayProfileMonitor[] = [];
    const ids = new Set<MonitorId>();
    let primaryCount = 0;
    for (const [index, value] of input.monitors.entries()) {
      const monitor = yield* normalizeProfileMonitor(
        value,
        `monitors[${index}]`
      );
      if (ids.has(monitor.id)) {
        return yield* invalid(
          `monitors[${index}].id`,
          "Profile monitor ids must be unique"
        );
      }
      ids.add(monitor.id);
      if (monitor.isPrimary) {
        primaryCount += 1;
      }
      monitors.push(monitor);
    }

    if (primaryCount !== 1) {
      return yield* invalid(
        "monitors",
        "Display profile must contain exactly one primary monitor"
      );
    }
    return { monitors: monitors.toSorted(compareProfileMonitors), version: 1 };
  });

/**
 * Validate and normalize a profile assembled from domain values.
 *
 * @param input - The desired monitor configurations.
 * @returns An Effect that succeeds with a canonical DisplayProfile or fails with InvalidDisplayProfile.
 */
export const makeDisplayProfile = (
  input: DisplayProfileInput
): Effect.Effect<DisplayProfile, InvalidDisplayProfile> =>
  normalizeProfile({ monitors: input.monitors, version: 1 });

/**
 * Validate unknown profile data, such as a parsed JSON document.
 *
 * @param input - The unknown profile value.
 * @returns An Effect that succeeds with a canonical DisplayProfile or fails with InvalidDisplayProfile.
 */
export const validateDisplayProfile = (
  input: unknown
): Effect.Effect<DisplayProfile, InvalidDisplayProfile> =>
  normalizeProfile(input);

/**
 * Parse a serialized display profile.
 *
 * @param input - A JSON profile document.
 * @returns An Effect that succeeds with a DisplayProfile or fails with InvalidDisplayProfile.
 */
export const parseDisplayProfile = (
  input: string
): Effect.Effect<DisplayProfile, InvalidDisplayProfile> => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    return invalid("$", "Display profile is not valid JSON");
  }
  return validateDisplayProfile(decoded);
};

/**
 * Serialize a validated profile into canonical JSON.
 *
 * @param profile - The profile to serialize.
 * @returns Stable JSON suitable for persistence and round-trip parsing.
 */
export const serializeDisplayProfile = (profile: DisplayProfile): string => {
  const monitors = profile.monitors
    .toSorted(compareProfileMonitors)
    .map((monitor) => {
      const serialized = {
        id: monitor.id,
        isPrimary: monitor.isPrimary,
        mode: monitor.mode,
        position: monitor.position,
      };
      if (monitor.name === undefined) {
        return serialized;
      }
      return { ...serialized, name: monitor.name };
    });
  return JSON.stringify({ monitors, version: 1 });
};

/** Create a desired profile from a currently observed topology. */
export const profileFromTopology = (
  topology: MonitorTopology
): Effect.Effect<DisplayProfile, InvalidDisplayProfile> =>
  makeDisplayProfile({
    monitors: topology.monitors.map((monitor) => ({
      id: monitor.id,
      isPrimary: monitor.isPrimary,
      mode: monitor.mode,
      name: monitor.name,
      position: { x: monitor.bounds.x, y: monitor.bounds.y },
    })),
  });

/** Compare two profiles by canonical serialized representation. */
export const displayProfilesEqual = (
  left: DisplayProfile,
  right: DisplayProfile
): boolean => serializeDisplayProfile(left) === serializeDisplayProfile(right);
