import type { ApplyPlan, DisplayProfile } from "@native-monitor-tools/core";
import {
  makeDisplayMode,
  monitorIdFromIdentity,
} from "@native-monitor-tools/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type {
  WindowsDisplayNativeApi,
  WindowsNativeDisplayRecord,
  WindowsPhysicalMonitorLease,
  WindowsPlatformResult,
} from "../index";
import {
  classifyDisplayChangeResult,
  createWindowsDisplayPort,
  edidRegistrySubkeyForInterfacePath,
} from "../index";

const displayId = (index: number) =>
  Effect.runSync(
    monitorIdFromIdentity({
      devicePath: `\\\\?\\DISPLAY#TEST${index}#INSTANCE${index}#{GUID}`,
    })
  );

const nativeDisplay = (
  index: number,
  position: { readonly x: number; readonly y: number },
  isPrimary: boolean
): WindowsNativeDisplayRecord => ({
  bounds: { height: 1080, width: 1920, ...position },
  deviceName: `\\\\.\\DISPLAY${index}`,
  devicePath: `\\\\?\\DISPLAY#TEST${index}#INSTANCE${index}#{GUID}`,
  displayName: `Test monitor ${index}`,
  hMonitor: BigInt(index),
  isPrimary,
  mode: { bitsPerPixel: 32, height: 1080, refreshRate: 60, width: 1920 },
  workArea: { height: 1040, width: 1920, ...position },
});

const successfulDiscovery = (
  displays: readonly WindowsNativeDisplayRecord[]
): WindowsPlatformResult<readonly WindowsNativeDisplayRecord[]> => ({
  _tag: "Success",
  value: displays,
});

const makeNativeApi = (
  displays: readonly WindowsNativeDisplayRecord[],
  overrides: Partial<WindowsDisplayNativeApi> = {}
): WindowsDisplayNativeApi => ({
  acquirePhysicalMonitors: () => null,
  changeDisplaySettings: () => 0,
  createDisplayContext: () => 1n,
  deleteDisplayContext: () => {},
  discoverDisplays: () => Promise.resolve(successfulDiscovery(displays)),
  getDeviceGammaRamp: () => true,
  getMonitorBrightness: () => ({
    current: 0,
    maximum: 0,
    minimum: 0,
    succeeded: false,
  }),
  getMonitorContrast: () => ({
    current: 0,
    maximum: 0,
    minimum: 0,
    succeeded: false,
  }),
  getPhysicalMonitorCount: () => ({ count: 0, succeeded: false }),
  setDeviceGammaRamp: () => true,
  setMonitorBrightness: () => true,
  setMonitorContrast: () => true,
  ...overrides,
});

const makeMode = (width: number, height: number, refreshRate: number) =>
  Effect.runSync(
    makeDisplayMode({ bitsPerPixel: 32, height, refreshRate, width })
  );

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

  it("builds DEVMODE buffers and stages every display before committing", async () => {
    const leftDisplay = nativeDisplay(1, { x: 0, y: 0 }, true);
    const rightDisplay = nativeDisplay(2, { x: 1920, y: 0 }, false);
    const requests: {
      readonly deviceName: string | null;
      readonly flags: number;
      readonly mode: Uint8Array | null;
    }[] = [];
    const api = makeNativeApi([leftDisplay, rightDisplay], {
      changeDisplaySettings: (deviceName, mode, flags) => {
        requests.push({
          deviceName,
          flags,
          mode: mode === null ? null : new Uint8Array(mode),
        });
        return requests.length === 1 ? 1 : 0;
      },
    });
    const port = createWindowsDisplayPort({
      nativeApi: api,
      platform: "win32",
    });
    const discovered = await port.discover();
    if (discovered._tag !== "Success") {
      throw new Error("Expected the injected display discovery to succeed");
    }
    const [left, right] = discovered.value.topology.monitors;
    if (left === undefined || right === undefined) {
      throw new Error("Expected two discovered monitors");
    }
    const leftMode = makeMode(2560, 1440, 75);
    const desired: DisplayProfile = {
      monitors: [
        {
          id: left.id,
          isPrimary: true,
          mode: leftMode,
          position: { x: 10, y: 20 },
        },
        {
          id: right.id,
          isPrimary: false,
          mode: right.mode,
          position: { x: 1920, y: 10 },
        },
      ],
      version: 1,
    };
    const plan: ApplyPlan = {
      dryRun: false,
      isNoop: false,
      operations: [
        {
          _tag: "SetDisplayMode",
          from: left.mode,
          monitorId: left.id,
          to: leftMode,
        },
        {
          _tag: "MoveMonitor",
          from: { x: left.bounds.x, y: left.bounds.y },
          monitorId: left.id,
          to: { x: 10, y: 20 },
        },
        {
          _tag: "MoveMonitor",
          from: { x: right.bounds.x, y: right.bounds.y },
          monitorId: right.id,
          to: { x: 1920, y: 10 },
        },
      ],
    };

    const result = await port.applyDisplayPlan(
      discovered.value.topology,
      desired,
      plan
    );

    expect(result).toMatchObject({
      _tag: "Error",
      operation: "applyDisplayPlan",
      reason:
        "Windows requires a restart before the display change takes effect",
    });
    expect(requests.map((request) => request.deviceName)).toEqual([
      leftDisplay.deviceName,
      rightDisplay.deviceName,
      null,
    ]);
    const firstMode = requests[0]?.mode;
    if (firstMode === null || firstMode === undefined) {
      throw new Error("Expected a DEVMODE for the first display change");
    }
    const view = new DataView(firstMode.buffer);
    expect(firstMode.byteLength).toBe(220);
    expect(view.getUint16(68, true)).toBe(220);
    expect(view.getUint32(72, true)).toBe(0x5c_00_20);
    expect(view.getInt32(76, true)).toBe(10);
    expect(view.getInt32(80, true)).toBe(20);
    expect(view.getUint32(168, true)).toBe(32);
    expect(view.getUint32(172, true)).toBe(2560);
    expect(view.getUint32(176, true)).toBe(1440);
    expect(view.getUint32(184, true)).toBe(75);
  });

  it("rejects invalid gamma ramps before discovery or native calls", async () => {
    let nativeCalls = 0;
    let discoveryCalls = 0;
    const api = makeNativeApi([], {
      createDisplayContext: () => {
        nativeCalls += 1;
        return 1n;
      },
      discoverDisplays: () => {
        discoveryCalls += 1;
        return Promise.resolve(successfulDiscovery([]));
      },
      setDeviceGammaRamp: () => {
        nativeCalls += 1;
        return true;
      },
    });
    const invalidRamp = {
      blue: Array.from({ length: 256 }, () => 0),
      green: Array.from({ length: 256 }, () => 0),
      red: Array.from({ length: 255 }, () => 0),
    };
    const invalidEntryRamp = {
      ...invalidRamp,
      red: [65_536, ...Array.from({ length: 255 }, () => 0)],
    };
    const port = createWindowsDisplayPort({
      nativeApi: api,
      platform: "win32",
    });

    const result = await port.setGammaRamp(displayId(1), invalidRamp);
    const invalidEntryResult = await port.setGammaRamp(
      displayId(1),
      invalidEntryRamp
    );

    expect(result).toMatchObject({
      _tag: "Error",
      operation: "setGammaRamp",
      reason: "Each gamma channel must contain exactly 256 entries",
    });
    expect(invalidEntryResult).toMatchObject({
      _tag: "Error",
      operation: "setGammaRamp",
      reason: "Gamma entries must be integers between 0 and 65535",
    });
    expect(discoveryCalls).toBe(0);
    expect(nativeCalls).toBe(0);
  });

  it("destroys acquired DXVA2 handles even when using the injected seam", async () => {
    let destroyed = 0;
    const lease: WindowsPhysicalMonitorLease = {
      destroy: () => {
        destroyed += 1;
        return true;
      },
      monitor: 9n,
    };
    const api = makeNativeApi([nativeDisplay(1, { x: 0, y: 0 }, true)], {
      acquirePhysicalMonitors: () => lease,
      getMonitorBrightness: () => ({
        current: 50,
        maximum: 100,
        minimum: 0,
        succeeded: true,
      }),
      getMonitorContrast: () => ({
        current: 60,
        maximum: 100,
        minimum: 0,
        succeeded: true,
      }),
      getPhysicalMonitorCount: () => ({ count: 1, succeeded: true }),
    });

    const result = await createWindowsDisplayPort({
      nativeApi: api,
      platform: "win32",
    }).getBrightnessContrastCapabilities(displayId(1));

    expect(result).toEqual({
      _tag: "Success",
      value: {
        brightness: {
          _tag: "Supported",
          current: 50,
          maximum: 100,
          minimum: 0,
        },
        contrast: { _tag: "Supported", current: 60, maximum: 100, minimum: 0 },
      },
    });
    expect(destroyed).toBe(1);
  });

  it("rejects a stale topology before invoking ChangeDisplaySettingsExW", async () => {
    const currentDisplay = nativeDisplay(1, { x: 0, y: 0 }, true);
    const staleDisplay = {
      ...currentDisplay,
      bounds: { ...currentDisplay.bounds, x: 100 },
      workArea: { ...currentDisplay.workArea, x: 100 },
    };
    let discoveryCalls = 0;
    let mutationCalls = 0;
    const api = makeNativeApi([currentDisplay], {
      changeDisplaySettings: () => {
        mutationCalls += 1;
        return 0;
      },
      discoverDisplays: () => {
        discoveryCalls += 1;
        return Promise.resolve(
          successfulDiscovery(
            discoveryCalls === 1 ? [currentDisplay] : [staleDisplay]
          )
        );
      },
    });
    const port = createWindowsDisplayPort({
      nativeApi: api,
      platform: "win32",
    });
    const discovered = await port.discover();
    if (discovered._tag !== "Success") {
      throw new Error("Expected the injected display discovery to succeed");
    }
    const [monitor] = discovered.value.topology.monitors;
    if (monitor === undefined) {
      throw new Error("Expected one discovered monitor");
    }
    const desired: DisplayProfile = {
      monitors: [
        {
          id: monitor.id,
          isPrimary: true,
          mode: monitor.mode,
          position: { x: 10, y: 0 },
        },
      ],
      version: 1,
    };
    const plan: ApplyPlan = {
      dryRun: false,
      isNoop: false,
      operations: [
        {
          _tag: "MoveMonitor",
          from: { x: 0, y: 0 },
          monitorId: monitor.id,
          to: { x: 10, y: 0 },
        },
      ],
    };

    const result = await port.applyDisplayPlan(
      discovered.value.topology,
      desired,
      plan
    );

    expect(result).toMatchObject({
      _tag: "Error",
      operation: "applyDisplayPlan",
      reason:
        "The live display topology no longer matches the topology used to generate the plan",
    });
    expect(discoveryCalls).toBe(2);
    expect(mutationCalls).toBe(0);
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
