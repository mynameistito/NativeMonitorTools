import {
  makeDisplayMode,
  makeMonitorSnapshot,
  makeMonitorTopology,
  MonitorRuntime,
  MonitorRuntimeLive,
  parseMonitorId,
} from "@native-monitor-tools/core";
import type { DisplayProfile } from "@native-monitor-tools/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeNativeUiApplication } from "../src/application/native-ui";
import { handleIpcLine, parseIpcResponse, serveNativeUiIpc } from "../src/ipc";
import type { IpcTransport } from "../src/ipc";
import type {
  WindowsDisplay,
  WindowsDisplayDiscovery,
  WindowsDisplayPort,
  WindowsPlatformOperation,
  WindowsPlatformResult,
} from "../src/platform/windows";
import type { ProfileName } from "../src/storage/profile-name";
import { ProfileNotFound } from "../src/storage/profile-not-found";
import type { ProfileStoreApi } from "../src/storage/profile-store";

const unsupported = <T>(
  operation: WindowsPlatformOperation
): WindowsPlatformResult<T> => ({
  _tag: "Unsupported",
  operation,
  reason: "Not used by the IPC test fixture",
});

const makeFixture = () => {
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
  const topology = Effect.runSync(makeMonitorTopology([snapshot]));
  const display: WindowsDisplay = {
    identity: {
      deviceName: "\\\\.\\DISPLAY1",
      source: "logical-device-name",
    },
    snapshot,
  };
  const discovery: WindowsDisplayDiscovery = {
    displays: [display],
    topology,
  };
  const profiles = new Map<
    string,
    { name: ProfileName; profile: DisplayProfile }
  >();
  const profileStore: ProfileStoreApi = {
    get: (name) => {
      const stored = profiles.get(name.toString());
      return stored === undefined
        ? Effect.fail(new ProfileNotFound({ name: name.toString() }))
        : Effect.succeed(stored.profile);
    },
    list: () =>
      Effect.succeed([...profiles.values()].map((stored) => stored.name)),
    pathFor: (name) => `${name}.json`,
    save: (name, profile) =>
      Effect.sync(() => {
        profiles.set(name.toString(), { name, profile });
      }),
  };
  const monitorPort: WindowsDisplayPort = {
    applyDisplayPlan: () => Promise.resolve(unsupported("applyDisplayPlan")),
    discover: () => Promise.resolve({ _tag: "Success", value: discovery }),
    getBrightnessContrastCapabilities: () =>
      Promise.resolve(unsupported("getBrightnessContrastCapabilities")),
    getGammaRamp: () => Promise.resolve(unsupported("getGammaRamp")),
    setBrightness: () => Promise.resolve(unsupported("setBrightness")),
    setContrast: () => Promise.resolve(unsupported("setContrast")),
    setGammaRamp: () => Promise.resolve(unsupported("setGammaRamp")),
  };
  const runtime = Effect.runSync(
    Effect.provide(MonitorRuntime, MonitorRuntimeLive)
  );
  const application = makeNativeUiApplication({
    monitorPort,
    platform: "win32",
    profileStore,
    runtime,
  });
  return { application };
};

const transportFrom = (input: string, output: string[]): IpcTransport => ({
  readChunks: async function* readChunks() {
    yield input;
  },
  writeLine: (line) => {
    output.push(line);
    return Promise.resolve();
  },
});

describe("Native SDK UI IPC", () => {
  it("serves capabilities, monitor discovery, and profile operations over JSON lines", async () => {
    const { application } = makeFixture();
    const output: string[] = [];
    const requests = [
      { id: "capabilities", method: "capabilities.get", version: 1 },
      { id: "monitors", method: "monitors.list", version: 1 },
      {
        id: "save",
        method: "profiles.save",
        params: { name: "desk" },
        version: 1,
      },
      { id: "list", method: "profiles.list", version: 1 },
      {
        id: "show",
        method: "profiles.show",
        params: { name: "desk" },
        version: 1,
      },
      {
        id: "diff",
        method: "profiles.diff",
        params: { name: "desk" },
        version: 1,
      },
      {
        id: "preview",
        method: "profiles.applyPreview",
        params: { name: "desk" },
        version: 1,
      },
    ]
      .map((request) => JSON.stringify(request))
      .join("\n");

    await serveNativeUiIpc(transportFrom(`${requests}\n`, output), application);

    const responses = output.map((line) => JSON.parse(line));
    expect(responses).toHaveLength(7);
    expect(responses.map((response) => response.id)).toEqual([
      "capabilities",
      "monitors",
      "save",
      "list",
      "show",
      "diff",
      "preview",
    ]);
    expect(responses[0]?.result.capabilities.monitorDiscovery.available).toBe(
      true
    );
    expect(responses[1]?.result.topology.monitors).toHaveLength(1);
    expect(responses[2]?.result.saved).toBe(true);
    expect(responses[3]?.result).toEqual(["desk"]);
    expect(responses[4]?.result.profile).toEqual(responses[2]?.result.profile);
    expect(responses[5]?.result.diff.isChanged).toBe(false);
    expect(responses[6]?.result.plan.dryRun).toBe(true);
  });

  it("returns typed validation errors and never accepts a request without an id", async () => {
    const { application } = makeFixture();
    const missingId = JSON.parse(
      await handleIpcLine(
        JSON.stringify({ method: "capabilities.get", version: 1 }),
        application
      )
    );
    const unknownMethod = JSON.parse(
      await handleIpcLine(
        JSON.stringify({ id: "unknown", method: "eval", version: 1 }),
        application
      )
    );
    const invalidProfile = JSON.parse(
      await handleIpcLine(
        JSON.stringify({
          id: "invalid-profile",
          method: "profiles.save",
          params: {
            name: "desk",
            profile: { code: "not executable content" },
          },
          version: 1,
        }),
        application
      )
    );

    expect(missingId).toMatchObject({
      error: { code: "INVALID_REQUEST" },
      id: null,
      ok: false,
      version: 1,
    });
    expect(unknownMethod).toMatchObject({
      error: { code: "UNKNOWN_METHOD" },
      id: "unknown",
      ok: false,
    });
    expect(invalidProfile).toMatchObject({
      error: { code: "INVALID_PROFILE" },
      id: "invalid-profile",
      ok: false,
    });
  });

  it("converts an oversized line into a typed transport error response", async () => {
    const { application } = makeFixture();
    const output: string[] = [];
    await serveNativeUiIpc(
      transportFrom("x".repeat(400), output),
      application,
      { maxMessageBytes: 256 }
    );

    const response = parseIpcResponse(output[0] ?? "");
    expect(response._tag).toBe("Success");
    if (response._tag === "Success") {
      expect(response.value).toMatchObject({
        error: { code: "MESSAGE_TOO_LARGE" },
        id: null,
        ok: false,
      });
    }
  });
});
