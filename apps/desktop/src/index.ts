import { Effect } from "effect";

import { UnsupportedCapability } from "./application/capabilities";
import { makeDesktopApplicationLayer } from "./application/composition";
import { DesktopApplication } from "./application/service";
import { parseCliArgs } from "./cli/parser";
import { renderCliError, renderCliResult } from "./cli/renderer";
import {
  parseDesktopPlatform,
  resolveDesktopPaths,
} from "./storage/configuration";

const command = Effect.gen(function* commandEffect() {
  const parsed = yield* parseCliArgs(process.argv.slice(2));
  const application = yield* DesktopApplication;
  const result = yield* application.execute(parsed);
  return renderCliResult(result, parsed.format);
});

const run = async (): Promise<void> => {
  const paths = resolveDesktopPaths(
    process.env,
    parseDesktopPlatform(process.platform),
    process.env.USERPROFILE ?? process.env.HOME ?? "."
  );
  try {
    const output = await Effect.runPromise(
      Effect.provide(command, makeDesktopApplicationLayer(paths))
    );
    process.stdout.write(`${output}\n`);
    process.exitCode = 0;
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error("Desktop command failed.");
    process.stderr.write(`${renderCliError(failure)}\n`);
    process.exitCode = error instanceof UnsupportedCapability ? 2 : 1;
  }
};

if (import.meta.main) {
  void run();
}

export { createWindowsDisplayPort } from "./platform/windows";
export type {
  BrightnessContrastCapabilities,
  ExternalLevelCapability,
  GammaRamp,
  WindowsDisplay,
  WindowsDisplayDiscovery,
  WindowsDisplayIdentity,
  WindowsDisplayPort,
  WindowsPlatformOperation,
  WindowsPlatformResult,
} from "./platform/windows";
