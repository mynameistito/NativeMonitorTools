import { layer as bunFileSystemLayer } from "@effect/platform-bun/BunFileSystem";
import { MonitorRuntime, MonitorRuntimeLive } from "@native-monitor-tools/core";
import type { MonitorTopology } from "@native-monitor-tools/core";
import { Effect, FileSystem, Layer } from "effect";

import { createWindowsDisplayPort } from "../platform/windows";
import type {
  WindowsDisplayDiscovery,
  WindowsDisplayPort,
  WindowsPlatformResult,
} from "../platform/windows";
import type { DesktopPaths } from "../storage/configuration";
import {
  makeJsonProfileStore,
  ProfileStore as ProfileStoreService,
} from "../storage/profile-store";
import {
  DisplayApplierUnsupported,
  MonitorSource,
  UnsupportedCapability,
} from "./capabilities";
import { NativePlatformError } from "./native-platform-error";
import {
  makeProductionNativeUiApplication,
  NativeUiApplication,
} from "./native-ui";
import { DesktopApplicationLive } from "./service";

const mapWindowsDiscovery = (
  result: WindowsPlatformResult<WindowsDisplayDiscovery>
): Effect.Effect<
  MonitorTopology,
  NativePlatformError | UnsupportedCapability
> => {
  if (result._tag === "Success") {
    return Effect.succeed(result.value.topology);
  }
  if (result._tag === "Unsupported") {
    return Effect.fail(
      new UnsupportedCapability({
        capability: "monitor",
        reason: result.reason,
      })
    );
  }
  return Effect.fail(
    new NativePlatformError({
      capability: "monitor",
      reason: result.reason,
    })
  );
};

const makeWindowsMonitorSourceLayer = (port: WindowsDisplayPort) =>
  Layer.succeed(MonitorSource, {
    currentTopology: () => {
      const discovery: Effect.Effect<
        WindowsPlatformResult<WindowsDisplayDiscovery>,
        NativePlatformError
      > = Effect.tryPromise({
        catch: (error) =>
          new NativePlatformError({
            capability: "monitor",
            reason:
              error instanceof Error
                ? error.message
                : "The Windows display adapter failed",
          }),
        try: () => port.discover(),
      });
      return discovery.pipe(Effect.flatMap(mapWindowsDiscovery));
    },
  });

/**
 * Compose the production desktop shell with live Windows monitor discovery.
 *
 * The filesystem is live because profile persistence is platform-independent;
 * display mutation remains an explicit unsupported port until mode mutation is
 * implemented by the Windows adapter.
 *
 * @param paths - Resolved application data paths.
 * @returns A layer providing the desktop application service.
 */
export const makeDesktopApplicationLayer = (paths: DesktopPaths) => {
  const store = Layer.effect(
    ProfileStoreService,
    Effect.gen(function* profileStoreLayerEffect() {
      const fileSystem = yield* FileSystem.FileSystem;
      return makeJsonProfileStore(paths.profileDirectory, fileSystem);
    })
  ).pipe(Layer.provide(bunFileSystemLayer));
  const monitorSource = makeWindowsMonitorSourceLayer(
    createWindowsDisplayPort()
  );
  return DesktopApplicationLive.pipe(
    Layer.provide(store),
    Layer.provide(monitorSource),
    Layer.provide(DisplayApplierUnsupported),
    Layer.provide(MonitorRuntimeLive)
  );
};

/**
 * Compose the Native SDK UI application with profile persistence and the
 * existing Windows monitor discovery adapter.
 *
 * The returned service deliberately does not include a display mutation port;
 * its apply operation is preview-only.
 *
 * @param paths - Resolved application data paths.
 * @param platform - Host platform identifier used for capability reporting.
 * @returns A layer providing the Native SDK UI application service.
 */
export const makeNativeUiApplicationLayer = (
  paths: DesktopPaths,
  platform: string = process.platform
) => {
  const store = Layer.effect(
    ProfileStoreService,
    Effect.gen(function* profileStoreLayerEffect() {
      const fileSystem = yield* FileSystem.FileSystem;
      return makeJsonProfileStore(paths.profileDirectory, fileSystem);
    })
  ).pipe(Layer.provide(bunFileSystemLayer));
  const application = Layer.effect(
    NativeUiApplication,
    Effect.gen(function* nativeUiApplicationLayerEffect() {
      const profileStore = yield* ProfileStoreService;
      const runtime = yield* MonitorRuntime;
      return makeProductionNativeUiApplication(profileStore, runtime, platform);
    })
  );
  return application.pipe(
    Layer.provide(store),
    Layer.provide(MonitorRuntimeLive)
  );
};
