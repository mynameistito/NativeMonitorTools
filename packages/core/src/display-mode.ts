import { Effect } from "effect";

import { InvalidDisplayMode } from "./errors";

/** A validated display mode expressed in physical pixels and hertz. */
export interface DisplayMode {
  readonly width: number;
  readonly height: number;
  readonly refreshRate: number;
  readonly bitsPerPixel?: number;
}

interface DisplayModeInput {
  readonly width: number;
  readonly height: number;
  readonly refreshRate: number;
  readonly bitsPerPixel?: number;
}

/**
 * Construct a validated display mode.
 *
 * @param input - The candidate pixel dimensions and refresh rate.
 * @returns An Effect that succeeds with a DisplayMode or fails with InvalidDisplayMode.
 */
export const makeDisplayMode = (
  input: DisplayModeInput
): Effect.Effect<DisplayMode, InvalidDisplayMode> => {
  if (!Number.isInteger(input.width) || input.width <= 0) {
    return Effect.fail(
      new InvalidDisplayMode({
        reason: "Display width must be a positive integer",
        value: input,
      })
    );
  }
  if (!Number.isInteger(input.height) || input.height <= 0) {
    return Effect.fail(
      new InvalidDisplayMode({
        reason: "Display height must be a positive integer",
        value: input,
      })
    );
  }
  if (!Number.isFinite(input.refreshRate) || input.refreshRate <= 0) {
    return Effect.fail(
      new InvalidDisplayMode({
        reason: "Refresh rate must be positive and finite",
        value: input,
      })
    );
  }
  if (
    input.bitsPerPixel !== undefined &&
    (!Number.isInteger(input.bitsPerPixel) || input.bitsPerPixel <= 0)
  ) {
    return Effect.fail(
      new InvalidDisplayMode({
        reason: "Bits per pixel must be a positive integer",
        value: input,
      })
    );
  }

  const mode = {
    height: input.height,
    refreshRate: input.refreshRate,
    width: input.width,
  };
  if (input.bitsPerPixel === undefined) {
    return Effect.succeed(mode);
  }
  return Effect.succeed({ ...mode, bitsPerPixel: input.bitsPerPixel });
};

/** Compare two display modes by all meaningful fields. */
export const displayModesEqual = (
  left: DisplayMode,
  right: DisplayMode
): boolean =>
  left.width === right.width &&
  left.height === right.height &&
  left.refreshRate === right.refreshRate &&
  left.bitsPerPixel === right.bitsPerPixel;

/** Return a stable human-readable mode label. */
export const displayModeLabel = (mode: DisplayMode): string =>
  `${mode.width}x${mode.height}@${mode.refreshRate}Hz`;
