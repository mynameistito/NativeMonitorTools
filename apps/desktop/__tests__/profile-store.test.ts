import { layer as bunFileSystemLayer } from "@effect/platform-bun/BunFileSystem";
import {
  makeDisplayMode,
  makeDisplayProfile,
  makeMonitorSnapshot,
  makeMonitorTopology,
  parseMonitorId,
} from "@native-monitor-tools/core";
import { Effect, FileSystem } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { parseProfileName } from "../src/storage/profile-name";
import { makeJsonProfileStore } from "../src/storage/profile-store";

const fileSystem = Effect.runSync(
  Effect.provide(FileSystem.FileSystem, bunFileSystemLayer)
);
const temporaryDirectories: string[] = [];

const profile = Effect.runSync(
  Effect.gen(function* profileEffect() {
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
    const topology = yield* makeMonitorTopology([monitor]);
    return yield* makeDisplayProfile({
      monitors: topology.monitors.map((item) => ({
        id: item.id,
        isPrimary: item.isPrimary,
        mode: item.mode,
        name: item.name,
        position: { x: item.bounds.x, y: item.bounds.y },
      })),
    });
  })
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        Effect.runPromise(
          fileSystem.remove(directory, { force: true, recursive: true })
        )
      )
  );
});

describe("JSON profile store", () => {
  it("writes a complete versioned document through a temp file and rename", async () => {
    const directory = await Effect.runPromise(
      fileSystem.makeTempDirectory({ prefix: "nmt-profile-" })
    );
    temporaryDirectories.push(directory);
    const store = makeJsonProfileStore(directory, fileSystem);
    const name = Effect.runSync(parseProfileName("desk"));

    await Effect.runPromise(store.save(name, profile));

    const raw = await Effect.runPromise(
      fileSystem.readFileString(store.pathFor(name))
    );
    const entries = await Effect.runPromise(
      fileSystem.readDirectory(directory)
    );
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
    expect(entries).toContain("desk.json");
    expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    expect(await Effect.runPromise(store.get(name))).toEqual(profile);

    await Effect.runPromise(store.save(name, profile));
    expect(await Effect.runPromise(store.get(name))).toEqual(profile);
  });
});
