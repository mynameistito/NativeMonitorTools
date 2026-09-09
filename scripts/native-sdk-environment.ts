import { existsSync } from "node:fs";
import path from "node:path";

export const nativeSdkCliPackage = "@native-sdk/cli@0.10.1";

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
  const environmentWithWindowsShim = {
    ...environment,
    [includePathKey]: [windowsIncludeDir, environment[includePathKey]?.trim()]
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
