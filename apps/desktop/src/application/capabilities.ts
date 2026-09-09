import type {
  MonitorTopology,
  ApplyPlan,
  DisplayProfile,
} from "@native-monitor-tools/core";
import { Context, Data, Effect, Layer } from "effect";

import type { NativePlatformError } from "./native-platform-error";

/** A capability which is deliberately not implemented by this desktop shell. */
export type CapabilityName =
  | "cursor"
  | "display-apply"
  | "monitor"
  | "wallpaper"
  | "window";

/** Returned when a native capability has no platform adapter yet. */
export class UnsupportedCapability extends Data.TaggedError(
  "UnsupportedCapability"
)<{
  readonly capability: CapabilityName;
  readonly reason: string;
}> {}

/** Application-owned source of the current monitor topology. */
export interface MonitorSourceApi {
  readonly currentTopology: () => Effect.Effect<
    MonitorTopology,
    UnsupportedCapability | NativePlatformError
  >;
}

/** Effect service key for the current monitor topology port. */
export const MonitorSource = Context.Service<MonitorSourceApi>(
  "@native-monitor-tools/desktop/MonitorSource"
);

/** Application-owned port for mutating a display configuration. */
export interface DisplayApplierApi {
  readonly apply: (
    current: MonitorTopology,
    desired: DisplayProfile,
    plan: ApplyPlan
  ) => Effect.Effect<void, UnsupportedCapability>;
}

/** Effect service key for the display mutation port. */
export const DisplayApplier = Context.Service<DisplayApplierApi>(
  "@native-monitor-tools/desktop/DisplayApplier"
);

/** Live monitor source until the native monitor adapter is implemented. */
export const MonitorSourceUnsupported = Layer.succeed(MonitorSource, {
  currentTopology: () =>
    Effect.fail(
      new UnsupportedCapability({
        capability: "monitor",
        reason: "Monitor enumeration requires a native platform adapter",
      })
    ),
});

/** Live display applier until the native display adapter is implemented. */
export const DisplayApplierUnsupported = Layer.succeed(DisplayApplier, {
  apply: () =>
    Effect.fail(
      new UnsupportedCapability({
        capability: "display-apply",
        reason: "Display mutation requires a native platform adapter",
      })
    ),
});
