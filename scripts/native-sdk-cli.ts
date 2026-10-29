import { spawn } from "node:child_process";
import path from "node:path";

import { nativeSdkCliPackage, withWindowsLlvm } from "./native-sdk-environment";

const root = path.resolve(import.meta.dir, "..");

const nativeCli = spawn(
  process.execPath,
  ["x", nativeSdkCliPackage, ...process.argv.slice(2)],
  {
    cwd: root,
    env: withWindowsLlvm(process.env),
    stdio: "inherit",
  }
);

nativeCli.on("close", (code) => {
  process.exitCode = code ?? 1;
});

nativeCli.on("error", () => {
  process.exitCode = 1;
});
