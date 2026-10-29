import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  InvalidGammaManagerSettings,
  InvalidGammaManagerIni,
  makeGammaManagerSettings,
  parseGammaManagerIni,
  serializeGammaManagerIni,
  validateGammaManagerSettings,
} from "../src/color";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const failure = <A, E>(effect: Effect.Effect<A, E>): E => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected a parse failure");
  }
  const found = Cause.findError(exit.cause);
  if (!Result.isSuccess(found)) {
    throw new Error("Expected a typed parse failure");
  }
  return found.success;
};

const ini = `
; Gamma Manager accepts the comma decimal separator used by the legacy UI.
[DISPLAY: Night]
monitor=DISPLAY-1
rGamma=1,25
gGamma=1.50
bGamma=0,75
rContrast=1
gContrast=1,10
bContrast=0.90
rBright=-0,25
gBright=0.00
bBright=0.25
monitorBrightness=80
monitorContrast=45

[DISPLAY: Day]
monitor=DISPLAY-1
rGamma=1
gGamma=1
bGamma=1
rContrast=1
gContrast=1
bContrast=1
rBright=0
gBright=0
bBright=0
monitorBrightness=100
monitorContrast=50
`;

describe("GammaManager.ini compatibility", () => {
  it("parses comma and period decimal separators across sections", () => {
    const parsed = run(parseGammaManagerIni(ini));

    expect(parsed["DISPLAY: Night"]).toEqual({
      bBright: 0.25,
      bContrast: 0.9,
      bGamma: 0.75,
      gBright: 0,
      gContrast: 1.1,
      gGamma: 1.5,
      monitor: "DISPLAY-1",
      monitorBrightness: 80,
      monitorContrast: 45,
      rBright: -0.25,
      rContrast: 1,
      rGamma: 1.25,
    });
    expect(Object.keys(parsed)).toEqual(["DISPLAY: Night", "DISPLAY: Day"]);
  });

  it("serializes canonical keys and round-trips deterministically", () => {
    const settings = makeGammaManagerSettings({
      monitor: "DISPLAY-1",
      rBright: -0.25,
      rGamma: 1.25,
    });
    const serialized = serializeGammaManagerIni({
      "DISPLAY: Night": settings,
    });
    const parsed = run(parseGammaManagerIni(serialized));

    expect(serialized).toBe(
      "[DISPLAY: Night]\n" +
        "monitor=DISPLAY-1\n" +
        "rGamma=1.25\n" +
        "gGamma=1\n" +
        "bGamma=1\n" +
        "rContrast=1\n" +
        "gContrast=1\n" +
        "bContrast=1\n" +
        "rBright=-0.25\n" +
        "gBright=0\n" +
        "bBright=0\n" +
        "monitorBrightness=100\n" +
        "monitorContrast=50\n"
    );
    expect(parsed).toEqual({ "DISPLAY: Night": settings });
  });

  it("returns a typed error for missing, malformed, and unknown values", () => {
    const missing = failure(parseGammaManagerIni("[Preset]\nmonitor=Display"));
    const malformed = failure(
      parseGammaManagerIni(ini.replace("rGamma=1,25", "rGamma=one,two"))
    );
    const unknown = failure(parseGammaManagerIni(`${ini}\nunknown=value\n`));

    expect(missing).toBeInstanceOf(InvalidGammaManagerIni);
    expect(missing._tag).toBe("InvalidGammaManagerIni");
    expect(malformed.key).toBe("rGamma");
    expect(malformed.section).toBe("DISPLAY: Night");
    expect(unknown.key).toBe("unknown");
  });

  it("validates persisted ranges while preserving the unavailable contrast sentinel", () => {
    const invalid = failure(
      validateGammaManagerSettings(
        makeGammaManagerSettings({ monitor: "DISPLAY-1", rGamma: 0.2 })
      )
    );
    const normalized = run(
      validateGammaManagerSettings(
        makeGammaManagerSettings({
          monitor: " DISPLAY-1 ",
          monitorContrast: -1,
        })
      )
    );

    expect(invalid).toBeInstanceOf(InvalidGammaManagerSettings);
    expect(invalid._tag).toBe("InvalidGammaManagerSettings");
    expect(invalid.field).toBe("rGamma");
    expect(normalized.monitor).toBe("DISPLAY-1");
    expect(normalized.monitorContrast).toBe(-1);
  });

  it("reports out-of-range preset values as typed INI failures", () => {
    const invalid = failure(
      parseGammaManagerIni(ini.replace("rGamma=1,25", "rGamma=0.2"))
    );

    expect(invalid).toBeInstanceOf(InvalidGammaManagerIni);
    expect(invalid.key).toBe("rGamma");
    expect(invalid.section).toBe("DISPLAY: Night");
  });

  it("accepts an empty document as an empty preset collection", () => {
    expect(run(parseGammaManagerIni("\uFEFF ; no presets\n"))).toEqual({});
    expect(serializeGammaManagerIni({})).toBe("");
  });
});

void run;
