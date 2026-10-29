import path from "node:path";

/** Environment values needed to locate desktop application data. */
export type DesktopEnvironment = Readonly<Record<string, string | undefined>>;

/** Host platforms relevant to app-data location selection. */
export type DesktopPlatform = "darwin" | "linux" | "win32" | "other";

/** Resolved directories used by the desktop application. */
export interface DesktopPaths {
  readonly dataDirectory: string;
  readonly profileDirectory: string;
}

const nonEmpty = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
};

const defaultBaseDirectory = (
  environment: DesktopEnvironment,
  platform: DesktopPlatform,
  homeDirectory: string
): string => {
  if (platform === "win32") {
    return (
      nonEmpty(environment.LOCALAPPDATA) ??
      nonEmpty(environment.APPDATA) ??
      path.join(homeDirectory, "AppData", "Local")
    );
  }
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support");
  }
  return (
    nonEmpty(environment.XDG_CONFIG_HOME) ?? path.join(homeDirectory, ".config")
  );
};

/** Normalize the host platform at the process boundary. */
export const parseDesktopPlatform = (input: string): DesktopPlatform => {
  if (input === "win32" || input === "darwin" || input === "linux") {
    return input;
  }
  return "other";
};

/**
 * Resolve application data paths without reading process globals.
 *
 * `NATIVE_MONITOR_TOOLS_DATA_DIR` is a complete data-directory override and is
 * intended for tests and portable deployments.
 *
 * @param environment - Environment values supplied by the composition root.
 * @param platform - Host platform supplied by the composition root.
 * @param homeDirectory - The resolved user home directory.
 * @returns The data directory and its profile subdirectory.
 */
export const resolveDesktopPaths = (
  environment: DesktopEnvironment,
  platform: DesktopPlatform,
  homeDirectory: string
): DesktopPaths => {
  const override =
    nonEmpty(environment.NATIVE_MONITOR_TOOLS_DATA_DIR) ??
    nonEmpty(environment.NATIVE_MONITOR_TOOLS_CONFIG_DIR);
  const baseDirectory =
    override ?? defaultBaseDirectory(environment, platform, homeDirectory);
  const dataDirectory =
    override === undefined
      ? path.join(baseDirectory, "NativeMonitorTools")
      : baseDirectory;
  return {
    dataDirectory,
    profileDirectory: path.join(dataDirectory, "profiles"),
  };
};
