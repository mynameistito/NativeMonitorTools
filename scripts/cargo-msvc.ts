import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const vsDevCmdFileName = "VsDevCmd.bat";
const visualStudioYears = ["2022", "2019", "2017"] as const;
const visualStudioEditions = [
  "BuildTools",
  "Community",
  "Professional",
  "Enterprise",
] as const;
const vswhereArguments = [
  "-latest",
  "-products",
  "*",
  "-requires",
  "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
  "-property",
  "installationPath",
] as const;
const vsDevCmdCommand =
  "call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set";

const getEnvironmentValue = (
  environment: NodeJS.ProcessEnv,
  name: string
): string | undefined => {
  const key = Object.keys(environment).find(
    (environmentKey) => environmentKey.toLowerCase() === name.toLowerCase()
  );
  return key === undefined ? undefined : environment[key]?.trim();
};

const unique = (values: readonly (string | undefined)[]): readonly string[] =>
  values.filter(
    (value, index, allValues): value is string =>
      value !== undefined && allValues.indexOf(value) === index
  );

const getProgramFilesDirectories = (
  environment: NodeJS.ProcessEnv
): readonly string[] =>
  unique([
    getEnvironmentValue(environment, "ProgramFiles(x86)"),
    getEnvironmentValue(environment, "ProgramFiles"),
  ]);

/**
 * Return possible locations of Microsoft's Visual Studio instance locator.
 *
 * @param environment - Environment values used to resolve installer paths.
 * @returns Candidate `vswhere.exe` paths in lookup order.
 */
export const getVsWhereCandidates = (
  environment: NodeJS.ProcessEnv
): readonly string[] => {
  const configuredPath = getEnvironmentValue(environment, "VSWHERE_PATH");
  const pathEntry = getEnvironmentValue(environment, "PATH")
    ?.split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.join(entry, "vswhere.exe"));
  const installerPaths = getProgramFilesDirectories(environment).map(
    (programFilesDirectory) =>
      path.join(
        programFilesDirectory,
        "Microsoft Visual Studio",
        "Installer",
        "vswhere.exe"
      )
  );

  return unique([configuredPath, ...(pathEntry ?? []), ...installerPaths]);
};

/**
 * Return standard Visual Studio `VsDevCmd.bat` locations.
 *
 * @param environment - Environment values used to resolve installer paths.
 * @returns Candidate `VsDevCmd.bat` paths in lookup order.
 */
export const getVsDevCmdCandidates = (
  environment: NodeJS.ProcessEnv
): readonly string[] => {
  const configuredInstall = getEnvironmentValue(environment, "VSINSTALLDIR");
  const standardInstalls = getProgramFilesDirectories(environment).flatMap(
    (programFilesDirectory) =>
      visualStudioYears.flatMap((year) =>
        visualStudioEditions.map((edition) =>
          path.join(
            programFilesDirectory,
            "Microsoft Visual Studio",
            year,
            edition,
            "Common7",
            "Tools",
            vsDevCmdFileName
          )
        )
      )
  );

  return unique([
    configuredInstall === undefined
      ? undefined
      : path.join(configuredInstall, "Common7", "Tools", vsDevCmdFileName),
    ...standardInstalls,
  ]);
};

/**
 * Parse the `set` output produced by a Visual Studio developer command shell.
 *
 * @param output - Newline-delimited environment assignments.
 * @param baseEnvironment - Environment to extend with the parsed assignments.
 * @returns A child-process environment with case-insensitive variable updates.
 */
export const parseCommandEnvironment = (
  output: string,
  baseEnvironment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const environment = { ...baseEnvironment };

  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0 || line.startsWith("=")) {
      continue;
    }

    const name = line.slice(0, separator);
    const existingName = Object.keys(environment).find(
      (environmentName) => environmentName.toLowerCase() === name.toLowerCase()
    );
    environment[existingName ?? name] = line.slice(separator + 1);
  }

  return environment;
};

/**
 * Find an executable in a supplied environment without changing the caller's PATH.
 *
 * @param executable - Executable filename to locate.
 * @param environment - Environment containing the PATH to inspect.
 * @returns The first matching executable path, or `undefined` when absent.
 */
export const findExecutableOnPath = (
  executable: string,
  environment: NodeJS.ProcessEnv
): string | undefined => {
  const pathValue = getEnvironmentValue(environment, "PATH");
  if (pathValue === undefined) {
    return undefined;
  }

  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.join(entry, executable))
    .find((candidate) => existsSync(candidate));
};

const findExistingPath = (candidates: readonly string[]): string | undefined =>
  candidates.find((candidate) => existsSync(candidate));

const findVsWherePath = (environment: NodeJS.ProcessEnv): string | undefined =>
  findExistingPath(getVsWhereCandidates(environment));

const readVisualStudioInstallationPath = (
  vswherePath: string,
  environment: NodeJS.ProcessEnv
): string | undefined => {
  const result = spawnSync(vswherePath, vswhereArguments, {
    encoding: "utf-8",
    env: environment,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error !== undefined || result.status !== 0) {
    return undefined;
  }

  return result.stdout
    ?.toString()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
};

const findVsDevCmdPath = (
  environment: NodeJS.ProcessEnv
): string | undefined => {
  const vswherePath = findVsWherePath(environment);
  const discoveredInstall =
    vswherePath === undefined
      ? undefined
      : readVisualStudioInstallationPath(vswherePath, environment);
  const discoveredDevCmd =
    discoveredInstall === undefined
      ? undefined
      : path.join(discoveredInstall, "Common7", "Tools", vsDevCmdFileName);

  return findExistingPath(
    [discoveredDevCmd, ...getVsDevCmdCandidates(environment)].filter(
      (candidate): candidate is string => candidate !== undefined
    )
  );
};

type EnvironmentResolution =
  | { readonly _tag: "success"; readonly environment: NodeJS.ProcessEnv }
  | { readonly _tag: "failure"; readonly message: string };

const initializeMsvcEnvironment = (
  environment: NodeJS.ProcessEnv
): EnvironmentResolution => {
  const devCmdPath = findVsDevCmdPath(environment);
  if (devCmdPath === undefined) {
    return {
      _tag: "failure",
      message:
        "Visual Studio Build Tools with the MSVC component were not found.",
    };
  }

  const commandShell = getEnvironmentValue(environment, "ComSpec") ?? "cmd.exe";
  const result = spawnSync(
    commandShell,
    ["/d", "/s", "/v:off", "/c", vsDevCmdCommand],
    {
      cwd: path.dirname(devCmdPath),
      encoding: "utf-8",
      env: environment,
      stdio: ["ignore", "pipe", "inherit"],
    }
  );
  if (result.error !== undefined) {
    return {
      _tag: "failure",
      message: `Unable to initialize the MSVC environment: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      _tag: "failure",
      message: `VsDevCmd.bat exited with code ${result.status ?? 1}.`,
    };
  }

  const initializedEnvironment = parseCommandEnvironment(
    result.stdout?.toString() ?? "",
    environment
  );
  const missingTools = ["cl.exe", "link.exe"].filter(
    (executable) =>
      findExecutableOnPath(executable, initializedEnvironment) === undefined
  );
  if (missingTools.length > 0) {
    return {
      _tag: "failure",
      message: `MSVC environment is missing ${missingTools.join(" and ")}.`,
    };
  }

  return { _tag: "success", environment: initializedEnvironment };
};

const runCargo = (
  cargoArguments: readonly string[],
  environment: NodeJS.ProcessEnv
): number => {
  const result = spawnSync(
    process.platform === "win32" ? "cargo.exe" : "cargo",
    cargoArguments,
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: environment,
      stdio: "inherit",
    }
  );
  if (result.error !== undefined) {
    process.stderr.write(
      `cargo-msvc: unable to run Cargo: ${result.error.message}\n`
    );
    return 1;
  }
  return result.status ?? 1;
};

const run = (): number => {
  const cargoArguments = process.argv.slice(2);
  if (cargoArguments.length === 0) {
    process.stderr.write(
      "Usage: bun run scripts/cargo-msvc.ts <cargo arguments>\n"
    );
    return 2;
  }

  const environment =
    process.platform === "win32"
      ? initializeMsvcEnvironment(process.env)
      : { _tag: "success" as const, environment: process.env };
  if (environment._tag === "failure") {
    process.stderr.write(`cargo-msvc: ${environment.message}\n`);
    return 1;
  }

  return runCargo(cargoArguments, environment.environment);
};

if (import.meta.main) {
  process.exitCode = run();
}
