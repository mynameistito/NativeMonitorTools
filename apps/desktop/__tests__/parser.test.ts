import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import { CliParseError, parseCliArgs } from "../src/cli/parser";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const failure = <A, E>(effect: Effect.Effect<A, E>): E => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected a parser failure");
  }
  const found = Cause.findError(exit.cause);
  if (!Result.isSuccess(found)) {
    throw new Error("Expected a typed parser failure");
  }
  return found.success;
};

describe("desktop CLI parser", () => {
  it("parses profile apply flags into a discriminated command", () => {
    const command = run(
      parseCliArgs(["profile", "apply", "gaming", "--dry-run", "--json"])
    );

    expect(command).toMatchObject({
      _tag: "ProfileApply",
      dryRun: true,
      format: "json",
      name: "gaming",
    });
  });

  it("keeps capability placeholders parseable so the application can reject them explicitly", () => {
    const command = run(parseCliArgs(["wallpaper", "set", "image.png"]));

    expect(command).toMatchObject({
      _tag: "Unsupported",
      arguments: ["set", "image.png"],
      capability: "wallpaper",
    });
  });

  it("rejects unknown options as typed parse failures", () => {
    const error = failure(parseCliArgs(["monitor", "list", "--nope"]));

    expect(error).toBeInstanceOf(CliParseError);
    expect(error._tag).toBe("CliParseError");
  });
});
