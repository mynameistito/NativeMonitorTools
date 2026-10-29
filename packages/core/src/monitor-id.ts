/* oxlint-disable anti-slop/no-runtime-typeof -- Identity input is a deliberate string-or-parts parser boundary. */

import { Effect } from "effect";

import { InvalidMonitorId } from "./errors";

declare const monitorIdBrand: unique symbol;

/** A normalized, stable identity for one physical display. */
export type MonitorId = string & {
  readonly [monitorIdBrand]: "MonitorId";
};

/** Stable identity material supplied by a platform adapter. */
export type MonitorIdentity =
  | string
  | {
      readonly devicePath?: string;
      readonly edid?: string;
      readonly serialNumber?: string;
    };

const normalizeIdentity = (input: string): string =>
  input.trim().replaceAll(/\s+/gu, " ");

/**
 * Parse an already-known monitor identity.
 *
 * The parser trims insignificant whitespace but otherwise preserves the source
 * identity. Platform adapters should pass a device path, EDID, or serial rather
 * than a user-editable display name.
 *
 * @param input - The untrusted identity string.
 * @returns An Effect that succeeds with a stable MonitorId or fails with InvalidMonitorId.
 */
export const parseMonitorId = (
  input: string
): Effect.Effect<MonitorId, InvalidMonitorId> => {
  const normalized = normalizeIdentity(input);
  if (normalized.length === 0) {
    return Effect.fail(
      new InvalidMonitorId({
        input,
        reason: "Monitor identity cannot be empty",
      })
    );
  }

  // SAFETY: The non-empty invariant is established immediately above and the brand is private to this module.
  return Effect.succeed(normalized as MonitorId);
};

/**
 * Derive a stable monitor identity from platform-provided identity material.
 *
 * Device paths take precedence over EDIDs and serial numbers because they are
 * the least likely to collide. The source prefix prevents two identity kinds
 * with the same textual value from becoming the same monitor.
 *
 * @param identity - A stable string or identity parts from an adapter.
 * @returns An Effect that succeeds with a stable MonitorId or fails with InvalidMonitorId.
 */
export const monitorIdFromIdentity = (
  identity: MonitorIdentity
): Effect.Effect<MonitorId, InvalidMonitorId> => {
  if (typeof identity === "string") {
    return parseMonitorId(identity);
  }

  let source: { readonly kind: string; readonly value: string } | undefined;
  if (identity.devicePath !== undefined) {
    source = { kind: "device", value: identity.devicePath };
  } else if (identity.edid !== undefined) {
    source = { kind: "edid", value: identity.edid };
  } else if (identity.serialNumber !== undefined) {
    source = { kind: "serial", value: identity.serialNumber };
  }

  if (source === undefined) {
    return Effect.fail(
      new InvalidMonitorId({
        input: "",
        reason:
          "Monitor identity requires a device path, EDID, or serial number",
      })
    );
  }

  const normalizedValue = normalizeIdentity(source.value);
  if (normalizedValue.length === 0) {
    return Effect.fail(
      new InvalidMonitorId({
        input: source.value,
        reason: "Monitor identity value cannot be empty",
      })
    );
  }
  return parseMonitorId(`${source.kind}:${normalizedValue}`);
};

/** Compare two monitor identities by their normalized stable value. */
export const monitorIdsEqual = (left: MonitorId, right: MonitorId): boolean =>
  left === right;

/** Convert a MonitorId to its serialized string representation. */
export const monitorIdToString = (id: MonitorId): string => id;

/** Alias for parsing a stable identifier supplied directly by an adapter. */
export const makeMonitorId = parseMonitorId;

/** Alias for deriving a stable identifier from platform identity material. */
export const createMonitorId = monitorIdFromIdentity;
