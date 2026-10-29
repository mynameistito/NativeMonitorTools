/* oxlint-disable anti-slop/no-runtime-typeof -- Serialized values cross a JSON boundary. */
/* oxlint-disable max-classes-per-file -- Area validation errors are one cohesive vocabulary. */

import { Data, Effect } from "effect";

import type { Rect } from "../geometry";

/** DMT's fixed maximum number of user-defined areas. */
export const MAX_USER_DEFINED_AREAS = 100;

/** Version of the platform-independent user-area JSON representation. */
export const USER_AREA_STORE_VERSION = 1 as const;

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

/** An area entry accepted by the sparse, serializable store. */
export interface UserAreaStoreAreaInput extends UserDefinedAreaInput {
  /** Optional stable DMT slot; omitted entries use their input position. */
  readonly index?: number;
}

/** The serializable model persisted by a later launcher or desktop adapter. */
export interface UserDefinedAreaStore {
  /** Schema version for forward-compatible persistence. */
  readonly version: typeof USER_AREA_STORE_VERSION;
  /** Configured areas, sorted by their stable zero-based slot. */
  readonly areas: readonly UserDefinedArea[];
}

/** Input for creating a user-area store from sparse or compact entries. */
export type UserDefinedAreaStoreInput =
  | readonly UserAreaStoreAreaInput[]
  | {
      /** Store schema version; omitted values use the current version. */
      readonly version?: number;
      /** Area entries, optionally carrying sparse stable slots. */
      readonly areas: readonly UserAreaStoreAreaInput[];
    };

/** Expected failures from parsing or constructing a user-area store. */
export type UserDefinedAreaStoreError =
  | DuplicateUserDefinedAreaIndex
  | InvalidUserDefinedArea
  | InvalidUserDefinedAreaStore
  | UserDefinedAreaLimitExceeded;

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

/** A serialized user-area store is malformed or uses an unsupported version. */
export class InvalidUserDefinedAreaStore extends Data.TaggedError(
  "InvalidUserDefinedAreaStore"
)<{
  /** JSON path or store field at which parsing failed. */
  readonly path: string;
  /** Why the serialized value was rejected. */
  readonly reason: string;
}> {}

/** Two store entries claimed the same stable DMT slot. */
export class DuplicateUserDefinedAreaIndex extends Data.TaggedError(
  "DuplicateUserDefinedAreaIndex"
)<{
  /** Duplicated zero-based slot. */
  readonly index: number;
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

const areaInputWithoutIndex = (
  input: UserAreaStoreAreaInput
): UserDefinedAreaInput => {
  if (input.name !== undefined) {
    return { name: input.name, rect: input.rect };
  }
  if (input.description !== undefined) {
    return { description: input.description, rect: input.rect };
  }
  return { rect: input.rect };
};

const areaInputWithIndex = (
  input: UserAreaStoreAreaInput,
  index: number
): UserAreaStoreAreaInput => ({
  ...areaInputWithoutIndex(input),
  index,
});

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
 * Parse a complete compact user-area collection while enforcing DMT's limit.
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

const isCompactStoreInput = (
  input: UserDefinedAreaStoreInput
): input is readonly UserAreaStoreAreaInput[] => Array.isArray(input);

const storeEntries = (
  input: UserDefinedAreaStoreInput
): readonly UserAreaStoreAreaInput[] => {
  if (isCompactStoreInput(input)) {
    return input;
  }
  return input.areas;
};

const storeVersion = (input: UserDefinedAreaStoreInput): number => {
  if (isCompactStoreInput(input)) {
    return USER_AREA_STORE_VERSION;
  }
  return input.version ?? USER_AREA_STORE_VERSION;
};

/**
 * Construct a validated sparse user-area store.
 *
 * Explicit indices are retained, allowing disabled/unconfigured slots to be
 * omitted without renumbering the remaining DMT areas. Compact arrays retain
 * the historic zero-based positional behavior.
 *
 * @param input - Sparse store input or a compact list of area inputs.
 * @returns A versioned immutable store or a typed validation failure.
 */
export const makeUserDefinedAreaStore = (
  input: UserDefinedAreaStoreInput
): Effect.Effect<UserDefinedAreaStore, UserDefinedAreaStoreError> => {
  const version = storeVersion(input);
  if (version !== USER_AREA_STORE_VERSION) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: "version",
        reason: `Unsupported user-area store version: ${String(version)}`,
      })
    );
  }

  const entries = storeEntries(input);
  if (entries.length > MAX_USER_DEFINED_AREAS) {
    return Effect.fail(
      new UserDefinedAreaLimitExceeded({
        count: entries.length,
        limit: MAX_USER_DEFINED_AREAS,
      })
    );
  }

  return Effect.gen(function* makeUserDefinedAreaStoreEffect() {
    const indexes = new Set<number>();
    const areas: UserDefinedArea[] = [];
    for (const [position, entry] of entries.entries()) {
      const index = entry.index ?? position;
      if (indexes.has(index)) {
        return yield* Effect.fail(new DuplicateUserDefinedAreaIndex({ index }));
      }
      indexes.add(index);
      areas.push(
        yield* makeUserDefinedArea(areaInputWithoutIndex(entry), index)
      );
    }
    return {
      areas: areas.toSorted((left, right) => left.index - right.index),
      version: USER_AREA_STORE_VERSION,
    };
  });
};

/** Alias using the shorter store terminology. */
export const makeUserAreaStore = makeUserDefinedAreaStore;

interface SerializedJsonObject {
  readonly [key: string]: SerializedJsonValue;
}

interface SerializedJsonArray {
  readonly length: number;
  readonly [index: number]: SerializedJsonValue;
}

type SerializedJsonValue =
  | string
  | number
  | boolean
  | null
  | SerializedJsonArray
  | SerializedJsonObject;

type SerializedRecord = SerializedJsonObject;

const isRecord = (value: unknown): value is SerializedRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeInteger = (
  value: SerializedJsonValue | undefined
): value is number => typeof value === "number" && Number.isSafeInteger(value);

const isFiniteNumber = (
  value: SerializedJsonValue | undefined
): value is number => typeof value === "number" && Number.isFinite(value);

const makeSerializedAreaInput = (
  rect: Rect,
  index: number | undefined,
  name: string | undefined
): UserAreaStoreAreaInput => {
  if (name === undefined) {
    return index === undefined ? { rect } : { index, rect };
  }
  return index === undefined ? { name, rect } : { index, name, rect };
};

const serializedAreaName = (value: SerializedRecord): string | undefined => {
  if (typeof value.name === "string") {
    return value.name;
  }
  if (typeof value.description === "string") {
    return value.description;
  }
  return undefined;
};

const serializedAreaInput = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the JSON object parser boundary; the value is narrowed before it enters the domain model.
  value: unknown,
  position: number
): Effect.Effect<UserAreaStoreAreaInput, InvalidUserDefinedAreaStore> => {
  if (!isRecord(value)) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: `areas[${position}]`,
        reason: "Area must be a JSON object",
      })
    );
  }

  const rawRect = value.rect;
  if (!isRecord(rawRect)) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: `areas[${position}].rect`,
        reason: "Area rectangle must be an object",
      })
    );
  }

  const readCoordinate = (coordinate: string): number | undefined => {
    const valueAtCoordinate = rawRect[coordinate];
    return isFiniteNumber(valueAtCoordinate) ? valueAtCoordinate : undefined;
  };
  const x = readCoordinate("x");
  const y = readCoordinate("y");
  const width = readCoordinate("width");
  const height = readCoordinate("height");
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: `areas[${position}].rect`,
        reason: "Rectangle coordinates and dimensions must be finite numbers",
      })
    );
  }
  const rect: Rect = {
    height,
    width,
    x,
    y,
  };
  const rawIndex = value.index;
  if (rawIndex !== undefined && !isSafeInteger(rawIndex)) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: `areas[${position}].index`,
        reason: "Area index must be a safe integer",
      })
    );
  }
  const index = isSafeInteger(rawIndex) ? rawIndex : undefined;

  if (value.name !== undefined && typeof value.name !== "string") {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: `areas[${position}].name`,
        reason: "Area name must be a string",
      })
    );
  }
  if (
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: `areas[${position}].description`,
        reason: "Area description must be a string",
      })
    );
  }

  const name = serializedAreaName(value);
  return Effect.succeed(makeSerializedAreaInput(rect, index, name));
};

const decodedStoreInput = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the JSON value parser boundary; arrays and records are narrowed before construction.
  value: unknown
): Effect.Effect<UserDefinedAreaStoreInput, InvalidUserDefinedAreaStore> => {
  if (Array.isArray(value)) {
    return Effect.gen(function* decodedLegacyAreaList() {
      const entries: UserAreaStoreAreaInput[] = [];
      for (const [position, area] of value.entries()) {
        entries.push(yield* serializedAreaInput(area, position));
      }
      return entries;
    });
  }
  if (!isRecord(value)) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: "$",
        reason: "User-area store must be an object or area array",
      })
    );
  }

  const rawAreas = value.areas;
  if (!Array.isArray(rawAreas)) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: "areas",
        reason: "User-area store areas must be an array",
      })
    );
  }
  const rawVersion = value.version;
  if (rawVersion !== undefined && !isSafeInteger(rawVersion)) {
    return Effect.fail(
      new InvalidUserDefinedAreaStore({
        path: "version",
        reason: "User-area store version must be a safe integer",
      })
    );
  }

  return Effect.gen(function* decodedStoreObject() {
    const entries: UserAreaStoreAreaInput[] = [];
    for (const [position, area] of rawAreas.entries()) {
      entries.push(yield* serializedAreaInput(area, position));
    }
    return {
      areas: entries,
      version: rawVersion,
    };
  });
};

/**
 * Parse a versioned user-area store from JSON or an already-decoded value.
 *
 * A top-level area array is accepted as a migration form for callers that
 * previously persisted only the area collection. Canonical serialization is
 * always the versioned object form.
 *
 * @param input - JSON text or an unknown decoded store value.
 * @returns A validated store or a typed parsing/validation failure.
 */
export const parseUserDefinedAreaStore = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public persistence parsing intentionally accepts untrusted JSON text or decoded values.
  input: unknown
): Effect.Effect<UserDefinedAreaStore, UserDefinedAreaStoreError> => {
  let decoded: unknown = input;
  if (typeof input === "string") {
    try {
      decoded = JSON.parse(input);
    } catch (error) {
      return Effect.fail(
        new InvalidUserDefinedAreaStore({
          path: "$",
          reason: `Invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
        })
      );
    }
  }

  return Effect.flatMap(decodedStoreInput(decoded), makeUserDefinedAreaStore);
};

/** Alias using the shorter store terminology. */
export const parseUserAreaStore = parseUserDefinedAreaStore;

/**
 * Serialize a validated user-area store into canonical JSON.
 *
 * @param store - Versioned user-area store.
 * @returns Stable JSON text suitable for file or settings persistence.
 */
export const serializeUserDefinedAreaStore = (
  store: UserDefinedAreaStore
): string =>
  JSON.stringify({
    areas: store.areas.map((area) => ({
      index: area.index,
      name: area.name,
      rect: copyRect(area.rect),
    })),
    version: store.version,
  });

/** Alias using the shorter store terminology. */
export const serializeUserAreaStore = serializeUserDefinedAreaStore;

/** An empty versioned store with no configured slots. */
export const EMPTY_USER_AREA_STORE: UserDefinedAreaStore = {
  areas: [],
  version: USER_AREA_STORE_VERSION,
};

/**
 * Find a configured area by its stable zero-based slot.
 *
 * @param store - Validated user-area store.
 * @param index - DMT slot to find.
 * @returns The configured area, or `undefined` when the slot is empty.
 */
export const findUserDefinedArea = (
  store: UserDefinedAreaStore,
  index: number
): UserDefinedArea | undefined =>
  store.areas.find((area) => area.index === index);

/** Alias using the shorter area terminology. */
export const findUserArea = findUserDefinedArea;

/**
 * Replace or add one store slot without mutating the original store.
 *
 * @param store - Existing validated store.
 * @param input - Candidate area data.
 * @param index - Optional explicit slot; otherwise the input slot or first free slot is used.
 * @returns An updated validated store or a typed validation failure.
 */
export const setUserDefinedArea = (
  store: UserDefinedAreaStore,
  input: UserAreaStoreAreaInput,
  index?: number
): Effect.Effect<UserDefinedAreaStore, UserDefinedAreaStoreError> => {
  const usedIndexes = new Set(store.areas.map((area) => area.index));
  const targetIndex =
    index ??
    input.index ??
    Array.from({ length: MAX_USER_DEFINED_AREAS }, (_, value) => value).find(
      (value) => !usedIndexes.has(value)
    );
  if (targetIndex === undefined) {
    return Effect.fail(
      new UserDefinedAreaLimitExceeded({
        count: MAX_USER_DEFINED_AREAS + 1,
        limit: MAX_USER_DEFINED_AREAS,
      })
    );
  }
  if (
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= MAX_USER_DEFINED_AREAS
  ) {
    return Effect.fail(
      new InvalidUserDefinedArea({
        index: targetIndex,
        reason: `Area index must be between 0 and ${MAX_USER_DEFINED_AREAS - 1}`,
      })
    );
  }

  const entries: UserAreaStoreAreaInput[] = [];
  for (const area of store.areas) {
    if (area.index !== targetIndex) {
      entries.push({ index: area.index, name: area.name, rect: area.rect });
    }
  }
  entries.push(areaInputWithIndex(input, targetIndex));
  return makeUserDefinedAreaStore({
    areas: entries,
    version: store.version,
  });
};

/** Alias using the shorter area terminology. */
export const setUserArea = setUserDefinedArea;

/**
 * Remove one configured slot without mutating the original store.
 *
 * @param store - Existing validated store.
 * @param index - DMT slot to remove.
 * @returns A new store with that slot omitted.
 */
export const removeUserDefinedArea = (
  store: UserDefinedAreaStore,
  index: number
): UserDefinedAreaStore => ({
  areas: store.areas.filter((area) => area.index !== index),
  version: store.version,
});

/** Alias using the shorter area terminology. */
export const removeUserArea = removeUserDefinedArea;

/**
 * Validate an already parsed compact user-area collection before appending.
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
