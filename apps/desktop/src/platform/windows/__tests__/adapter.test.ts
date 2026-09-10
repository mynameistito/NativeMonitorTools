import { monitorIdFromIdentity } from "@native-monitor-tools/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  classifyDisplayChangeResult,
  createWindowsDisplayPort,
  edidRegistrySubkeyForInterfacePath,
} from "../index";

describe("Windows display adapter", () => {
  it("keeps restart-required display results distinct from applied results", () => {
    expect(classifyDisplayChangeResult(0)).toEqual({ _tag: "Applied" });
    expect(classifyDisplayChangeResult(1)).toEqual({
      _tag: "RestartRequired",
    });
    expect(classifyDisplayChangeResult(-2)).toEqual({
      _tag: "Failed",
      reason: "The requested display mode is unsupported",
    });
  });

  it("maps PNP monitor identities to their EDID registry subkeys", () => {
    expect(
      edidRegistrySubkeyForInterfacePath(
        "\\\\?\\DISPLAY#DEL4098#5&3b50ae31&0&UID4356#{GUID}"
      )
    ).toBe(
      "SYSTEM\\CurrentControlSet\\Enum\\DISPLAY\\DEL4098\\5&3b50ae31&0&UID4356\\Device Parameters"
    );
    expect(
      edidRegistrySubkeyForInterfacePath("MONITOR\\DEL4098\\5&4356")
    ).toBeUndefined();
    expect(
      edidRegistrySubkeyForInterfacePath("\\\\?\\DISPLAY#..#instance#{GUID}")
    ).toBeUndefined();
    expect(
      edidRegistrySubkeyForInterfacePath(
        "\\\\?\\DISPLAY#DEL4098#bad\0key#{GUID}"
      )
    ).toBeUndefined();
  });

  it("returns explicit unsupported results off Windows without loading FFI", async () => {
    if (process.platform === "win32") {
      return;
    }

    const monitorId = Effect.runSync(
      monitorIdFromIdentity({ devicePath: "test-monitor" })
    );
    const channel = Array.from({ length: 256 }, () => 0);
    const ramp = { blue: channel, green: channel, red: channel };
    const port = createWindowsDisplayPort();
    const results = await Promise.all([
      port.discover(),
      port.getGammaRamp(monitorId),
      port.setGammaRamp(monitorId, ramp),
      port.getBrightnessContrastCapabilities(monitorId),
      port.setBrightness(monitorId, 50),
      port.setContrast(monitorId, 50),
    ]);

    expect(results.map((result) => result._tag)).toEqual([
      "Unsupported",
      "Unsupported",
      "Unsupported",
      "Unsupported",
      "Unsupported",
      "Unsupported",
    ]);
  });

  it("provides a diagnostic discovery result on Windows", async () => {
    const result = await createWindowsDisplayPort().discover();
    if (process.platform !== "win32") {
      expect(result._tag).toBe("Unsupported");
      return;
    }
    if (result._tag === "Success") {
      expect(result.value.topology.monitors.length).toBeGreaterThan(0);
      expect(result.value.displays.length).toBe(
        result.value.topology.monitors.length
      );
      return;
    }
    expect(["Error", "Unsupported"]).toContain(result._tag);
  });
});
