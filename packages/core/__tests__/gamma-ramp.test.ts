import { describe, expect, it } from "vitest";

import {
  clampMonitorBrightness,
  clampMonitorContrast,
  createDefaultGammaManagerSettings,
  createGammaRamp,
  EXTREME_CONTRAST_MAXIMUM,
  getRgbAdjustment,
  makeGammaManagerSettings,
  planHardwareAdjustment,
  resetGammaManagerSettings,
  setHardwareAdjustment,
  setRgbAdjustment,
} from "../src/color";

describe("Gamma Manager ramp compatibility", () => {
  it("creates a 3x256 reset ramp with the legacy 16-bit scaling", () => {
    const ramp = createGammaRamp(
      createDefaultGammaManagerSettings("Display 1")
    );

    expect(ramp).toHaveLength(3);
    expect(ramp.every((channel) => channel instanceof Uint16Array)).toBe(true);
    expect(ramp.every((channel) => channel.length === 256)).toBe(true);
    const firstEntries = [...ramp[0]].slice(0, 4);
    expect(firstEntries).toEqual([0, 256, 512, 768]);
    expect(ramp[0][255]).toBe(65_280);
    expect([...ramp[0]]).toEqual([...ramp[1]]);
    expect([...ramp[1]]).toEqual([...ramp[2]]);
  });

  it("clamps normal and extreme contrast independently", () => {
    const parameters = makeGammaManagerSettings({
      bContrast: Number.POSITIVE_INFINITY,
      gContrast: 100,
      rContrast: -10,
    });
    const normal = createGammaRamp(parameters);
    const extreme = createGammaRamp(parameters, { extremeContrast: true });

    expect([...normal[0]]).toEqual([
      ...createGammaRamp({ ...parameters, rContrast: 0.1 })[0],
    ]);
    expect([...normal[1]]).toEqual([
      ...createGammaRamp({ ...parameters, gContrast: 3 })[1],
    ]);
    expect([...extreme[1]]).toEqual([
      ...createGammaRamp(
        { ...parameters, gContrast: EXTREME_CONTRAST_MAXIMUM },
        { extremeContrast: true }
      )[1],
    ]);
    expect([...extreme[1]]).not.toEqual([...normal[1]]);
  });

  it("clamps gamma and software brightness at the legacy bounds", () => {
    const low = createGammaRamp({
      bBright: -10,
      bContrast: 1,
      bGamma: 0,
      gBright: -1,
      gContrast: 1,
      gGamma: 0.3,
      rBright: 10,
      rContrast: 1,
      rGamma: 10,
    });
    const clamped = createGammaRamp({
      bBright: -1,
      bContrast: 1,
      bGamma: 0.3,
      gBright: -1,
      gContrast: 1,
      gGamma: 0.3,
      rBright: 1,
      rContrast: 1,
      rGamma: 4.4,
    });

    expect([...low[0]]).toEqual([...clamped[0]]);
    expect([...low[1]]).toEqual([...clamped[1]]);
    expect([...low[2]]).toEqual([...clamped[2]]);
  });

  it("updates linked and independent RGB controls immutably", () => {
    const settings = createDefaultGammaManagerSettings("Display 1");
    const linked = setRgbAdjustment(settings, "gamma", 2, "linked");
    const independent = setRgbAdjustment(linked, "brightness", -2, "blue");

    expect(settings.rGamma).toBe(1);
    expect(linked.rGamma).toBe(2);
    expect(linked.gGamma).toBe(2);
    expect(linked.bGamma).toBe(2);
    expect(independent.rBright).toBe(0);
    expect(independent.gBright).toBe(0);
    expect(independent.bBright).toBe(-1);
  });

  it("keeps reset values stable and gives each reset a fresh object", () => {
    const first = resetGammaManagerSettings("Display 1");
    const second = resetGammaManagerSettings("Display 2");

    expect(first).toEqual({
      bBright: 0,
      bContrast: 1,
      bGamma: 1,
      gBright: 0,
      gContrast: 1,
      gGamma: 1,
      monitor: "Display 1",
      monitorBrightness: 100,
      monitorContrast: 50,
      rBright: 0,
      rContrast: 1,
      rGamma: 1,
    });
    expect(first).not.toBe(second);
    expect(second.monitor).toBe("Display 2");
  });

  it("uses truncation toward zero for the 16-bit ramp conversion", () => {
    const ramp = createGammaRamp({
      bBright: 0.1,
      bContrast: 1,
      bGamma: 1,
      gBright: 0.1,
      gContrast: 1,
      gGamma: 1,
      rBright: 0.1,
      rContrast: 1,
      rGamma: 1,
    });

    expect(ramp[0][0]).toBe(3276);
    expect(ramp[0][1]).toBe(3532);
  });

  it("reads linked values as the legacy RGB average and independent values by channel", () => {
    const settings = makeGammaManagerSettings({
      bBright: 0.3,
      bContrast: 1.3,
      bGamma: 1.3,
      gBright: 0.2,
      gContrast: 1.2,
      gGamma: 1.2,
      rBright: 0.1,
      rContrast: 1.1,
      rGamma: 1.1,
    });

    expect(getRgbAdjustment(settings, "gamma", "linked")).toBeCloseTo(1.2);
    expect(getRgbAdjustment(settings, "contrast", "green")).toBe(1.2);
    expect(getRgbAdjustment(settings, "brightness", "b")).toBe(0.3);
  });

  it("records hardware settings and produces tagged, clamped intents without mutation", () => {
    const settings = createDefaultGammaManagerSettings("Display 1");
    const brightness = setHardwareAdjustment(settings, "brightness", 120);
    const contrast = setHardwareAdjustment(settings, "contrast", -10);
    const planned = planHardwareAdjustment(settings, "contrast", 70);

    expect(clampMonitorBrightness(-1)).toBe(0);
    expect(clampMonitorContrast(101)).toBe(100);
    expect(settings.monitorBrightness).toBe(100);
    expect(brightness.monitorBrightness).toBe(100);
    expect(contrast.monitorContrast).toBe(0);
    expect(planned.settings.monitorContrast).toBe(70);
    expect(planned.intent).toEqual({
      _tag: "SetMonitorContrast",
      monitor: "Display 1",
      value: 70,
    });
  });
});
