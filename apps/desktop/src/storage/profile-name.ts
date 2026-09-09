import { Data, Effect } from "effect";

/** A profile name safe to use as one JSON filename component. */
export type ProfileName = string & { readonly __profileName: unique symbol };

/** A profile name was empty or attempted to escape the profile directory. */
export class InvalidProfileName extends Data.TaggedError("InvalidProfileName")<{
  readonly input: string;
  readonly reason: string;
}> {}

const profileNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const reservedWindowsNames = new Set([
  "AUX",
  "CON",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
  "NUL",
  "PRN",
]);

/**
 * Parse a user-supplied profile name into a filename-safe value.
 *
 * Names intentionally use a conservative portable subset. In particular,
 * separators, drive prefixes, dot segments, control characters, and trailing
 * whitespace can never become part of a profile path.
 *
 * @param input - The untrusted profile name.
 * @returns A safe profile name or a typed parsing error.
 */
export const parseProfileName = (
  input: string
): Effect.Effect<ProfileName, InvalidProfileName> => {
  const normalized = input.trim();
  if (normalized !== input) {
    return Effect.fail(
      new InvalidProfileName({
        input,
        reason: "Profile names cannot start or end with whitespace",
      })
    );
  }
  if (normalized === "." || normalized === "..") {
    return Effect.fail(
      new InvalidProfileName({
        input,
        reason: "Dot path segments are not profile names",
      })
    );
  }
  if (!profileNamePattern.test(normalized)) {
    return Effect.fail(
      new InvalidProfileName({
        input,
        reason:
          "Profile names must be 1-64 characters of letters, numbers, hyphens, or underscores",
      })
    );
  }
  if (reservedWindowsNames.has(normalized.toUpperCase())) {
    return Effect.fail(
      new InvalidProfileName({
        input,
        reason: "Profile names cannot use reserved Windows device names",
      })
    );
  }
  // SAFETY: profileNamePattern proves this value is a non-empty, portable single filename component.
  return Effect.succeed(normalized as ProfileName);
};

/** Return the filename used for a parsed profile name. */
export const profileFileName = (name: ProfileName): string => `${name}.json`;
