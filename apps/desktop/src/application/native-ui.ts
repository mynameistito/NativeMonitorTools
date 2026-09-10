import {
  createDefaultGammaManagerSettings,
  createGammaRamp,
  findMonitor,
  GAMMA_MAXIMUM,
  GAMMA_MINIMUM,
  makeSystemSnapAreaGroups,
  makeMonitorSnapshot,
  makeMonitorTopology,
  parseMonitorId,
  planWindowSnap,
  profileFromTopology,
  setRgbAdjustment,
  validateDisplayProfile,
} from "@native-monitor-tools/core";
import type {
  ApplyPlan,
  DisplayProfile,
  InvalidApplyPlan,
  InvalidDisplayProfile,
  InvalidMonitorId,
  InvalidTopology,
  MonitorSnapshot,
  MonitorTopology,
  MonitorId,
  MonitorRuntimeApi,
  TopologyDiff,
} from "@native-monitor-tools/core";
import { Context, Data, Effect } from "effect";

import { createWindowsDisplayPort } from "../platform/windows";
import type {
  BrightnessContrastCapabilities,
  ExternalLevelCapability,
  WindowsDisplayDiscovery,
  GammaRamp as WindowsGammaRamp,
  WindowsDisplayPort,
  WindowsPlatformOperation,
  WindowsPlatformResult,
} from "../platform/windows";
import { createWindowsWindowPort } from "../platform/windows/window";
import type {
  WindowsWindowPort,
  WindowsWindowOperation,
  WindowsWindowResult,
} from "../platform/windows/window";
import type {
  ProfileStoreApi,
  ProfileStoreError,
  ProfileNotFound,
} from "../storage";
import { parseProfileName } from "../storage/profile-name";
import type { InvalidProfileName, ProfileName } from "../storage/profile-name";

/** Capabilities exposed to a Native SDK UI client. */
export type NativeUiCapabilityName =
  | "color"
  | "monitorDiscovery"
  | "windowTools"
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

/** The readable color state and capability for one discovered monitor. */
export interface NativeUiColorState {
  readonly brightness: ExternalLevelCapability;
  readonly contrast: ExternalLevelCapability;
  readonly displayName: string;
  readonly gamma:
    | { readonly _tag: "Supported"; readonly current: WindowsGammaRamp }
    | { readonly _tag: "Unsupported"; readonly reason: string };
  readonly monitorId: string;
}

/** One validated color mutation requested by a Native SDK UI client. */
export interface NativeUiColorSetRequest {
  readonly control: "gamma" | "brightness" | "contrast";
  readonly monitorId: string;
  readonly value: number;
}

/** One built-in snap area exposed to the Native SDK UI. */
export interface NativeUiWindowArea {
  readonly areaId: string;
  readonly monitorId: string;
  readonly monitorName: string;
  readonly name: string;
}

/** A validated request to snap the foreground window. */
export interface NativeUiWindowSnapRequest {
  readonly areaId: string;
  readonly monitorId: string;
}

/** Stable acknowledgement returned after a foreground-window snap. */
export interface NativeUiWindowSnapResult {
  readonly areaId: string;
  readonly monitorId: string;
}

/** A failure returned by the platform adapter used for Native SDK UI calls. */
export class NativeUiAdapterError extends Data.TaggedError(
  "NativeUiAdapterError"
)<{
  readonly kind: "error" | "unsupported";
  readonly operation: WindowsPlatformOperation | WindowsWindowOperation;
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
  | InvalidMonitorId
  | InvalidTopology
  | InvalidProfileName;

/** Application operations needed by the Native SDK UI IPC adapter. */
export interface NativeUiApplicationApi {
  readonly capabilitySnapshot: () => NativeUiCapabilitySnapshot;
  readonly listColor: () => Effect.Effect<
    readonly NativeUiColorState[],
    NativeUiApplicationError
  >;
  readonly setColor: (
    request: NativeUiColorSetRequest
  ) => Effect.Effect<NativeUiColorState, NativeUiApplicationError>;
  readonly listWindowAreas: () => Effect.Effect<
    readonly NativeUiWindowArea[],
    NativeUiApplicationError
  >;
  readonly snapForegroundWindow: (
    request: NativeUiWindowSnapRequest
  ) => Effect.Effect<NativeUiWindowSnapResult, NativeUiApplicationError>;
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
  readonly windowPort?: WindowsWindowPort;
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
  operation: WindowsPlatformOperation | WindowsWindowOperation,
  reason: string
): NativeUiAdapterError =>
  new NativeUiAdapterError({ kind, operation, reason });

const windowAreasFromDiscovery = (
  discovery: WindowsDisplayDiscovery
): readonly NativeUiWindowArea[] => {
  const areas: NativeUiWindowArea[] = [];
  for (const group of makeSystemSnapAreaGroups(discovery.topology)) {
    const monitor = findMonitor(discovery.topology, group.monitorId);
    if (monitor === undefined) {
      continue;
    }
    for (const area of group.areas) {
      areas.push({
        areaId: area.id,
        monitorId: group.monitorId,
        monitorName: monitor.name,
        name: area.name,
      });
    }
  }
  return areas;
};

const findWindowArea = (
  discovery: WindowsDisplayDiscovery,
  monitorId: MonitorId,
  areaId: string
) => {
  const group = makeSystemSnapAreaGroups(discovery.topology).find(
    (candidate) => candidate.monitorId === monitorId
  );
  const monitor = findMonitor(discovery.topology, monitorId);
  const area = group?.areas.find((candidate) => candidate.id === areaId);
  return monitor === undefined || area === undefined
    ? undefined
    : { area, monitor };
};

const runWindowOperation = <T>(
  operation: WindowsWindowOperation,
  action: () => Promise<WindowsWindowResult<T>>
): Effect.Effect<T, NativeUiAdapterError> =>
  Effect.tryPromise({
    catch: (error) =>
      adapterError(
        "error",
        operation,
        error instanceof Error ? error.message : "Window operation failed"
      ),
    try: action,
  }).pipe(
    Effect.flatMap((result) => {
      if (result._tag === "Success") {
        return Effect.succeed(result.value);
      }
      return Effect.fail(
        adapterError(
          result._tag === "Unsupported" ? "unsupported" : "error",
          result.operation,
          result.reason
        )
      );
    })
  );

type ReadablePlatformResult<T> = Exclude<
  WindowsPlatformResult<T>,
  { readonly _tag: "Error" }
>;

const externalCapability = (
  result: ReadablePlatformResult<BrightnessContrastCapabilities>,
  control: "brightness" | "contrast"
): ExternalLevelCapability => {
  if (result._tag === "Success") {
    return result.value[control];
  }
  return { _tag: "Unsupported", reason: result.reason };
};

const gammaCapability = (
  result: ReadablePlatformResult<WindowsGammaRamp>
): NativeUiColorState["gamma"] =>
  result._tag === "Success"
    ? { _tag: "Supported", current: result.value }
    : { _tag: "Unsupported", reason: result.reason };

const windowsGammaRamp = (
  ramp: readonly [Uint16Array, Uint16Array, Uint16Array]
): WindowsGammaRamp => ({
  blue: [...ramp[2]],
  green: [...ramp[1]],
  red: [...ramp[0]],
});

const colorValueError = (request: NativeUiColorSetRequest): string | null => {
  if (!Number.isFinite(request.value)) {
    return "Color values must be finite numbers";
  }
  if (request.control === "gamma") {
    return request.value < GAMMA_MINIMUM || request.value > GAMMA_MAXIMUM
      ? `Gamma must be between ${GAMMA_MINIMUM} and ${GAMMA_MAXIMUM}`
      : null;
  }
  if (!Number.isInteger(request.value)) {
    return "External color values must be whole numbers";
  }
  if (request.value < 0 || request.value > 65_535) {
    return `${request.control} must be between 0 and 65535`;
  }
  return null;
};

const colorOperation = (
  control: NativeUiColorSetRequest["control"]
): "setGammaRamp" | "setBrightness" | "setContrast" => {
  if (control === "gamma") {
    return "setGammaRamp";
  }
  if (control === "brightness") {
    return "setBrightness";
  }
  return "setContrast";
};

const writeColor = (
  port: WindowsDisplayPort,
  monitorId: MonitorSnapshot["id"],
  request: NativeUiColorSetRequest
): Promise<WindowsPlatformResult<void>> => {
  if (request.control === "gamma") {
    return port.setGammaRamp(
      monitorId,
      windowsGammaRamp(
        createGammaRamp(
          setRgbAdjustment(
            createDefaultGammaManagerSettings(request.monitorId),
            "gamma",
            request.value,
            "linked"
          )
        )
      )
    );
  }
  if (request.control === "brightness") {
    return port.setBrightness(monitorId, request.value);
  }
  return port.setContrast(monitorId, request.value);
};

const readColorState = async (
  port: WindowsDisplayPort,
  display: WindowsDisplayDiscovery["displays"][number]
): Promise<WindowsPlatformResult<NativeUiColorState>> => {
  const [gamma, external] = await Promise.all([
    port.getGammaRamp(display.snapshot.id),
    port.getBrightnessContrastCapabilities(display.snapshot.id),
  ]);
  if (gamma._tag === "Error") {
    return gamma;
  }
  if (external._tag === "Error") {
    return external;
  }
  return {
    _tag: "Success",
    value: {
      brightness: externalCapability(external, "brightness"),
      contrast: externalCapability(external, "contrast"),
      displayName: display.snapshot.name,
      gamma: gammaCapability(gamma),
      monitorId: display.snapshot.id,
    },
  };
};

const readColorStates = async (
  port: WindowsDisplayPort,
  displays: readonly WindowsDisplayDiscovery["displays"][number][]
): Promise<WindowsPlatformResult<NativeUiColorState[]>> => {
  const results = await Promise.all(
    displays.map((display) => readColorState(port, display))
  );
  const states: NativeUiColorState[] = [];
  for (const result of results) {
    if (result._tag !== "Success") {
      return result;
    }
    states.push(result.value);
  }
  return {
    _tag: "Success",
    value: states,
  };
};

const hasUsableColorControl = (state: NativeUiColorState): boolean =>
  state.gamma._tag === "Supported" ||
  state.brightness._tag === "Supported" ||
  state.contrast._tag === "Supported";

type ColorControlAvailability = "unknown" | "available" | "unavailable";

const colorCapability = (
  monitorAvailable: boolean,
  colorControls: ColorControlAvailability
): NativeUiCapability => {
  if (!monitorAvailable) {
    return capability(
      false,
      "The Windows display adapter is unavailable off Windows"
    );
  }
  if (colorControls === "unknown") {
    return capability(
      false,
      "Color controls have not been read from the connected monitors"
    );
  }
  if (colorControls === "unavailable") {
    return capability(
      false,
      "No usable color controls were reported by the connected monitors"
    );
  }
  return capability(true);
};

const refreshedColorState = (
  listColor: () => Effect.Effect<
    readonly NativeUiColorState[],
    NativeUiApplicationError
  >,
  monitorId: string,
  operation: WindowsPlatformOperation
): Effect.Effect<NativeUiColorState, NativeUiApplicationError> =>
  listColor().pipe(
    Effect.flatMap((states) => {
      const state = states.find(
        (candidate) => candidate.monitorId === monitorId
      );
      return state === undefined
        ? Effect.fail(
            adapterError(
              "error",
              operation,
              "The requested monitor disappeared after the color write"
            )
          )
        : Effect.succeed(state);
    })
  );

/**
 * Construct the application service used by the Native SDK UI boundary.
 *
 * Profile actions remain preview-only. Color writes are a separate, typed
 * operation that validates ranges and delegates only to the bounded color
 * controls exposed by the Windows display port.
 *
 * @param dependencies - The platform, profile store, monitor adapter, and runtime.
 * @returns The Native SDK UI application service.
 */
export const makeNativeUiApplication = (
  dependencies: NativeUiApplicationDependencies
): NativeUiApplicationApi => {
  const monitorAvailable = dependencies.platform === "win32";
  const windowAvailable =
    monitorAvailable && dependencies.windowPort !== undefined;
  const monitorUnavailableReason =
    "The Windows display adapter is unavailable off Windows";
  const windowUnavailableReason =
    "The Windows foreground-window port is unavailable";
  let colorControls: ColorControlAvailability = monitorAvailable
    ? "unknown"
    : "unavailable";
  const capabilitySnapshot = (): NativeUiCapabilitySnapshot => ({
    capabilities: {
      color: colorCapability(monitorAvailable, colorControls),
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
      windowTools: capability(
        windowAvailable,
        windowAvailable ? undefined : windowUnavailableReason
      ),
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
          "discover",
          error instanceof Error ? error.message : "Monitor discovery failed"
        ),
      try: () => dependencies.monitorPort.discover(),
    }).pipe(
      Effect.flatMap((result) => {
        if (result._tag === "Success") {
          return Effect.succeed(result.value);
        }
        const kind = result._tag === "Unsupported" ? "unsupported" : "error";
        return Effect.fail(adapterError(kind, "discover", result.reason));
      })
    );

  const listColor = (): Effect.Effect<
    readonly NativeUiColorState[],
    NativeUiApplicationError
  > =>
    discoverMonitors().pipe(
      Effect.flatMap((discovery) =>
        Effect.tryPromise({
          catch: (error) =>
            adapterError(
              "error",
              "getGammaRamp",
              error instanceof Error ? error.message : "Color state failed"
            ),
          try: () =>
            readColorStates(dependencies.monitorPort, discovery.displays),
        }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "Success") {
              colorControls = result.value.some(hasUsableColorControl)
                ? "available"
                : "unavailable";
              return Effect.succeed(result.value);
            }
            colorControls =
              result._tag === "Unsupported" ? "unavailable" : "unknown";
            return Effect.fail(
              adapterError(
                result._tag === "Unsupported" ? "unsupported" : "error",
                result.operation,
                result.reason
              )
            );
          })
        )
      )
    );

  const listWindowAreas = (): Effect.Effect<
    readonly NativeUiWindowArea[],
    NativeUiApplicationError
  > => {
    if (!windowAvailable) {
      return Effect.fail(
        adapterError(
          "unsupported",
          "getForegroundWindow",
          windowUnavailableReason
        )
      );
    }
    return discoverMonitors().pipe(Effect.map(windowAreasFromDiscovery));
  };

  const snapForegroundWindow = (
    request: NativeUiWindowSnapRequest
  ): Effect.Effect<NativeUiWindowSnapResult, NativeUiApplicationError> => {
    const port = dependencies.windowPort;
    if (port === undefined) {
      return Effect.fail(
        adapterError(
          "unsupported",
          "getForegroundWindow",
          windowUnavailableReason
        )
      );
    }
    return Effect.gen(function* snapForegroundWindowEffect() {
      const monitorId = yield* parseMonitorId(request.monitorId);
      const discovery = yield* discoverMonitors();
      const selected = findWindowArea(discovery, monitorId, request.areaId);
      if (selected === undefined) {
        return yield* Effect.fail(
          adapterError(
            "error",
            "setWindowPosition",
            "The requested monitor or snap area is not present"
          )
        );
      }
      const window = yield* runWindowOperation("getForegroundWindow", () =>
        port.getForegroundWindow()
      );
      const rect = yield* runWindowOperation("getNormalWindowRect", () =>
        port.getNormalWindowRect(window)
      );
      const latestDiscovery = yield* discoverMonitors();
      const latestSelected = findWindowArea(
        latestDiscovery,
        monitorId,
        request.areaId
      );
      if (latestSelected === undefined) {
        return yield* Effect.fail(
          adapterError(
            "error",
            "setWindowPosition",
            "The monitor topology changed before the snap could be applied"
          )
        );
      }
      const plan = planWindowSnap({
        area: latestSelected.area.rect,
        monitor: latestSelected.monitor,
        rect,
      });
      const { restoreWindow } = port;
      if (restoreWindow !== undefined) {
        yield* runWindowOperation("restoreWindow", () => restoreWindow(window));
      }
      yield* runWindowOperation("setWindowPosition", () =>
        port.setWindowPosition(window, plan.targetRect)
      );
      return {
        areaId: latestSelected.area.id,
        monitorId: String(monitorId),
      };
    });
  };

  const setColor = (
    request: NativeUiColorSetRequest
  ): Effect.Effect<NativeUiColorState, NativeUiApplicationError> => {
    const invalidValue = colorValueError(request);
    if (invalidValue !== null) {
      return Effect.fail(adapterError("error", "setGammaRamp", invalidValue));
    }
    return parseMonitorId(request.monitorId).pipe(
      Effect.flatMap((monitorId) => {
        const operation: WindowsPlatformOperation = colorOperation(
          request.control
        );
        const write = writeColor(dependencies.monitorPort, monitorId, request);
        return Effect.tryPromise({
          catch: (error) =>
            adapterError(
              "error",
              operation,
              error instanceof Error ? error.message : "Color write failed"
            ),
          try: () => write,
        }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "Success") {
              return refreshedColorState(listColor, monitorId, operation);
            }
            return Effect.fail(
              adapterError(
                result._tag === "Unsupported" ? "unsupported" : "error",
                result.operation,
                result.reason
              )
            );
          })
        );
      })
    );
  };

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
    listColor,
    listProfiles,
    listWindowAreas,
    previewProfileApply,
    saveProfile,
    setColor,
    showProfile,
    snapForegroundWindow,
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
  platform: string,
  windowPort: WindowsWindowPort = createWindowsWindowPort({
    excludedProcessIds: [process.pid, process.ppid],
    platform,
  })
): NativeUiApplicationApi =>
  makeNativeUiApplication({
    monitorPort: createWindowsDisplayPort(),
    platform,
    profileStore,
    runtime,
    windowPort,
  });
