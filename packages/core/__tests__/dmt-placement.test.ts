import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeDisplayMode } from "../src/display-mode";
import {
  clampRectToUsableArea,
  maximizedWindowState,
  minimizedWindowState,
  planWindowPlacement,
  planWindowSnap,
  translateRectBetweenWorkAreas,
} from "../src/dmt/window-placement";
import { makeMonitorSnapshot } from "../src/monitor";
import type { MonitorSnapshot } from "../src/monitor";
import { parseMonitorId } from "../src/monitor-id";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const monitor = (
  value: string,
  x: number,
  y: number,
  boundsWidth: number,
  boundsHeight: number,
  workArea: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  isPrimary: boolean
): MonitorSnapshot =>
  run(
    makeMonitorSnapshot({
      bounds: { height: boundsHeight, width: boundsWidth, x, y },
      id: run(parseMonitorId(value)),
      isPrimary,
      mode: run(
        makeDisplayMode({
          height: boundsHeight,
          refreshRate: 60,
          width: boundsWidth,
        })
      ),
      name: value,
      workArea,
    })
  );

describe("DMT window placement", () => {
  const source = monitor(
    "source",
    -1920,
    -100,
    1920,
    1080,
    { height: 1000, width: 1900, x: -1910, y: -80 },
    true
  );
  const target = monitor(
    "target",
    0,
    0,
    2560,
    1440,
    { height: 1360, width: 2500, x: 20, y: 40 },
    false
  );

  it("translates relative to work-area origins and preserves size", () => {
    const translated = translateRectBetweenWorkAreas(
      { height: 300, width: 500, x: -1810, y: 20 },
      source.workArea ?? source.bounds,
      target.workArea ?? target.bounds
    );

    expect(translated).toEqual({
      height: 300,
      width: 500,
      x: 120,
      y: 140,
    });
  });

  it("clamps an oversized window to the complete usable rectangle", () => {
    expect(
      clampRectToUsableArea(
        { height: 2000, width: 4000, x: -1000, y: -1000 },
        { height: 600, width: 800, x: 300, y: 200 }
      )
    ).toEqual({ height: 600, width: 800, x: 300, y: 200 });
  });

  it("plans minimized and maximized moves with explicit restore and state steps", () => {
    const minimized = planWindowPlacement({
      rect: { height: 300, width: 500, x: -1800, y: 0 },
      sourceMonitor: source,
      state: minimizedWindowState,
      targetMonitor: target,
    });
    const maximized = planWindowPlacement({
      rect: { height: 1000, width: 1800, x: -1800, y: -60 },
      sourceMonitor: source,
      state: maximizedWindowState,
      targetMonitor: target,
    });

    expect(minimized.state).toEqual(minimizedWindowState);
    expect(minimized.targetRect).toMatchObject({ height: 300, width: 500 });
    expect(minimized.operations.map((operation) => operation._tag)).toEqual([
      "Restore",
      "Move",
      "SetState",
    ]);
    expect(maximized.state).toEqual(maximizedWindowState);
    expect(maximized.targetRect.width).toBe(1800);
    expect(maximized.targetRect.height).toBe(1000);
  });

  it("normalizes a snap target to the monitor work area", () => {
    const plan = planWindowSnap({
      area: { height: 1500, width: 3000, x: -100, y: -100 },
      monitor: target,
      rect: { height: 200, width: 300, x: 20, y: 40 },
      state: maximizedWindowState,
    });

    expect(plan.state).toEqual({ _tag: "Normal" });
    expect(plan.targetRect).toEqual(target.workArea);
    expect(plan.operations.map((operation) => operation._tag)).toEqual([
      "Restore",
      "Move",
    ]);
  });
});
