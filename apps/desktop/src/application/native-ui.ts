import {
  makeMonitorSnapshot,
  makeMonitorTopology,
  profileFromTopology,
  validateDisplayProfile,
} from "@native-monitor-tools/core";
import type {
  ApplyPlan,
  DisplayProfile,
  InvalidApplyPlan,
  InvalidDisplayProfile,
  InvalidTopology,
  MonitorSnapshot,
  MonitorTopology,
  MonitorRuntimeApi,
  TopologyDiff,
} from "@native-monitor-tools/core";
import { Context, Data, Effect } from "effect";

import { createWindowsDisplayPort } from "../platform/windows";
import type {
  WindowsDisplayDiscovery,
  WindowsDisplayPort,
} from "../platform/windows";
import type {
  ProfileStoreApi,
  ProfileStoreError,
  ProfileNotFound,
} from "../storage";
import { parseProfileName } from "../storage/profile-name";
import type { InvalidProfileName, ProfileName } from "../storage/profile-name";

/** Capabilities exposed to a Native SDK UI client. */
export type NativeUiCapabilityName =
  | "monitorDiscovery"
  | "profileList"
  | "profileShow"
  | "profileSave"
  | "profileDiff"
  | "profileApplyPreview";

/** Availability and safe diagnostic for one Native SDK UI capability. */
export interface NativeUiCapability {
  readonly available: boolean;
  readonly reason?: string;
}

/** Versioned capability snapshot returned by the Native SDK UI boundary. */
export interface NativeUiCapabilitySnapshot {
  readonly version: 1;
  readonly capabilities: Readonly<
    Record<NativeUiCapabilityName, NativeUiCapability>
  >;
}

/** A failure returned by the platform adapter used for Native SDK UI calls. */
export class NativeUiAdapterError extends Data.TaggedError(
  "NativeUiAdapterError"
)<{
  readonly kind: "error" | "unsupported";
  readonly operation: "discover";
  readonly reason: string;
}> {}

/** Result returned after saving or previewing a profile. */
export interface NativeUiSavedProfile {
  readonly dryRun: boolean;
  readonly name: string;
  readonly profile: DisplayProfile;
  readonly saved: boolean;
}

/** Error channel for Native SDK UI application operations. */
export type NativeUiApplicationError =
  | ProfileNotFound
  | ProfileStoreError
  | NativeUiAdapterError
  | InvalidApplyPlan
  | InvalidDisplayProfile
  | InvalidTopology
  | InvalidProfileName;

/** Application operations needed by the Native SDK UI IPC adapter. */
export interface NativeUiApplicationApi {
  readonly capabilitySnapshot: () => NativeUiCapabilitySnapshot;
  readonly discoverMonitors: () => Effect.Effect<
    WindowsDisplayDiscovery,
    NativeUiApplicationError
  >;
  readonly listProfiles: () => Effect.Effect<
    readonly string[],
    NativeUiApplicationError
  >;
  readonly showProfile: (
    name: string
  ) => Effect.Effect<DisplayProfile, NativeUiApplicationError>;
  readonly saveProfile: (
    name: string,
    options?: {
      readonly dryRun?: boolean;
      readonly profile?: unknown;
    }
  ) => Effect.Effect<NativeUiSavedProfile, NativeUiApplicationError>;
  readonly diffProfile: (
    name: string
  ) => Effect.Effect<
    { readonly diff: TopologyDiff; readonly name: string },
    NativeUiApplicationError
  >;
  readonly previewProfileApply: (
    name: string
  ) => Effect.Effect<
    { readonly name: string; readonly plan: ApplyPlan },
    NativeUiApplicationError
  >;
}

/** Dependencies required to construct the Native SDK UI application service. */
export interface NativeUiApplicationDependencies {
  readonly monitorPort: WindowsDisplayPort;
  readonly platform: string;
  readonly profileStore: ProfileStoreApi;
  readonly runtime: MonitorRuntimeApi;
}

const profileTopology = (
  profile: DisplayProfile
): Effect.Effect<MonitorTopology, InvalidTopology> =>
  Effect.gen(function* profileTopologyEffect() {
    const snapshots: MonitorSnapshot[] = [];
    for (const monitor of profile.monitors) {
      const snapshot = yield* makeMonitorSnapshot({
        bounds: {
          height: monitor.mode.height,
          width: monitor.mode.width,
          x: monitor.position.x,
          y: monitor.position.y,
        },
        id: monitor.id,
        isPrimary: monitor.isPrimary,
        mode: monitor.mode,
        name: monitor.name ?? monitor.id,
      });
      snapshots.push(snapshot);
    }
    return yield* makeMonitorTopology(snapshots);
  });

const capability = (available: boolean, reason?: string): NativeUiCapability =>
  reason === undefined ? { available } : { available, reason };

const parseName = (
  input: string
): Effect.Effect<ProfileName, InvalidProfileName> => parseProfileName(input);

const adapterError = (
  kind: "error" | "unsupported",
  reason: string
): NativeUiAdapterError =>
  new NativeUiAdapterError({ kind, operation: "discover", reason });

/**
 * Construct the application service used by the Native SDK UI boundary.
 *
 * The service intentionally exposes only apply planning. It never invokes a
 * display mutation port, so a UI preview cannot change the desktop.
 *
 * @param dependencies - The platform, profile store, monitor adapter, and runtime.
 * @returns The Native SDK UI application service.
 */
export const makeNativeUiApplication = (
  dependencies: NativeUiApplicationDependencies
): NativeUiApplicationApi => {
  const monitorAvailable = dependencies.platform === "win32";
  const monitorUnavailableReason =
    "The Windows display adapter is unavailable off Windows";
  const capabilitySnapshot = (): NativeUiCapabilitySnapshot => ({
    capabilities: {
      monitorDiscovery: capability(
        monitorAvailable,
        monitorAvailable ? undefined : monitorUnavailableReason
      ),
      profileApplyPreview: capability(
        monitorAvailable,
        monitorAvailable ? undefined : monitorUnavailableReason
      ),
      profileDiff: capability(
        monitorAvailable,
        monitorAvailable ? undefined : monitorUnavailableReason
      ),
      profileList: capability(true),
      profileSave: capability(
        monitorAvailable,
        monitorAvailable ? undefined : monitorUnavailableReason
      ),
      profileShow: capability(true),
    },
    version: 1,
  });

  const discoverMonitors = (): Effect.Effect<
    WindowsDisplayDiscovery,
    NativeUiAdapterError
  > =>
    Effect.tryPromise({
      catch: (error) =>
        adapterError(
          "error",
          error instanceof Error ? error.message : "Monitor discovery failed"
        ),
      try: () => dependencies.monitorPort.discover(),
    }).pipe(
      Effect.flatMap((result) => {
        if (result._tag === "Success") {
          return Effect.succeed(result.value);
        }
        const kind = result._tag === "Unsupported" ? "unsupported" : "error";
        return Effect.fail(adapterError(kind, result.reason));
      })
    );

  const listProfiles = (): Effect.Effect<
    readonly string[],
    ProfileStoreError
  > =>
    dependencies.profileStore
      .list()
      .pipe(Effect.map((names) => names.map(String)));

  const showProfile = (
    input: string
  ): Effect.Effect<DisplayProfile, NativeUiApplicationError> =>
    Effect.gen(function* showProfileEffect() {
      const name = yield* parseName(input);
      return yield* dependencies.profileStore.get(name);
    });

  const saveProfile = (
    input: string,
    options: { readonly dryRun?: boolean; readonly profile?: unknown } = {}
  ): Effect.Effect<NativeUiSavedProfile, NativeUiApplicationError> =>
    Effect.gen(function* saveProfileEffect() {
      const name = yield* parseName(input);
      const dryRun = options.dryRun ?? false;
      const profile =
        options.profile === undefined
          ? yield* discoverMonitors().pipe(
              Effect.flatMap((discovery) =>
                profileFromTopology(discovery.topology)
              )
            )
          : yield* validateDisplayProfile(options.profile);
      if (!dryRun) {
        yield* dependencies.profileStore.save(name, profile);
      }
      return {
        dryRun,
        name: name.toString(),
        profile,
        saved: !dryRun,
      };
    });

  const diffProfile = (
    input: string
  ): Effect.Effect<
    { readonly diff: TopologyDiff; readonly name: string },
    NativeUiApplicationError
  > =>
    Effect.gen(function* diffProfileEffect() {
      const name = yield* parseName(input);
      const profile = yield* dependencies.profileStore.get(name);
      const current = yield* discoverMonitors();
      const desired = yield* profileTopology(profile);
      return {
        diff: dependencies.runtime.diff(current.topology, desired),
        name: name.toString(),
      };
    });

  const previewProfileApply = (
    input: string
  ): Effect.Effect<
    { readonly name: string; readonly plan: ApplyPlan },
    NativeUiApplicationError
  > =>
    Effect.gen(function* previewProfileApplyEffect() {
      const name = yield* parseName(input);
      const profile = yield* dependencies.profileStore.get(name);
      const current = yield* discoverMonitors();
      const plan = yield* dependencies.runtime.plan(current.topology, profile, {
        dryRun: true,
      });
      return { name: name.toString(), plan };
    });

  return {
    capabilitySnapshot,
    diffProfile,
    discoverMonitors,
    listProfiles,
    previewProfileApply,
    saveProfile,
    showProfile,
  };
};

/** Effect service key for the Native SDK UI application operations. */
export const NativeUiApplication = Context.Service<NativeUiApplicationApi>(
  "@native-monitor-tools/desktop/NativeUiApplication"
);

/** Construct a production Native SDK UI application with the Windows adapter. */
export const makeProductionNativeUiApplication = (
  profileStore: ProfileStoreApi,
  runtime: MonitorRuntimeApi,
  platform: string
): NativeUiApplicationApi =>
  makeNativeUiApplication({
    monitorPort: createWindowsDisplayPort(),
    platform,
    profileStore,
    runtime,
  });
