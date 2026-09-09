import { Data } from "effect";

/** A host filesystem operation failed while accessing the profile store. */
/* oxlint-disable sonarjs/max-union-size -- These operation tags are the store's stable diagnostics vocabulary. */
export class ProfileStoreError extends Data.TaggedError("ProfileStoreError")<{
  readonly operation: "list" | "read" | "rename" | "temporary-file" | "write";
  readonly path: string;
  readonly cause: unknown;
}> {}
