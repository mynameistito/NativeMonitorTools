import { layer as bunFileSystemLayer } from "@effect/platform-bun/BunFileSystem";
import {
  makeDisplayMode,
  makeDisplayProfile,
  makeMonitorSnapshot,
  makeMonitorTopology,
  MonitorRuntimeLive,
  parseMonitorId,
} from "@native-monitor-tools/core";
import { Effect, FileSystem, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { DisplayApplier, MonitorSource } from "../src/application/capabilities";
import {
  DesktopApplication,
  DesktopApplicationLive,
} from "../src/application/service";
import { parseCliArgs } from "../src/cli/parser";
import { parseProfileName } from "../src/storage/profile-name";
import {
  makeJsonProfileStore,
  ProfileStore,
} from "../src/storage/profile-store";

const makeTopology = Effect.gen(function* makeTopologyEffect() {
  const mode = yield* makeDisplayMode({
    height: 1080,
    refreshRate: 60,
    width: 1920,
  });
  const monitor = yield* makeMonitorSnapshot({
    bounds: { height: 1080, width: 1920, x: 0, y: 0 },
    id: yield* parseMonitorId("primary"),
    isPrimary: true,
    mode,
    name: "Primary",
  });
  return yield* makeMonitorTopology([monitor]);
});

describe("profile apply dry-run", () => {
  it("plans changes without invoking the display mutation port", async () => {
    const fileSystem = await Effect.runPromise(
      Effect.provide(FileSystem.FileSystem, bunFileSystemLayer)
    );
    const directory = await Effect.runPromise(
      fileSystem.makeTempDirectory({ prefix: "nmt-dry-run-" })
    );
    const current = await Effect.runPromise(makeTopology);
    const name = Effect.runSync(parseProfileName("desk"));
    const desired = Effect.runSync(
      makeDisplayProfile({
        monitors: [
          {
            id: current.primaryId,
            isPrimary: true,
            mode:
              current.monitors[0]?.mode ??
              Effect.runSync(
                makeDisplayMode({ height: 1080, refreshRate: 60, width: 1920 })
              ),
            name: "Primary",
            position: { x: 100, y: 0 },
          },
        ],
      })
    );
    const store = makeJsonProfileStore(directory, fileSystem);
    await Effect.runPromise(store.save(name, desired));

    let applied = false;
    const layer = DesktopApplicationLive.pipe(
      Layer.provide(Layer.succeed(ProfileStore, store)),
      Layer.provide(
        Layer.succeed(MonitorSource, {
          currentTopology: () => Effect.succeed(current),
        })
      ),
      Layer.provide(
        Layer.succeed(DisplayApplier, {
          apply: () =>
            Effect.sync(() => {
              applied = true;
            }),
        })
      ),
      Layer.provide(MonitorRuntimeLive)
    );
    const command = await Effect.runPromise(
      parseCliArgs(["profile", "apply", "desk", "--dry-run"])
    );
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* runApplicationEffect() {
          const application = yield* DesktopApplication;
          return yield* application.execute(command);
        }),
        layer
      )
    );

    expect(result._tag).toBe("ProfileAppliedResult");
    if (result._tag === "ProfileAppliedResult") {
      expect(result.plan.dryRun).toBe(true);
      expect(result.plan.isNoop).toBe(false);
    }
    expect(applied).toBe(false);
    await Effect.runPromise(
      fileSystem.remove(directory, { force: true, recursive: true })
    );
  });
});
