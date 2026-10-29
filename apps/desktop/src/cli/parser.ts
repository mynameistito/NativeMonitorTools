import { Data, Effect } from "effect";

import { parseProfileName } from "../storage/profile-name";
import type { ProfileName } from "../storage/profile-name";

/** Output encodings supported by the command-line boundary. */
export type OutputFormat = "json" | "text";

/** Capabilities that are reserved for a future native platform adapter. */
export type UnsupportedCommandName = "cursor" | "wallpaper" | "window";

/** A parsed command ready for the application service. */
export type CliCommand =
  | {
      readonly _tag: "Help";
      readonly format: OutputFormat;
      readonly dryRun: boolean;
    }
  | {
      readonly _tag: "MonitorList";
      readonly format: OutputFormat;
      readonly dryRun: boolean;
    }
  | {
      readonly _tag: "ProfileSave";
      readonly format: OutputFormat;
      readonly dryRun: boolean;
      readonly name: ProfileName;
    }
  | {
      readonly _tag: "ProfileList";
      readonly format: OutputFormat;
      readonly dryRun: boolean;
    }
  | {
      readonly _tag: "ProfileShow";
      readonly format: OutputFormat;
      readonly dryRun: boolean;
      readonly name: ProfileName;
    }
  | {
      readonly _tag: "ProfileDiff";
      readonly format: OutputFormat;
      readonly dryRun: boolean;
      readonly name: ProfileName;
    }
  | {
      readonly _tag: "ProfileApply";
      readonly format: OutputFormat;
      readonly dryRun: boolean;
      readonly name: ProfileName;
    }
  | {
      readonly _tag: "Unsupported";
      readonly capability: UnsupportedCommandName;
      readonly format: OutputFormat;
      readonly dryRun: boolean;
      readonly arguments: readonly string[];
    };

/** A malformed command-line invocation. */
export class CliParseError extends Data.TaggedError("CliParseError")<{
  readonly input: string;
  readonly reason: string;
}> {}

interface ParsedOptions {
  readonly format: OutputFormat;
  readonly dryRun: boolean;
  readonly positionals: readonly string[];
}

const usage =
  "Expected monitor list, profile save|list|show|diff|apply, or cursor|window|wallpaper";

/* oxlint-disable promise/prefer-await-to-callbacks -- Effect mapError is the typed error translation boundary. */
const parseOptions = (
  args: readonly string[]
): Effect.Effect<ParsedOptions, CliParseError> => {
  const positionals: string[] = [];
  let format: OutputFormat = "text";
  let dryRun = false;
  let optionsEnded = false;

  for (const argument of args) {
    if (optionsEnded) {
      positionals.push(argument);
    } else if (argument === "--") {
      optionsEnded = true;
    } else if (argument === "--json") {
      if (format === "json") {
        return Effect.fail(
          new CliParseError({
            input: argument,
            reason: "--json was supplied more than once",
          })
        );
      }
      format = "json";
    } else if (argument === "--dry-run") {
      if (dryRun) {
        return Effect.fail(
          new CliParseError({
            input: argument,
            reason: "--dry-run was supplied more than once",
          })
        );
      }
      dryRun = true;
    } else if (argument === "-h" || argument === "--help") {
      positionals.push("help");
    } else if (argument.startsWith("-")) {
      return Effect.fail(
        new CliParseError({
          input: argument,
          reason: `Unknown option: ${argument}`,
        })
      );
    } else {
      positionals.push(argument);
    }
  }

  return Effect.succeed({ dryRun, format, positionals });
};

const parseName = (
  input: string,
  args: readonly string[]
): Effect.Effect<ProfileName, CliParseError> =>
  parseProfileName(input).pipe(
    Effect.mapError(
      (error) =>
        new CliParseError({
          input: args.join(" "),
          reason: error.reason,
        })
    )
  );

const wrongArity = (
  args: readonly string[],
  expected: string
): Effect.Effect<never, CliParseError> =>
  Effect.fail(
    new CliParseError({
      input: args.join(" "),
      reason: `${expected}. ${usage}`,
    })
  );

const parseHelp = (
  args: readonly string[],
  positionals: readonly string[],
  format: OutputFormat,
  dryRun: boolean
): Effect.Effect<CliCommand, CliParseError> => {
  if (positionals.length > 1) {
    return wrongArity(args, "Help does not accept positional arguments");
  }
  return Effect.succeed({ _tag: "Help", dryRun, format });
};

const parseMonitor = (
  args: readonly string[],
  positionals: readonly string[],
  format: OutputFormat,
  dryRun: boolean
): Effect.Effect<CliCommand, CliParseError> => {
  const [, operation] = positionals;
  if (operation !== "list" || positionals.length !== 2) {
    return wrongArity(args, "The monitor command only supports `monitor list`");
  }
  return Effect.succeed({ _tag: "MonitorList", dryRun, format });
};

const parseProfile = (
  args: readonly string[],
  positionals: readonly string[],
  format: OutputFormat,
  dryRun: boolean
): Effect.Effect<CliCommand, CliParseError> =>
  Effect.gen(function* parseProfileEffect() {
    const [, operation, inputName] = positionals;
    if (operation === "list" && positionals.length === 2) {
      return { _tag: "ProfileList", dryRun, format };
    }
    if (
      operation !== "save" &&
      operation !== "show" &&
      operation !== "diff" &&
      operation !== "apply"
    ) {
      return yield* wrongArity(args, "Unknown profile operation");
    }
    if (positionals.length !== 3) {
      return yield* wrongArity(
        args,
        `profile ${operation} requires one profile name`
      );
    }
    const name = yield* parseName(inputName ?? "", args);
    if (operation === "save") {
      return { _tag: "ProfileSave", dryRun, format, name };
    }
    if (operation === "show") {
      return { _tag: "ProfileShow", dryRun, format, name };
    }
    if (operation === "diff") {
      return { _tag: "ProfileDiff", dryRun, format, name };
    }
    return { _tag: "ProfileApply", dryRun, format, name };
  });

const parseUnsupported = (
  capability: UnsupportedCommandName,
  positionals: readonly string[],
  format: OutputFormat,
  dryRun: boolean
): Effect.Effect<CliCommand, CliParseError> =>
  Effect.succeed({
    _tag: "Unsupported",
    arguments: positionals.slice(1),
    capability,
    dryRun,
    format,
  });

const parsePositionals = (
  args: readonly string[],
  positionals: readonly string[],
  format: OutputFormat,
  dryRun: boolean
): Effect.Effect<CliCommand, CliParseError> => {
  const [first] = positionals;
  if (first === undefined || first === "help") {
    return parseHelp(args, positionals, format, dryRun);
  }
  if (first === "monitor") {
    return parseMonitor(args, positionals, format, dryRun);
  }
  if (first === "profile") {
    return parseProfile(args, positionals, format, dryRun);
  }
  if (first === "cursor" || first === "window" || first === "wallpaper") {
    return parseUnsupported(first, positionals, format, dryRun);
  }
  return wrongArity(args, `Unknown command: ${first}`);
};

/**
 * Parse process arguments into a discriminated command value.
 *
 * The parser accepts flags before or after positional arguments and never reads
 * process state. Profile names are parsed before they reach application code.
 *
 * @param args - Arguments after the executable name.
 * @returns A parsed command or a typed parse error.
 */
export const parseCliArgs = (
  args: readonly string[]
): Effect.Effect<CliCommand, CliParseError> =>
  Effect.gen(function* parseCliArgsEffect() {
    const { dryRun, format, positionals } = yield* parseOptions(args);
    return yield* parsePositionals(args, positionals, format, dryRun);
  });
