import { Data } from "effect";

import type { CapabilityName } from "./capabilities";

/** Returned when a native capability is present but its platform call fails. */
export class NativePlatformError extends Data.TaggedError(
  "NativePlatformError"
)<{
  readonly capability: CapabilityName;
  readonly reason: string;
}> {}
