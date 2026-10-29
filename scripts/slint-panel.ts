import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const panelManifestPath = "apps/slint-ui/Cargo.toml";
const panelTargetDirectory = "dist/slint-panel";
const backendSourcePath = "apps/slint-ui/backend-stdio.ts";
const backendFileStem = "native-monitor-tools-backend";
const panelFileStem = "native-monitor-tools-slint-ui";
const releaseNoticeFileNames = ["COPYING.txt", "NOTICE.md"] as const;
const releaseBackendStagingDirectory = ".staging/release";
type PanelProfile = "debug" | "release";
type PanelCommand = "backend" | "build" | "dev" | "release";
type CargoCommand = "build" | "run";

const isPanelCommand = (value: string | undefined): value is PanelCommand =>
  value === "backend" ||
  value === "build" ||
  value === "dev" ||
  value === "release";

const executableSuffix = (platform: NodeJS.Platform): string =>
  platform === "win32" ? ".exe" : "";

/**
 * Resolve the JSON-lines backend executable staged beside a panel.
 *
 * @param root - Repository root containing the Slint crate.
 * @param platform - Node platform identifier used for the executable suffix.
 * @param profile - Cargo profile whose output directory contains the backend.
 * @returns The ignored dist path used by the Slint panel launcher.
 */
export const resolveSlintPanelBackendPath = (
  root: string,
  platform: NodeJS.Platform = process.platform,
  profile: PanelProfile = "debug"
): string =>
  path.join(
    root,
    panelTargetDirectory,
    profile,
    `${backendFileStem}${executableSuffix(platform)}`
  );

/**
 * Resolve the compiled Slint panel executable in a Cargo profile directory.
 *
 * @param root - Repository root containing the Slint crate.
 * @param platform - Node platform identifier used for the executable suffix.
 * @param profile - Cargo profile whose output directory contains the panel.
 * @returns The ignored dist path used by the packaged Slint panel.
 */
export const resolveSlintPanelBinaryPath = (
  root: string,
  platform: NodeJS.Platform = process.platform,
  profile: PanelProfile = "release"
): string =>
  path.join(
    root,
    panelTargetDirectory,
    profile,
    `${panelFileStem}${executableSuffix(platform)}`
  );

/**
 * Resolve the Cargo arguments shared by the Slint panel build, dev, and release paths.
 *
 * @param command - Cargo command to run.
 * @param profile - Cargo profile to build.
 * @returns Arguments for the existing MSVC-aware Cargo wrapper.
 */
export const resolveSlintPanelCargoArguments = (
  command: CargoCommand,
  profile: PanelProfile = "debug"
): readonly string[] => [
  command,
  ...(profile === "release" ? ["--release"] : []),
  "--manifest-path",
  panelManifestPath,
  "--target-dir",
  panelTargetDirectory,
];

/**
 * Resolve the repository notices that may be copied into a release directory.
 *
 * @param root - Repository root containing the release notices.
 * @returns Candidate notice paths, in release packaging order.
 */
export const resolveSlintPanelReleaseNoticePaths = (
  root: string
): readonly string[] =>
  releaseNoticeFileNames.map((fileName) => path.join(root, fileName));

const runCommand = (command: string, args: readonly string[]): number => {
  const result = spawnSync(command, args, {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    process.stderr.write(
      `slint-panel: unable to run ${command}: ${result.error.message}\n`
    );
    return 1;
  }
  return result.status ?? 1;
};

const compileBackend = (outputPath: string): number => {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  rmSync(outputPath, { force: true });
  const status = runCommand(process.execPath, [
    "build",
    "--compile",
    backendSourcePath,
    "--outfile",
    outputPath,
  ]);
  if (status !== 0) {
    return status;
  }
  if (!existsSync(outputPath)) {
    process.stderr.write(
      `slint-panel: Bun completed without producing the backend at ${outputPath}\n`
    );
    return 1;
  }
  return 0;
};

const stageBackend = (root: string): number =>
  compileBackend(resolveSlintPanelBackendPath(root));

const resolveReleaseBackendBuildPath = (
  root: string,
  platform: NodeJS.Platform = process.platform
): string =>
  path.join(
    root,
    panelTargetDirectory,
    releaseBackendStagingDirectory,
    `${backendFileStem}${executableSuffix(platform)}`
  );

const copyReleaseArtifacts = (root: string): number => {
  const panelPath = resolveSlintPanelBinaryPath(root);
  const backendPath = resolveSlintPanelBackendPath(
    root,
    process.platform,
    "release"
  );
  const backendBuildPath = resolveReleaseBackendBuildPath(root);
  if (!existsSync(panelPath)) {
    process.stderr.write(
      `slint-panel: Cargo completed without producing the panel at ${panelPath}\n`
    );
    return 1;
  }
  if (!existsSync(backendBuildPath)) {
    process.stderr.write(
      `slint-panel: release backend was not produced at ${backendBuildPath}\n`
    );
    return 1;
  }

  try {
    copyFileSync(backendBuildPath, backendPath);
    for (const noticePath of resolveSlintPanelReleaseNoticePaths(root)) {
      if (existsSync(noticePath)) {
        copyFileSync(
          noticePath,
          path.join(path.dirname(panelPath), path.basename(noticePath))
        );
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown copy failure";
    process.stderr.write(
      `slint-panel: unable to stage release artifacts: ${message}\n`
    );
    return 1;
  }

  return 0;
};

const buildRelease = (root: string): number => {
  const backendBuildPath = resolveReleaseBackendBuildPath(root);
  const backendStatus = compileBackend(backendBuildPath);
  if (backendStatus !== 0) {
    return backendStatus;
  }

  const cargoStatus = runCommand(process.execPath, [
    "run",
    "scripts/cargo-msvc.ts",
    ...resolveSlintPanelCargoArguments("build", "release"),
  ]);
  if (cargoStatus !== 0) {
    return cargoStatus;
  }

  return copyReleaseArtifacts(root);
};

const run = (): number => {
  const [requestedCommand] = process.argv.slice(2);
  if (!isPanelCommand(requestedCommand)) {
    process.stderr.write(
      "Usage: bun run scripts/slint-panel.ts <backend|build|dev|release>\n"
    );
    return 2;
  }

  const root = path.resolve(import.meta.dirname, "..");
  if (requestedCommand === "release") {
    return buildRelease(root);
  }

  const backendStatus = stageBackend(root);
  if (backendStatus !== 0) {
    return backendStatus;
  }
  if (requestedCommand === "backend") {
    return 0;
  }

  const cargoCommand = requestedCommand === "dev" ? "run" : requestedCommand;
  return runCommand(process.execPath, [
    "run",
    "scripts/cargo-msvc.ts",
    ...resolveSlintPanelCargoArguments(cargoCommand),
  ]);
};

if (import.meta.main) {
  process.exitCode = run();
}
