import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  InvalidProfileName,
  parseProfileName,
} from "../src/storage/profile-name";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const failure = <A, E>(effect: Effect.Effect<A, E>): E => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected a profile-name failure");
  }
  const found = Cause.findError(exit.cause);
  if (!Result.isSuccess(found)) {
    throw new Error("Expected a typed profile-name failure");
  }
  return found.success;
};

describe("profile name parser", () => {
  it("accepts a portable filename component", () => {
    expect(run(parseProfileName("work-2026"))).toBe("work-2026");
  });

  it.each([
    "../outside",
    "..\\outside",
    "C:\\outside",
    ".",
    "",
    " desk",
    "CON",
  ])("rejects unsafe name %s", (input) => {
    const error = failure(parseProfileName(input));

    expect(error).toBeInstanceOf(InvalidProfileName);
    expect(error._tag).toBe("InvalidProfileName");
  });
});
