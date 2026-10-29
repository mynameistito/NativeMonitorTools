/* oxlint-disable max-classes-per-file -- The domain error vocabulary is intentionally colocated and each error remains a distinct typed value. */

import { Data } from "effect";

/** A monitor identifier could not be parsed into a stable identity. */
export class InvalidMonitorId extends Data.TaggedError("InvalidMonitorId")<{
  readonly input: string;
  readonly reason: string;
}> {}

/** A point or rectangle contains a non-finite or otherwise invalid value. */
export class InvalidGeometry extends Data.TaggedError("InvalidGeometry")<{
  readonly value: unknown;
  readonly reason: string;
}> {}

/** A display mode contains an unsupported dimension or refresh rate. */
export class InvalidDisplayMode extends Data.TaggedError("InvalidDisplayMode")<{
  readonly value: unknown;
  readonly reason: string;
}> {}

/** A monitor snapshot or topology violates a domain invariant. */
export class InvalidTopology extends Data.TaggedError("InvalidTopology")<{
  readonly reason: string;
  readonly monitorId?: string;
}> {}

/** A selector is empty, malformed, or outside the supported selector grammar. */
export class InvalidMonitorSelector extends Data.TaggedError(
  "InvalidMonitorSelector"
)<{
  readonly input: string;
  readonly reason: string;
}> {}

/** A valid selector did not match any monitor in the supplied topology. */
export class MonitorNotFound extends Data.TaggedError("MonitorNotFound")<{
  readonly selector: string;
}> {}

/** A name selector matched more than one monitor. */
export class AmbiguousMonitorSelector extends Data.TaggedError(
  "AmbiguousMonitorSelector"
)<{
  readonly selector: string;
  readonly matches: readonly string[];
}> {}

/** The current-monitor selector was used without a usable current monitor. */
export class CurrentMonitorUnavailable extends Data.TaggedError(
  "CurrentMonitorUnavailable"
)<Record<never, never>> {}

/** A serialized display profile is malformed or violates its schema. */
export class InvalidDisplayProfile extends Data.TaggedError(
  "InvalidDisplayProfile"
)<{
  readonly path: string;
  readonly reason: string;
}> {}

/** A display profile cannot be planned against the current topology. */
export class InvalidApplyPlan extends Data.TaggedError("InvalidApplyPlan")<{
  readonly reason: string;
  readonly monitorId?: string;
}> {}

/** An EDID base block is too short or contains malformed encoded data. */
export class InvalidEdid extends Data.TaggedError("InvalidEdid")<{
  readonly inputLength: number;
  readonly reason: string;
  readonly offset?: number;
}> {}
