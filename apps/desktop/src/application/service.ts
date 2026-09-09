import {
  makeMonitorSnapshot,
  makeMonitorTopology,
  MonitorRuntime,
  profileFromTopology,
} from "@native-monitor-tools/core";
import type {
  DisplayProfile,
  MonitorSnapshot,
  MonitorTopology,
  MonitorRuntimeApi,
  InvalidApplyPlan,
  InvalidDisplayProfile,
  InvalidTopology,
} from "@native-monitor-tools/core";
import { Context, Effect, Layer } from "effect";

import type { CliCommand } from "../cli/parser";
import type { CliResult } from "../cli/renderer";
import type {
  InvalidProfileName,
  ProfileStoreApi,
  ProfileNotFound,
  ProfileStoreError,
} from "../storage";
import { ProfileStore as ProfileStoreService } from "../storage/profile-store";
import {
  DisplayApplier,
  MonitorSource,
  UnsupportedCapability,
} from "./capabilities";
import type { DisplayApplierApi, MonitorSourceApi } from "./capabilities";
import type { NativePlatformError } from "./native-platform-error";

/** Errors that can be returned by a desktop application operation. */
export type DesktopApplicationError =
  | InvalidApplyPlan
  | InvalidDisplayProfile
  | InvalidProfileName
  | InvalidTopology
  | ProfileNotFound
  | ProfileStoreError
  | NativePlatformError
  | UnsupportedCapability;

/** Application service for parsed desktop commands. */
export interface DesktopApplicationApi {
  readonly execute: (
    command: CliCommand
  ) => Effect.Effect<CliResult, DesktopApplicationError>;
}

/** Effect service key for the desktop application service. */
export const DesktopApplication = Context.Service<DesktopApplicationApi>(
  "@native-monitor-tools/desktop/DesktopApplication"
);

const impossible = (value: never): never => {
  throw new Error(`Unexpected desktop command: ${String(value)}`);
};

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

const executeCommand = (
  command: CliCommand,
  monitorSource: MonitorSourceApi,
  profileStore: ProfileStoreApi,
  displayApplier: DisplayApplierApi,
  runtime: MonitorRuntimeApi
): Effect.Effect<CliResult, DesktopApplicationError> => {
  switch (command._tag) {
    case "Help": {
      return Effect.succeed({ _tag: "HelpResult" });
    }
    case "Unsupported": {
      return Effect.fail(
        new UnsupportedCapability({
          capability: command.capability,
          reason: `The ${command.capability} command is reserved for a native platform adapter`,
        })
      );
    }
    case "MonitorList": {
      return monitorSource.currentTopology().pipe(
        Effect.map((topology) => ({
          _tag: "MonitorListResult",
          monitors: topology.monitors,
        }))
      );
    }
    case "ProfileList": {
      return profileStore.list().pipe(
        Effect.map((profiles) => ({
          _tag: "ProfileListResult",
          profiles: profiles.map((name) => name.toString()),
        }))
      );
    }
    case "ProfileSave": {
      return Effect.gen(function* profileSaveEffect() {
        const topology = yield* monitorSource.currentTopology();
        const profile = yield* profileFromTopology(topology);
        if (!command.dryRun) {
          yield* profileStore.save(command.name, profile);
        }
        return {
          _tag: "ProfileSavedResult",
          dryRun: command.dryRun,
          name: command.name.toString(),
          profile,
        };
      });
    }
    case "ProfileShow": {
      return profileStore.get(command.name).pipe(
        Effect.map((profile) => ({
          _tag: "ProfileShownResult",
          name: command.name.toString(),
          profile,
        }))
      );
    }
    case "ProfileDiff": {
      return Effect.gen(function* profileDiffEffect() {
        const profile = yield* profileStore.get(command.name);
        const current = yield* monitorSource.currentTopology();
        const desired = yield* profileTopology(profile);
        return {
          _tag: "ProfileDiffResult",
          diff: runtime.diff(current, desired),
          name: command.name.toString(),
        };
      });
    }
    case "ProfileApply": {
      return Effect.gen(function* profileApplyEffect() {
        const profile = yield* profileStore.get(command.name);
        const current = yield* monitorSource.currentTopology();
        const plan = yield* runtime.plan(current, profile, {
          dryRun: command.dryRun,
        });
        if (!command.dryRun && !plan.isNoop) {
          yield* displayApplier.apply(current, profile, plan);
        }
        return {
          _tag: "ProfileAppliedResult",
          dryRun: command.dryRun,
          name: command.name.toString(),
          plan,
        };
      });
    }
    default: {
      return impossible(command);
    }
  }
};

/** Live application service that composes storage, monitor ports, and core algorithms. */
export const DesktopApplicationLive = Layer.effect(
  DesktopApplication,
  Effect.gen(function* desktopApplicationLiveEffect() {
    const monitorSource = yield* MonitorSource;
    const profileStore = yield* ProfileStoreService;
    const displayApplier = yield* DisplayApplier;
    const runtime = yield* MonitorRuntime;
    return {
      execute: (command: CliCommand) =>
        executeCommand(
          command,
          monitorSource,
          profileStore,
          displayApplier,
          runtime
        ),
    };
  })
);
