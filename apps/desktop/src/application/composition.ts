import { layer as bunFileSystemLayer } from "@effect/platform-bun/BunFileSystem";
import { MonitorRuntimeLive } from "@native-monitor-tools/core";
import { Effect, FileSystem, Layer } from "effect";

import type { DesktopPaths } from "../storage/configuration";
import {
  makeJsonProfileStore,
  ProfileStore as ProfileStoreService,
} from "../storage/profile-store";
import {
  DisplayApplierUnsupported,
  MonitorSourceUnsupported,
} from "./capabilities";
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
