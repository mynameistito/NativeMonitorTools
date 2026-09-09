import { Data } from "effect";

/** A profile was requested but no matching JSON file exists. */
export class ProfileNotFound extends Data.TaggedError("ProfileNotFound")<{
  readonly name: string;
}> {}
