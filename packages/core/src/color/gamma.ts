/* oxlint-disable anti-slop/no-runtime-typeof -- The positional overload needs a runtime discriminator. */

/** The supported gamma adjustment range. */
export const GAMMA_MINIMUM = 0.3;

/** The upper gamma adjustment limit from Gamma Manager. */
export const GAMMA_MAXIMUM = 4.4;

/** The supported software brightness adjustment range. */
export const BRIGHTNESS_MINIMUM = -1;

/** The upper software brightness adjustment limit from Gamma Manager. */
export const BRIGHTNESS_MAXIMUM = 1;

/** The lower contrast adjustment limit from Gamma Manager. */
export const CONTRAST_MINIMUM = 0.1;

/** The normal upper contrast adjustment limit. */
export const NORMAL_CONTRAST_MAXIMUM = 3;

/** The optional extreme upper contrast adjustment limit. */
export const EXTREME_CONTRAST_MAXIMUM = 100;

/** The default gamma value used by Gamma Manager. */
export const DEFAULT_GAMMA = 1;

/** The default contrast value used by Gamma Manager. */
export const DEFAULT_CONTRAST = 1;

/** The default software brightness value used by Gamma Manager. */
export const DEFAULT_BRIGHTNESS = 0;

/** The default hardware monitor brightness value used by Gamma Manager. */
export const DEFAULT_MONITOR_BRIGHTNESS = 100;

/** The default hardware monitor contrast value used by Gamma Manager. */
export const DEFAULT_MONITOR_CONTRAST = 50;

/** The color channels accepted by the gamma ramp. */
export type RgbChannel = "r" | "g" | "b";

/** The color selection modes exposed by the legacy Gamma Manager UI. */
export type RgbControl =
  | "linked"
  | "all"
  | "red"
  | "green"
  | "blue"
  | RgbChannel;

/** The software adjustment groups that can be changed independently. */
export type ColorAdjustment = "gamma" | "contrast" | "brightness";

/** The input values used to construct a three-channel gamma ramp. */
export interface GammaRampParameters {
  /** Red-channel gamma. */
  readonly rGamma: number;
  /** Green-channel gamma. */
  readonly gGamma: number;
  /** Blue-channel gamma. */
  readonly bGamma: number;
  /** Red-channel contrast. */
  readonly rContrast: number;
  /** Green-channel contrast. */
  readonly gContrast: number;
  /** Blue-channel contrast. */
  readonly bContrast: number;
  /** Red-channel software brightness. */
  readonly rBright: number;
  /** Green-channel software brightness. */
  readonly gBright: number;
  /** Blue-channel software brightness. */
  readonly bBright: number;
}

/** A complete Gamma Manager preset, including monitor hardware values. */
export interface GammaManagerSettings extends GammaRampParameters {
  /** The legacy display name used to select a monitor. */
  readonly monitor: string;
  /** The monitor hardware brightness value. */
  readonly monitorBrightness: number;
  /** The monitor hardware contrast value. */
  readonly monitorContrast: number;
}

/** Optional values used to create a complete preset from the reset defaults. */
export interface GammaManagerSettingsInput {
  /** The legacy display name used to select a monitor. */
  readonly monitor?: string;
  /** Red-channel gamma. */
  readonly rGamma?: number;
  /** Green-channel gamma. */
  readonly gGamma?: number;
  /** Blue-channel gamma. */
  readonly bGamma?: number;
  /** Red-channel contrast. */
  readonly rContrast?: number;
  /** Green-channel contrast. */
  readonly gContrast?: number;
  /** Blue-channel contrast. */
  readonly bContrast?: number;
  /** Red-channel software brightness. */
  readonly rBright?: number;
  /** Green-channel software brightness. */
  readonly gBright?: number;
  /** Blue-channel software brightness. */
  readonly bBright?: number;
  /** The monitor hardware brightness value. */
  readonly monitorBrightness?: number;
  /** The monitor hardware contrast value. */
  readonly monitorContrast?: number;
}

/** Options controlling the contrast ceiling used when building a ramp. */
export interface GammaRampOptions {
  /** Permit the legacy extreme contrast range up to `100`. */
  readonly extremeContrast?: boolean;
}

/** A three-channel, 256-entry, 16-bit gamma ramp. */
export type GammaRamp = readonly [Uint16Array, Uint16Array, Uint16Array];

/** Reset values shared by all Gamma Manager presets. */
export const DEFAULT_GAMMA_MANAGER_SETTINGS: Readonly<GammaManagerSettings> =
  Object.freeze({
    bBright: DEFAULT_BRIGHTNESS,
    bContrast: DEFAULT_CONTRAST,
    bGamma: DEFAULT_GAMMA,
    gBright: DEFAULT_BRIGHTNESS,
    gContrast: DEFAULT_CONTRAST,
    gGamma: DEFAULT_GAMMA,
    monitor: "",
    monitorBrightness: DEFAULT_MONITOR_BRIGHTNESS,
    monitorContrast: DEFAULT_MONITOR_CONTRAST,
    rBright: DEFAULT_BRIGHTNESS,
    rContrast: DEFAULT_CONTRAST,
    rGamma: DEFAULT_GAMMA,
  });

/** Alias for callers that use the shorter reset-default name. */
export const DEFAULT_GAMMA_SETTINGS = DEFAULT_GAMMA_MANAGER_SETTINGS;

const clamp = (value: number, minimum: number, maximum: number): number => {
  if (value < minimum) {
    return minimum;
  }
  if (value > maximum) {
    return maximum;
  }
  return value;
};

const legacyFloat = (value: number): number => Math.fround(value);

/** Clamp a gamma value to Gamma Manager’s supported range. */
export const clampGamma = (value: number): number =>
  clamp(
    legacyFloat(value),
    legacyFloat(GAMMA_MINIMUM),
    legacyFloat(GAMMA_MAXIMUM)
  );

/** Clamp a software brightness value to Gamma Manager’s supported range. */
export const clampBrightness = (value: number): number =>
  clamp(
    legacyFloat(value),
    legacyFloat(BRIGHTNESS_MINIMUM),
    legacyFloat(BRIGHTNESS_MAXIMUM)
  );

/** Clamp a contrast value using either the normal or extreme ceiling. */
export const clampContrast = (
  value: number,
  options: GammaRampOptions = {}
): number =>
  clamp(
    legacyFloat(value),
    legacyFloat(CONTRAST_MINIMUM),
    legacyFloat(
      options.extremeContrast
        ? EXTREME_CONTRAST_MAXIMUM
        : NORMAL_CONTRAST_MAXIMUM
    )
  );

/** Create a complete reset preset for a monitor name. */
export const createDefaultGammaManagerSettings = (
  monitor = ""
): GammaManagerSettings => ({
  ...DEFAULT_GAMMA_MANAGER_SETTINGS,
  monitor,
});

/** Create a preset by filling omitted values with Gamma Manager reset values. */
export const makeGammaManagerSettings = (
  input: GammaManagerSettingsInput = {}
): GammaManagerSettings => ({
  bBright: input.bBright ?? DEFAULT_BRIGHTNESS,
  bContrast: input.bContrast ?? DEFAULT_CONTRAST,
  bGamma: input.bGamma ?? DEFAULT_GAMMA,
  gBright: input.gBright ?? DEFAULT_BRIGHTNESS,
  gContrast: input.gContrast ?? DEFAULT_CONTRAST,
  gGamma: input.gGamma ?? DEFAULT_GAMMA,
  monitor: input.monitor ?? "",
  monitorBrightness: input.monitorBrightness ?? DEFAULT_MONITOR_BRIGHTNESS,
  monitorContrast: input.monitorContrast ?? DEFAULT_MONITOR_CONTRAST,
  rBright: input.rBright ?? DEFAULT_BRIGHTNESS,
  rContrast: input.rContrast ?? DEFAULT_CONTRAST,
  rGamma: input.rGamma ?? DEFAULT_GAMMA,
});

/** Return a fresh preset containing the legacy Gamma Manager reset values. */
export const resetGammaManagerSettings = (monitor = ""): GammaManagerSettings =>
  createDefaultGammaManagerSettings(monitor);

const channelsForControl = (control: RgbControl): readonly RgbChannel[] => {
  if (control === "linked" || control === "all") {
    return ["r", "g", "b"];
  }
  if (control === "red" || control === "r") {
    return ["r"];
  }
  if (control === "green" || control === "g") {
    return ["g"];
  }
  return ["b"];
};

const setChannelAdjustment = (
  settings: GammaManagerSettings,
  channel: RgbChannel,
  adjustment: ColorAdjustment,
  value: number
): GammaManagerSettings => {
  if (adjustment === "gamma") {
    if (channel === "r") {
      return { ...settings, rGamma: value };
    }
    if (channel === "g") {
      return { ...settings, gGamma: value };
    }
    return { ...settings, bGamma: value };
  }
  if (adjustment === "contrast") {
    if (channel === "r") {
      return { ...settings, rContrast: value };
    }
    if (channel === "g") {
      return { ...settings, gContrast: value };
    }
    return { ...settings, bContrast: value };
  }
  if (channel === "r") {
    return { ...settings, rBright: value };
  }
  if (channel === "g") {
    return { ...settings, gBright: value };
  }
  return { ...settings, bBright: value };
};

/** Update one linked or independent RGB adjustment without mutating the preset. */
export const setRgbAdjustment = (
  settings: GammaManagerSettings,
  adjustment: ColorAdjustment,
  value: number,
  control: RgbControl,
  options: GammaRampOptions = {}
): GammaManagerSettings => {
  let clampedValue: number;
  if (adjustment === "gamma") {
    clampedValue = clampGamma(value);
  } else if (adjustment === "contrast") {
    clampedValue = clampContrast(value, options);
  } else {
    clampedValue = clampBrightness(value);
  }
  let updated = settings;
  for (const channel of channelsForControl(control)) {
    updated = setChannelAdjustment(updated, channel, adjustment, clampedValue);
  }
  return updated;
};

const rampChannel = (
  gammaInput: number,
  contrastInput: number,
  brightnessInput: number,
  options: GammaRampOptions
): Uint16Array => {
  const gamma = clampGamma(gammaInput);
  const contrast = clampContrast(contrastInput, options);
  const brightness = clampBrightness(brightnessInput);
  const inverseGamma = legacyFloat(1 / gamma);
  const normalization = 255 ** (inverseGamma - 1);
  const values = new Uint16Array(256);

  for (let index = 0; index < 256; index += 1) {
    const input = legacyFloat(
      legacyFloat(index * contrast) -
        legacyFloat(legacyFloat(contrast - 1) * 127)
    );
    let value = input;
    if (gamma !== 1) {
      value = value ** inverseGamma / normalization;
    }
    value += legacyFloat(brightness * 128);

    const scaled = value * 256;
    if (Number.isNaN(scaled) || scaled <= 0) {
      values[index] = 0;
    } else if (scaled >= 65_535) {
      values[index] = 65_535;
    } else {
      values[index] = Math.trunc(scaled);
    }
  }

  return values;
};

/**
 * Create the legacy three-channel gamma ramp.
 *
 * The positional overload mirrors `Gamma.CreateGammaRamp`; the object overload
 * is the preferred form for TypeScript callers. The legacy single-precision
 * intermediate operations and truncation toward zero are retained.
 *
 * @param parameters - The nine software adjustment values.
 * @param options - Whether the extreme contrast ceiling is enabled.
 * @returns A three-channel ramp with 256 unsigned 16-bit entries per channel.
 */
export function createGammaRamp(
  parameters: GammaRampParameters,
  options?: GammaRampOptions
): GammaRamp;

/**
 * Create the legacy three-channel gamma ramp from positional values.
 *
 * @param rGamma - Red-channel gamma.
 * @param gGamma - Green-channel gamma.
 * @param bGamma - Blue-channel gamma.
 * @param rContrast - Red-channel contrast.
 * @param gContrast - Green-channel contrast.
 * @param bContrast - Blue-channel contrast.
 * @param rBright - Red-channel software brightness.
 * @param gBright - Green-channel software brightness.
 * @param bBright - Blue-channel software brightness.
 * @param options - Whether the extreme contrast ceiling is enabled.
 * @returns A three-channel ramp with 256 unsigned 16-bit entries per channel.
 */
export function createGammaRamp(
  rGamma: number,
  gGamma: number,
  bGamma: number,
  rContrast: number,
  gContrast: number,
  bContrast: number,
  rBright: number,
  gBright: number,
  bBright: number,
  options?: GammaRampOptions
): GammaRamp;

export function createGammaRamp(
  inputOrRGamma: GammaRampParameters | number,
  gGammaOrOptions?: number | GammaRampOptions,
  bGamma?: number,
  rContrast?: number,
  gContrast?: number,
  bContrast?: number,
  rBright?: number,
  gBright?: number,
  bBright?: number,
  options?: GammaRampOptions
): GammaRamp {
  let parameters: GammaRampParameters;
  let rampOptions: GammaRampOptions;

  if (typeof inputOrRGamma === "number") {
    parameters = {
      bBright: bBright ?? Number.NaN,
      bContrast: bContrast ?? Number.NaN,
      bGamma: bGamma ?? Number.NaN,
      gBright: gBright ?? Number.NaN,
      gContrast: gContrast ?? Number.NaN,
      gGamma:
        typeof gGammaOrOptions === "number" ? gGammaOrOptions : Number.NaN,
      rBright: rBright ?? Number.NaN,
      rContrast: rContrast ?? Number.NaN,
      rGamma: inputOrRGamma,
    };
    rampOptions = options ?? {};
  } else {
    parameters = inputOrRGamma;
    rampOptions =
      typeof gGammaOrOptions === "number" ? {} : (gGammaOrOptions ?? {});
  }

  return [
    rampChannel(
      parameters.rGamma,
      parameters.rContrast,
      parameters.rBright,
      rampOptions
    ),
    rampChannel(
      parameters.gGamma,
      parameters.gContrast,
      parameters.gBright,
      rampOptions
    ),
    rampChannel(
      parameters.bGamma,
      parameters.bContrast,
      parameters.bBright,
      rampOptions
    ),
  ];
}
