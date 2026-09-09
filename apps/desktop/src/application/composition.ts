import { layer as bunFileSystemLayer } from "@effect/platform-bun/BunFileSystem";
import { MonitorRuntime, MonitorRuntimeLive } from "@native-monitor-tools/core";
import type {
  ApplyPlan,
  DisplayProfile,
  MonitorTopology,
} from "@native-monitor-tools/core";
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
  DisplayApplier,
  MonitorSource,
  UnsupportedCapability,
} from "./capabilities";
import { NativePlatformError } from "./native-platform-error";
import {
  makeProductionNativeUiApplication,
  NativeUiApplication,
} from "./native-ui";
import { DesktopApplicationLive } from "./service";

const DISPLAY_APPLY_CAPABILITY = "display-apply" as const;

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

const mapWindowsApplyResult = (
  result: WindowsPlatformResult<void>
): Effect.Effect<void, NativePlatformError | UnsupportedCapability> => {
  if (result._tag === "Success") {
    return Effect.void;
  }
  if (result._tag === "Unsupported") {
    return Effect.fail(
      new UnsupportedCapability({
        capability: DISPLAY_APPLY_CAPABILITY,
        reason: result.reason,
      })
    );
  }
  return Effect.fail(
    new NativePlatformError({
      capability: DISPLAY_APPLY_CAPABILITY,
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

const makeWindowsDisplayApplierLayer = (port: WindowsDisplayPort) =>
  Layer.succeed(DisplayApplier, {
    apply: (
      current: MonitorTopology,
      desired: DisplayProfile,
      plan: ApplyPlan
    ): Effect.Effect<void, NativePlatformError | UnsupportedCapability> => {
      const application: Effect.Effect<
        WindowsPlatformResult<void>,
        NativePlatformError
      > = Effect.tryPromise({
        catch: (error) =>
          new NativePlatformError({
            capability: "display-apply",
            reason:
              error instanceof Error
                ? error.message
                : "The Windows display adapter failed",
          }),
        try: () => port.applyDisplayPlan(current, desired, plan),
      });
      return application.pipe(Effect.flatMap(mapWindowsApplyResult));
    },
  });

/**
 * Compose the production desktop shell with live Windows monitor discovery.
 *
 * The filesystem and Windows display ports are live. Display mutation remains
 * dry-run-first at the application boundary and is only invoked for an
 * explicitly non-dry-run CLI command.
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
  const monitorPort = createWindowsDisplayPort();
  const monitorSource = makeWindowsMonitorSourceLayer(monitorPort);
  const displayApplier = makeWindowsDisplayApplierLayer(monitorPort);
  return DesktopApplicationLive.pipe(
    Layer.provide(store),
    Layer.provide(monitorSource),
    Layer.provide(displayApplier),
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
