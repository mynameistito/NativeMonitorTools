import { layer as bunFileSystemLayer } from "@effect/platform-bun/BunFileSystem";
import { MonitorRuntime, MonitorRuntimeLive } from "@native-monitor-tools/core";
import { Effect, FileSystem, Layer } from "effect";

import { createWindowsDisplayPort } from "../platform/windows";
import type { DesktopPaths } from "../storage/configuration";
import {
  makeJsonProfileStore,
  ProfileStore as ProfileStoreService,
} from "../storage/profile-store";
import {
  DisplayApplierUnsupported,
  MonitorSourceUnsupported,
} from "./capabilities";
import { makeNativeUiApplication, NativeUiApplication } from "./native-ui";
import { DesktopApplicationLive } from "./service";

/**
 * Compose the production desktop shell without claiming any native capability.
 *
 * The filesystem is live because profile persistence is platform-independent;
 * monitor enumeration and display mutation remain explicit unsupported ports.
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
  return DesktopApplicationLive.pipe(
    Layer.provide(store),
    Layer.provide(MonitorSourceUnsupported),
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
      return makeNativeUiApplication({
        monitorPort: createWindowsDisplayPort(),
        platform,
        profileStore,
        runtime,
      });
    })
  );
  return application.pipe(
    Layer.provide(store),
    Layer.provide(MonitorRuntimeLive)
  );
};
