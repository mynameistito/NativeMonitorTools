import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const nativeSdkCliPackage = "@native-sdk/cli@0.10.1";

const getEnvironmentValue = (
  environment: NodeJS.ProcessEnv,
  name: string
): string | undefined => {
  const key = Object.keys(environment).find(
    (environmentKey) => environmentKey.toLowerCase() === name.toLowerCase()
  );
  return key === undefined ? undefined : environment[key]?.trim();
};

const getDirectories = (directory: string): readonly string[] => {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

const compareVersions = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true });

const getNewestVersionDirectory = (directory: string): string | undefined => {
  const versions = getDirectories(directory).filter((entry) =>
    /^\d+(?:\.\d+)+$/u.test(entry)
  );
  return versions.toSorted(compareVersions).at(-1);
};

const getProgramFilesDirectories = (
  environment: NodeJS.ProcessEnv
): readonly string[] =>
  [
    getEnvironmentValue(environment, "ProgramFiles(x86)"),
    getEnvironmentValue(environment, "ProgramFiles"),
  ].filter((directory): directory is string => directory !== undefined);

const findMsvcIncludeDirectory = (
  environment: NodeJS.ProcessEnv
): string | undefined => {
  const configuredToolsDirectory = getEnvironmentValue(
    environment,
    "VCToolsInstallDir"
  );
  const configuredIncludeDirectory = configuredToolsDirectory
    ? path.join(configuredToolsDirectory, "include")
    : undefined;
  if (
    configuredIncludeDirectory !== undefined &&
    existsSync(configuredIncludeDirectory)
  ) {
    return configuredIncludeDirectory;
  }

  const candidates = getProgramFilesDirectories(environment).flatMap(
    (programFilesDirectory) => {
      const visualStudioDirectory = path.join(
        programFilesDirectory,
        "Microsoft Visual Studio"
      );
      return getDirectories(visualStudioDirectory).flatMap((year) =>
        getDirectories(path.join(visualStudioDirectory, year)).flatMap(
          (edition) => {
            const msvcDirectory = path.join(
              visualStudioDirectory,
              year,
              edition,
              "VC",
              "Tools",
              "MSVC"
            );
            const version = getNewestVersionDirectory(msvcDirectory);
            if (version === undefined) {
              return [];
            }
            return [
              {
                directory: path.join(msvcDirectory, version, "include"),
                version,
              },
            ];
          }
        )
      );
    }
  );

  return candidates
    .filter((candidate) => existsSync(candidate.directory))
    .toSorted((left, right) => compareVersions(left.version, right.version))
    .at(-1)?.directory;
};

const findWindowsSdkIncludeDirectory = (
  environment: NodeJS.ProcessEnv
): string | undefined => {
  const configuredSdkDirectory = getEnvironmentValue(
    environment,
    "WindowsSdkDir"
  );
  const sdkDirectories = [
    configuredSdkDirectory,
    ...getProgramFilesDirectories(environment).map((programFilesDirectory) =>
      path.join(programFilesDirectory, "Windows Kits", "10")
    ),
  ].filter(
    (directory, index, directories): directory is string =>
      directory !== undefined && directories.indexOf(directory) === index
  );
  const configuredVersion = getEnvironmentValue(
    environment,
    "WindowsSDKVersion"
  );

  const candidates = sdkDirectories.flatMap((sdkDirectory) => {
    const includeDirectory = path.join(sdkDirectory, "Include");
    const version =
      configuredVersion ?? getNewestVersionDirectory(includeDirectory);
    if (version === undefined) {
      return [];
    }
    const versionDirectory = path.join(includeDirectory, version);
    if (!existsSync(versionDirectory)) {
      return [];
    }
    return [{ directory: versionDirectory, version }];
  });

  return candidates
    .toSorted((left, right) => compareVersions(left.version, right.version))
    .at(-1)?.directory;
};

const getWindowsCompilerIncludeDirectories = (
  environment: NodeJS.ProcessEnv
): readonly string[] => {
  const msvcIncludeDirectory = findMsvcIncludeDirectory(environment);
  const windowsSdkIncludeDirectory =
    findWindowsSdkIncludeDirectory(environment);
  const windowsSdkDirectories = windowsSdkIncludeDirectory
    ? ["ucrt", "shared", "um"].map((directory) =>
        path.join(windowsSdkIncludeDirectory, directory)
      )
    : [];

  return [msvcIncludeDirectory, ...windowsSdkDirectories].filter(
    (directory): directory is string =>
      directory !== undefined && existsSync(directory)
  );
};

export const withWindowsLlvm = (
  environment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  if (process.platform !== "win32") {
    return environment;
  }

  const windowsIncludeDir = path.resolve(
    import.meta.dir,
    "native-sdk-windows",
    "include"
  );
  const includePathKey =
    Object.keys(environment).find(
      (key) => key.toLowerCase() === "c_include_path"
    ) ?? "C_INCLUDE_PATH";
  const compilerIncludeDirectories =
    getWindowsCompilerIncludeDirectories(environment);
  const environmentWithWindowsShim = {
    ...environment,
    [includePathKey]: [
      windowsIncludeDir,
      ...compilerIncludeDirectories,
      getEnvironmentValue(environment, includePathKey),
    ]
      .filter((entry): entry is string => entry !== undefined && entry !== "")
      .join(path.delimiter),
  };

  if (Bun.which("clang.exe")) {
    return environmentWithWindowsShim;
  }

  const llvmBin =
    environmentWithWindowsShim.NATIVE_SDK_LLVM_BIN?.trim() ||
    path.join(environment.ProgramFiles ?? "C:\\Program Files", "LLVM", "bin");
  if (!existsSync(path.join(llvmBin, "clang.exe"))) {
    return environmentWithWindowsShim;
  }

  const pathKey =
    Object.keys(environmentWithWindowsShim).find(
      (key) => key.toLowerCase() === "path"
    ) ?? "PATH";
  return {
    ...environmentWithWindowsShim,
    [pathKey]: `${llvmBin}${path.delimiter}${environmentWithWindowsShim[pathKey] ?? ""}`,
  };
};
