import path from "node:path";

import {
  parseDisplayProfile,
  serializeDisplayProfile,
} from "@native-monitor-tools/core";
import type {
  DisplayProfile,
  InvalidDisplayProfile,
} from "@native-monitor-tools/core";
import type { FileSystem, PlatformError } from "effect";
import { Context, Effect } from "effect";

import { parseProfileName, profileFileName } from "./profile-name";
import type { ProfileName } from "./profile-name";
import { ProfileNotFound } from "./profile-not-found";
import { ProfileStoreError } from "./profile-store-error";

export { ProfileNotFound } from "./profile-not-found";
export { ProfileStoreError } from "./profile-store-error";

/** Application-owned persistence port for versioned display profiles. */
export interface ProfileStoreApi {
  readonly save: (
    name: ProfileName,
    profile: DisplayProfile
  ) => Effect.Effect<void, ProfileStoreError>;
  readonly list: () => Effect.Effect<readonly ProfileName[], ProfileStoreError>;
  readonly get: (
    name: ProfileName
  ) => Effect.Effect<
    DisplayProfile,
    ProfileNotFound | ProfileStoreError | InvalidDisplayProfile
  >;
  readonly pathFor: (name: ProfileName) => string;
}

/** Effect service key for the profile persistence port. */
export const ProfileStore = Context.Service<ProfileStoreApi>(
  "@native-monitor-tools/desktop/ProfileStore"
);

const mapFileSystemError = (
  operation: ProfileStoreError["operation"],
  filePath: string,
  cause: unknown
): ProfileStoreError =>
  new ProfileStoreError({ cause, operation, path: filePath });

const profileError = (
  operation: ProfileStoreError["operation"],
  filePath: string,
  effect: Effect.Effect<void, PlatformError.PlatformError>
): Effect.Effect<void, ProfileStoreError> =>
  effect.pipe(
    Effect.mapError((cause) => mapFileSystemError(operation, filePath, cause))
  );

/**
 * Construct a JSON profile store over an Effect FileSystem service.
 *
 * Writes create a temporary file in the profile directory, write the complete
 * versioned document, and rename it over the target. Cleanup is attempted on
 * every failure so an interrupted write cannot leave a target half-written.
 *
 * @param directory - Directory containing profile JSON files.
 * @param fileSystem - Effect's filesystem capability.
 * @returns A persistence port backed by that filesystem.
 */
export const makeJsonProfileStore = (
  directory: string,
  fileSystem: FileSystem.FileSystem
): ProfileStoreApi => {
  const pathFor = (name: ProfileName): string =>
    path.join(directory, profileFileName(name));

  const save = (
    name: ProfileName,
    profile: DisplayProfile
  ): Effect.Effect<void, ProfileStoreError> =>
    Effect.gen(function* saveProfileEffect() {
      yield* profileError(
        "write",
        directory,
        fileSystem.makeDirectory(directory, { recursive: true })
      );
      const target = pathFor(name);
      const temporary = yield* fileSystem
        .makeTempFile({
          directory,
          prefix: `.${name}.`,
          suffix: ".tmp",
        })
        .pipe(
          Effect.mapError((cause) =>
            mapFileSystemError("temporary-file", directory, cause)
          )
        );
      const writeAndRename = profileError(
        "write",
        temporary,
        fileSystem.writeFileString(
          temporary,
          `${serializeDisplayProfile(profile)}\n`
        )
      ).pipe(
        Effect.andThen(
          fileSystem
            .rename(temporary, target)
            .pipe(
              Effect.mapError((cause) =>
                mapFileSystemError("rename", target, cause)
              )
            )
        )
      );
      yield* writeAndRename.pipe(
        Effect.ensuring(
          Effect.ignore(fileSystem.remove(temporary, { force: true }))
        )
      );
    });

  const list = (): Effect.Effect<readonly ProfileName[], ProfileStoreError> =>
    Effect.gen(function* listProfilesEffect() {
      yield* profileError(
        "list",
        directory,
        fileSystem.makeDirectory(directory, { recursive: true })
      );
      const entries = yield* fileSystem
        .readDirectory(directory)
        .pipe(
          Effect.mapError((cause) =>
            mapFileSystemError("list", directory, cause)
          )
        );
      const names: ProfileName[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) {
          continue;
        }
        const candidate = entry.slice(0, -5);
        const parsed = yield* parseProfileName(candidate).pipe(Effect.option);
        if (parsed._tag === "Some") {
          names.push(parsed.value);
        }
      }
      return names.toSorted((left, right) => left.localeCompare(right));
    });

  const get = (
    name: ProfileName
  ): Effect.Effect<
    DisplayProfile,
    ProfileNotFound | ProfileStoreError | InvalidDisplayProfile
  > =>
    Effect.gen(function* getProfileEffect() {
      const profilePath = pathFor(name);
      const exists = yield* fileSystem
        .exists(profilePath)
        .pipe(
          Effect.mapError((cause) =>
            mapFileSystemError("read", profilePath, cause)
          )
        );
      if (!exists) {
        return yield* Effect.fail(new ProfileNotFound({ name }));
      }
      const serialized = yield* fileSystem
        .readFileString(profilePath)
        .pipe(
          Effect.mapError((cause) =>
            mapFileSystemError("read", profilePath, cause)
          )
        );
      return yield* parseDisplayProfile(serialized);
    });

  return { get, list, pathFor, save };
};
