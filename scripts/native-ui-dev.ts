import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { nativeSdkCliPackage, withWindowsLlvm } from "./native-sdk-environment";

const root = path.resolve(import.meta.dir, "..");
const backendDirectory = path.join(root, "dist");
const backendPath = path.join(
  backendDirectory,
  "native-monitor-tools-backend.exe"
);

const build = spawnSync(
  process.execPath,
  ["build", "--compile", "apps/desktop/src/index.ts", "--outfile", backendPath],
  { cwd: root, stdio: "inherit" }
);

if (build.status === 0) {
  const environment = withWindowsLlvm({
    ...process.env,
    PATH: `${backendDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
  });
  const native = spawn(
    process.execPath,
    ["x", nativeSdkCliPackage, "dev", "apps/native-ui"],
    { cwd: root, env: environment, stdio: "inherit" }
  );
  native.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  process.exitCode = build.status ?? 1;
}
