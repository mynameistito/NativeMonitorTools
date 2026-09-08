/* oxlint-disable anti-slop/no-runtime-typeof -- This boundary intentionally accepts either parsed selectors or text. */

import { Effect } from "effect";

import {
  AmbiguousMonitorSelector,
  CurrentMonitorUnavailable,
  InvalidMonitorSelector,
  MonitorNotFound,
} from "./errors";
import { findMonitor, orderMonitors } from "./monitor";
import type { MonitorSnapshot, MonitorTopology } from "./monitor";
import type { MonitorId } from "./monitor-id";

/** A parsed monitor selector accepted by the runtime. */
export type MonitorSelector =
  | { readonly _tag: "Index"; readonly index: number }
  | { readonly _tag: "Name"; readonly name: string }
  | { readonly _tag: "Current" };

/** All expected failures produced while resolving a monitor selector. */
export type MonitorSelectorError =
  | InvalidMonitorSelector
  | MonitorNotFound
  | AmbiguousMonitorSelector
  | CurrentMonitorUnavailable;

/** Context needed to resolve the current-monitor selector. */
export interface ResolveMonitorSelectorOptions {
  readonly currentId?: MonitorId;
}

/**
 * Parse a selector string.
 *
 * Numeric selectors are one-based positions in deterministic desktop order;
 * names are case-insensitive exact matches; `x` and `current` mean current.
 *
 * @param input - A numeric, name, `x`, or `current` selector.
 * @returns An Effect that succeeds with a parsed selector or fails with InvalidMonitorSelector.
 */
export const parseMonitorSelector = (
  input: string
): Effect.Effect<MonitorSelector, InvalidMonitorSelector> => {
  const normalized = input.trim();
  if (normalized.length === 0) {
    return Effect.fail(
      new InvalidMonitorSelector({
        input,
        reason: "Monitor selector cannot be empty",
      })
    );
  }

  if (
    normalized.toLocaleLowerCase() === "x" ||
    normalized.toLocaleLowerCase() === "current"
  ) {
    return Effect.succeed({ _tag: "Current" });
  }

  if (/^\d+$/u.test(normalized)) {
    const index = Number(normalized);
    if (!Number.isSafeInteger(index) || index < 1) {
      return Effect.fail(
        new InvalidMonitorSelector({
          input,
          reason: "Numeric selector must be a positive safe integer",
        })
      );
    }
    return Effect.succeed({ _tag: "Index", index });
  }

  if (/^-\d+$/u.test(normalized)) {
    return Effect.fail(
      new InvalidMonitorSelector({
        input,
        reason: "Numeric selector must be one-based",
      })
    );
  }

  return Effect.succeed({ _tag: "Name", name: normalized });
};

const selectorLabel = (selector: MonitorSelector): string => {
  switch (selector._tag) {
    case "Index": {
      return String(selector.index);
    }
    case "Name": {
      return selector.name;
    }
    case "Current": {
      return "current";
    }
    default: {
      return "unknown";
    }
  }
};

const namesEqual = (left: string, right: string): boolean =>
  left.toLocaleLowerCase() === right.toLocaleLowerCase();

/**
 * Resolve a parsed or textual selector against a topology.
 *
 * @param topology - The validated current topology.
 * @param selector - A parsed selector or selector string.
 * @param options - The current monitor identity when resolving `x`/`current`.
 * @returns An Effect that succeeds with one monitor or fails with a typed resolution error.
 */
export const resolveMonitorSelector = (
  topology: MonitorTopology,
  selector: MonitorSelector | string,
  options: ResolveMonitorSelectorOptions = {}
): Effect.Effect<MonitorSnapshot, MonitorSelectorError> =>
  Effect.gen(function* resolveMonitorSelectorEffect() {
    const parsed =
      typeof selector === "string"
        ? yield* parseMonitorSelector(selector)
        : selector;

    switch (parsed._tag) {
      case "Current": {
        if (options.currentId === undefined) {
          return yield* Effect.fail(new CurrentMonitorUnavailable());
        }
        const current = findMonitor(topology, options.currentId);
        if (current === undefined) {
          return yield* Effect.fail(
            new MonitorNotFound({ selector: "current" })
          );
        }
        return current;
      }
      case "Index": {
        const monitor = orderMonitors(topology.monitors)[parsed.index - 1];
        if (monitor === undefined) {
          return yield* Effect.fail(
            new MonitorNotFound({ selector: selectorLabel(parsed) })
          );
        }
        return monitor;
      }
      case "Name": {
        const matches = topology.monitors.filter((monitor) =>
          namesEqual(monitor.name, parsed.name)
        );
        if (matches.length === 0) {
          return yield* Effect.fail(
            new MonitorNotFound({ selector: selectorLabel(parsed) })
          );
        }
        if (matches.length > 1) {
          return yield* Effect.fail(
            new AmbiguousMonitorSelector({
              matches: matches.map((monitor) => monitor.id),
              selector: selectorLabel(parsed),
            })
          );
        }
        const match = matches.at(0);
        if (match === undefined) {
          return yield* Effect.fail(
            new MonitorNotFound({ selector: selectorLabel(parsed) })
          );
        }
        return match;
      }
      default: {
        return yield* Effect.die("Unknown monitor selector tag");
      }
    }
  });
