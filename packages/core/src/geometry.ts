import { Effect } from "effect";

import { InvalidGeometry } from "./errors";

/** A two-dimensional desktop coordinate. Negative coordinates are valid. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned desktop rectangle with positive dimensions. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Construct a point, accepting negative desktop coordinates.
 *
 * @param input - The candidate point.
 * @returns An Effect that succeeds with a Point or fails with InvalidGeometry.
 */
export const makePoint = (input: {
  readonly x: number;
  readonly y: number;
}): Effect.Effect<Point, InvalidGeometry> => {
  if (!isFiniteNumber(input.x) || !isFiniteNumber(input.y)) {
    return Effect.fail(
      new InvalidGeometry({
        reason: "Point coordinates must be finite numbers",
        value: input,
      })
    );
  }

  return Effect.succeed({ x: input.x, y: input.y });
};

/**
 * Construct a rectangle with finite coordinates and positive dimensions.
 *
 * @param input - The candidate rectangle.
 * @returns An Effect that succeeds with a Rect or fails with InvalidGeometry.
 */
export const makeRect = (input: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): Effect.Effect<Rect, InvalidGeometry> => {
  if (!isFiniteNumber(input.x) || !isFiniteNumber(input.y)) {
    return Effect.fail(
      new InvalidGeometry({
        reason: "Rectangle coordinates must be finite numbers",
        value: input,
      })
    );
  }
  if (
    !isFiniteNumber(input.width) ||
    input.width <= 0 ||
    !isFiniteNumber(input.height) ||
    input.height <= 0
  ) {
    return Effect.fail(
      new InvalidGeometry({
        reason: "Rectangle dimensions must be positive numbers",
        value: input,
      })
    );
  }

  return Effect.succeed({
    height: input.height,
    width: input.width,
    x: input.x,
    y: input.y,
  });
};

/** Compare two points by value. */
export const pointsEqual = (left: Point, right: Point): boolean =>
  left.x === right.x && left.y === right.y;

/** Compare two rectangles by value. */
export const rectsEqual = (left: Rect, right: Rect): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

/** Return the upper-left coordinate of a rectangle. */
export const rectPosition = (rect: Rect): Point => ({ x: rect.x, y: rect.y });
