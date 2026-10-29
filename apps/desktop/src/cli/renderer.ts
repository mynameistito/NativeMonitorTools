import {
  displayModeLabel,
  monitorIdToString,
} from "@native-monitor-tools/core";
import type {
  ApplyPlan,
  DisplayProfile,
  MonitorSnapshot,
  TopologyDiff,
} from "@native-monitor-tools/core";

import type { OutputFormat } from "./parser";

/** The successful values returned by the desktop application service. */
export type CliResult =
  | { readonly _tag: "HelpResult" }
  | {
      readonly _tag: "MonitorListResult";
      readonly monitors: readonly MonitorSnapshot[];
    }
  | {
      readonly _tag: "ProfileSavedResult";
      readonly name: string;
      readonly profile: DisplayProfile;
      readonly dryRun: boolean;
    }
  | { readonly _tag: "ProfileListResult"; readonly profiles: readonly string[] }
  | {
      readonly _tag: "ProfileShownResult";
      readonly name: string;
      readonly profile: DisplayProfile;
    }
  | {
      readonly _tag: "ProfileDiffResult";
      readonly name: string;
      readonly diff: TopologyDiff;
    }
  | {
      readonly _tag: "ProfileAppliedResult";
      readonly name: string;
      readonly plan: ApplyPlan;
      readonly dryRun: boolean;
    };

type JsonCliValue =
  | { readonly command: "help"; readonly usage: string }
  | {
      readonly command: "monitor list";
      readonly monitors: readonly MonitorSnapshot[];
    }
  | {
      readonly command: "profile save";
      readonly dryRun: boolean;
      readonly name: string;
      readonly profile: DisplayProfile;
    }
  | { readonly command: "profile list"; readonly profiles: readonly string[] }
  | {
      readonly command: "profile show";
      readonly name: string;
      readonly profile: DisplayProfile;
    }
  | {
      readonly command: "profile diff";
      readonly diff: TopologyDiff;
      readonly name: string;
    }
  | {
      readonly command: "profile apply";
      readonly dryRun: boolean;
      readonly name: string;
      readonly plan: ApplyPlan;
    };

const impossible = (value: never): never => {
  throw new Error(`Unexpected CLI value: ${String(value)}`);
};

const helpText = (): string =>
  [
    "Usage:",
    "  monitor list [--json]",
    "  profile save <name> [--json] [--dry-run]",
    "  profile list [--json]",
    "  profile show <name> [--json]",
    "  profile diff <name> [--json] [--dry-run]",
    "  profile apply <name> [--json] [--dry-run]",
    "  cursor|window|wallpaper ...",
  ].join("\n");

const jsonValue = (result: CliResult): JsonCliValue => {
  switch (result._tag) {
    case "HelpResult": {
      return { command: "help", usage: helpText() };
    }
    case "MonitorListResult": {
      return { command: "monitor list", monitors: result.monitors };
    }
    case "ProfileSavedResult": {
      return {
        command: "profile save",
        dryRun: result.dryRun,
        name: result.name,
        profile: result.profile,
      };
    }
    case "ProfileListResult": {
      return { command: "profile list", profiles: result.profiles };
    }
    case "ProfileShownResult": {
      return {
        command: "profile show",
        name: result.name,
        profile: result.profile,
      };
    }
    case "ProfileDiffResult": {
      return { command: "profile diff", diff: result.diff, name: result.name };
    }
    case "ProfileAppliedResult": {
      return {
        command: "profile apply",
        dryRun: result.dryRun,
        name: result.name,
        plan: result.plan,
      };
    }
    default: {
      return impossible(result);
    }
  }
};

const monitorLine = (monitor: MonitorSnapshot, index: number): string => {
  const primary = monitor.isPrimary ? ", primary" : "";
  return `${index + 1}. ${monitor.name} [${monitorIdToString(monitor.id)}] ${monitor.bounds.x},${monitor.bounds.y} ${displayModeLabel(monitor.mode)}${primary}`;
};

const renderPlan = (plan: ApplyPlan): string => {
  if (plan.isNoop) {
    return "No display changes are required.";
  }
  return [
    `${plan.operations.length} display operation${plan.operations.length === 1 ? "" : "s"}:`,
    ...plan.operations.map((operation) => {
      switch (operation._tag) {
        case "MoveMonitor": {
          return `- Move ${monitorIdToString(operation.monitorId)} from (${operation.from.x},${operation.from.y}) to (${operation.to.x},${operation.to.y})`;
        }
        case "SetDisplayMode": {
          return `- Set ${monitorIdToString(operation.monitorId)} mode from ${displayModeLabel(operation.from)} to ${displayModeLabel(operation.to)}`;
        }
        case "SetPrimary": {
          return `- Set ${monitorIdToString(operation.monitorId)} as primary`;
        }
        default: {
          return impossible(operation);
        }
      }
    }),
  ].join("\n");
};

const renderDiff = (diff: TopologyDiff): string => {
  const lines = [
    `Added: ${diff.added.length}`,
    `Removed: ${diff.removed.length}`,
    `Changed: ${diff.changed.length}`,
  ];
  for (const monitor of diff.changed) {
    lines.push(
      `- ${monitorIdToString(monitor.id)}: ${monitor.kinds.join(", ")}`
    );
  }
  return lines.join("\n");
};

/**
 * Render an application result for a terminal or a machine-readable caller.
 *
 * @param result - The successful result to project.
 * @param format - The requested output encoding.
 * @returns A string without a trailing newline.
 */
export const renderCliResult = (
  result: CliResult,
  format: OutputFormat
): string => {
  if (format === "json") {
    return JSON.stringify(jsonValue(result));
  }

  switch (result._tag) {
    case "HelpResult": {
      return helpText();
    }
    case "MonitorListResult": {
      return result.monitors.map(monitorLine).join("\n");
    }
    case "ProfileSavedResult": {
      return result.dryRun
        ? `Dry run: profile ${result.name} was not saved.`
        : `Saved profile ${result.name}.`;
    }
    case "ProfileListResult": {
      return result.profiles.length === 0
        ? "No profiles saved."
        : result.profiles.join("\n");
    }
    case "ProfileShownResult": {
      return JSON.stringify(result.profile, null, 2);
    }
    case "ProfileDiffResult": {
      return renderDiff(result.diff);
    }
    case "ProfileAppliedResult": {
      return result.dryRun
        ? `Dry run for profile ${result.name}:\n${renderPlan(result.plan)}`
        : renderPlan(result.plan);
    }
    default: {
      return impossible(result);
    }
  }
};

/** Render a typed application failure for the CLI boundary. */
export const renderCliError = (error: Error): string => error.message;
