import {
  makeDisplayMode,
  makeMonitorSnapshot,
  makeMonitorTopology,
  parseMonitorId,
} from "@native-monitor-tools/core";
import type { MonitorTopology } from "@native-monitor-tools/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { NativeUiCapabilitySnapshot } from "../src/application/native-ui";
import {
  decodeNativeUiArgument,
  encodeDisplays,
  encodeNativeUiArgument,
  nativeUiFrameLimit,
  runNativeUiRequest,
} from "../src/native-ui-host";
import type { WindowsDisplayDiscovery } from "../src/platform/windows";

const makeDisplayDiscovery = (): WindowsDisplayDiscovery => {
  const monitorId = Effect.runSync(parseMonitorId("device:test-primary"));
  const mode = Effect.runSync(
    makeDisplayMode({ height: 1080, refreshRate: 60, width: 1920 })
  );
  const snapshot = Effect.runSync(
    makeMonitorSnapshot({
      bounds: { height: 1080, width: 1920, x: 0, y: 0 },
      id: monitorId,
      isPrimary: true,
      mode,
      name: "Primary",
    })
  );
  const topology: MonitorTopology = Effect.runSync(
    makeMonitorTopology([snapshot])
  );
  return {
    displays: [
      {
        identity: {
          deviceName: "\\\\.\\DISPLAY1",
          source: "logical-device-name",
        },
        snapshot,
      },
    ],
    topology,
  };
};

const makeCapabilitySnapshot = (
  color: boolean,
  windowTools: boolean
): NativeUiCapabilitySnapshot => ({
  capabilities: {
    color: { available: color },
    monitorDiscovery: { available: true },
    profileApplyPreview: { available: true },
    profileDiff: { available: true },
    profileList: { available: true },
    profileSave: { available: true },
    profileShow: { available: true },
    windowTools: { available: windowTools },
  },
  version: 1,
});

describe("Native SDK UI host framing", () => {
  it("decodes the bounded hexadecimal service argument", () => {
    expect(decodeNativeUiArgument("01010000")).toEqual(
      new Uint8Array([1, 1, 0, 0])
    );
    expect(decodeNativeUiArgument("01010")).toBeNull();
    expect(decodeNativeUiArgument("0101zz00")).toBeNull();
    expect(decodeNativeUiArgument("0g")).toBeNull();
  });

  it("round-trips every byte through the text-only response carrier", () => {
    const frame = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(decodeNativeUiArgument(encodeNativeUiArgument(frame))).toEqual(
      frame
    );
  });

  it("encodes current color and window capabilities in the display frame flags", () => {
    const discovery = makeDisplayDiscovery();

    expect(
      encodeDisplays(discovery, makeCapabilitySnapshot(true, false)).slice(-2)
    ).toEqual(new Uint8Array([1, 0]));
    expect(
      encodeDisplays(discovery, makeCapabilitySnapshot(false, true)).slice(-2)
    ).toEqual(new Uint8Array([0, 1]));
  });

  it("rejects malformed requests without touching platform services", async () => {
    const response = await runNativeUiRequest(new Uint8Array([1, 1, 0]));
    const message = new TextEncoder().encode(
      "Native UI request is not a valid protocol v1 frame."
    );
    const high = Math.trunc(message.length / 256);
    expect(response).toEqual(
      new Uint8Array([1, 255, 0, message.length - high * 256, high, ...message])
    );
  });

  it("rejects oversized requests with a bounded error frame", async () => {
    const response = await runNativeUiRequest(
      new Uint8Array(nativeUiFrameLimit + 1)
    );

    expect(response.byteLength).toBeLessThanOrEqual(nativeUiFrameLimit);
    expect(response.slice(0, 3)).toEqual(new Uint8Array([1, 255, 0]));
    expect(new TextDecoder().decode(response.slice(5))).toBe(
      "Native UI request exceeds the frame size limit."
    );
  });

  it("rejects malformed foreground-window snap frames before platform access", async () => {
    const response = await runNativeUiRequest(
      new Uint8Array([1, 7, 1, 0, 65, 0, 0])
    );

    expect(response.slice(0, 2)).toEqual(new Uint8Array([1, 255]));
  });
});
