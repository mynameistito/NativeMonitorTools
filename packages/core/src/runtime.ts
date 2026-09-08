import { Context, Layer } from "effect";
import type { Effect } from "effect";

import { generateApplyPlan } from "./apply-plan";
import type { ApplyPlan, ApplyPlanOptions } from "./apply-plan";
import type { DisplayProfile } from "./display-profile";
import type { InvalidApplyPlan } from "./errors";
import type { MonitorSnapshot, MonitorTopology } from "./monitor";
import { resolveMonitorSelector } from "./selector";
import type {
  MonitorSelector,
  MonitorSelectorError,
  ResolveMonitorSelectorOptions,
} from "./selector";
import { diffTopologies } from "./topology-diff";
import type { TopologyDiff } from "./topology-diff";

/** Platform-independent operations exposed through an Effect service. */
export interface MonitorRuntimeApi {
  readonly resolveSelector: (
    topology: MonitorTopology,
    selector: MonitorSelector | string,
    options?: ResolveMonitorSelectorOptions
  ) => Effect.Effect<MonitorSnapshot, MonitorSelectorError>;
  readonly diff: (
    before: MonitorTopology,
    after: MonitorTopology
  ) => TopologyDiff;
  readonly plan: (
    current: MonitorTopology,
    desired: DisplayProfile,
    options?: ApplyPlanOptions
  ) => Effect.Effect<ApplyPlan, InvalidApplyPlan>;
}

/** Effect service key for the shared monitor runtime operations. */
export const MonitorRuntime = Context.Service<MonitorRuntimeApi>(
  "@native-monitor-tools/core/MonitorRuntime"
);

/** Live layer backed by the pure core algorithms. Platform adapters can depend on this layer. */
export const MonitorRuntimeLive = Layer.succeed(MonitorRuntime, {
  diff: diffTopologies,
  plan: generateApplyPlan,
  resolveSelector: resolveMonitorSelector,
});
