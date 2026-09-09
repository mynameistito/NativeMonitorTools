/* oxlint-disable max-classes-per-file -- Area validation errors are one cohesive vocabulary. */

import { Data, Effect } from "effect";

import type { Rect } from "../geometry";

/** DMT's fixed maximum number of user-defined areas. */
export const MAX_USER_DEFINED_AREAS = 100;

/** A user-defined area after its name, index, and rectangle are parsed. */
export interface UserDefinedArea {
  /** Zero-based slot used by DMT commands. */
  readonly index: number;
  /** Display name for the area. */
  readonly name: string;
  /** Absolute desktop rectangle used by the placement adapter. */
  readonly rect: Rect;
}

/** Input accepted when constructing a user-defined area. */
export interface UserDefinedAreaInput {
  /** Optional display name; `description` is accepted for DMT config parity. */
  readonly name?: string;
  /** Optional DMT-compatible alias for `name`. */
  readonly description?: string;
  /** Absolute desktop rectangle for the area. */
  readonly rect: Rect;
}

/** A user-defined area has invalid content. */
export class InvalidUserDefinedArea extends Data.TaggedError(
  "InvalidUserDefinedArea"
)<{
  /** Slot at which invalid data was found. */
  readonly index: number;
  /** Why the data was rejected. */
  readonly reason: string;
}> {}

/** The collection contains more user-defined areas than DMT supports. */
export class UserDefinedAreaLimitExceeded extends Data.TaggedError(
  "UserDefinedAreaLimitExceeded"
)<{
  /** Maximum supported number of areas. */
  readonly limit: number;
  /** Number of areas supplied by the caller. */
  readonly count: number;
}> {}

const isValidRect = (rect: Rect): boolean => {
  const hasFiniteValues = [rect.x, rect.y, rect.width, rect.height].every(
    (value) => Number.isFinite(value)
  );
  const hasPositiveDimensions = rect.width > 0 && rect.height > 0;
  return hasFiniteValues && hasPositiveDimensions;
};

const copyRect = (rect: Rect): Rect => ({
  height: rect.height,
  width: rect.width,
  x: rect.x,
  y: rect.y,
});

const inputName = (input: UserDefinedAreaInput): string =>
  (input.name ?? input.description ?? "").trim();

/**
 * Parse one user-defined area and assign it a DMT slot index.
 *
 * @param input - Candidate area data.
 * @param index - Zero-based slot index for the area.
 * @returns A validated area or a typed validation failure.
 */
export const makeUserDefinedArea = (
  input: UserDefinedAreaInput,
  index = 0
): Effect.Effect<UserDefinedArea, InvalidUserDefinedArea> => {
  const name = inputName(input);
  if (name.length === 0) {
    return Effect.fail(
      new InvalidUserDefinedArea({ index, reason: "Area name cannot be empty" })
    );
  }
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= MAX_USER_DEFINED_AREAS
  ) {
    return Effect.fail(
      new InvalidUserDefinedArea({
        index,
        reason: `Area index must be between 0 and ${MAX_USER_DEFINED_AREAS - 1}`,
      })
    );
  }
  if (!isValidRect(input.rect)) {
    return Effect.fail(
      new InvalidUserDefinedArea({
        index,
        reason:
          "Area rectangle must have finite coordinates and positive dimensions",
      })
    );
  }

  return Effect.succeed({ index, name, rect: copyRect(input.rect) });
};

/** Alias using the shorter DMT area terminology. */
export const makeUserArea = makeUserDefinedArea;

/**
 * Parse a complete user-area collection while enforcing DMT's 100-area limit.
 *
 * @param inputs - Candidate user-defined areas in slot order.
 * @returns Validated areas or the first typed validation/limit failure.
 */
export const makeUserDefinedAreas = (
  inputs: readonly UserDefinedAreaInput[]
): Effect.Effect<
  readonly UserDefinedArea[],
  InvalidUserDefinedArea | UserDefinedAreaLimitExceeded
> => {
  if (inputs.length > MAX_USER_DEFINED_AREAS) {
    return Effect.fail(
      new UserDefinedAreaLimitExceeded({
        count: inputs.length,
        limit: MAX_USER_DEFINED_AREAS,
      })
    );
  }

  return Effect.gen(function* makeUserDefinedAreasEffect() {
    const areas: UserDefinedArea[] = [];
    for (const [index, input] of inputs.entries()) {
      areas.push(yield* makeUserDefinedArea(input, index));
    }
    return areas;
  });
};

/** Alias using the shorter DMT area terminology. */
export const makeUserAreas = makeUserDefinedAreas;

/**
 * Validate an already parsed user-area collection before adding a new slot.
 *
 * @param areas - Existing user areas.
 * @param input - Candidate area to append.
 * @returns The new immutable collection or a typed failure.
 */
export const appendUserDefinedArea = (
  areas: readonly UserDefinedArea[],
  input: UserDefinedAreaInput
): Effect.Effect<
  readonly UserDefinedArea[],
  InvalidUserDefinedArea | UserDefinedAreaLimitExceeded
> => {
  if (areas.length >= MAX_USER_DEFINED_AREAS) {
    return Effect.fail(
      new UserDefinedAreaLimitExceeded({
        count: areas.length + 1,
        limit: MAX_USER_DEFINED_AREAS,
      })
    );
  }

  return Effect.map(makeUserDefinedArea(input, areas.length), (area) => [
    ...areas,
    area,
  ]);
};

/** Alias for appending one user area. */
export const addUserDefinedArea = appendUserDefinedArea;
