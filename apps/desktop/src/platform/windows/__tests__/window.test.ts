import { describe, expect, it } from "vitest";

import type {
  WindowsNativePointer,
  WindowsNativeRect,
  WindowsWindowNativeApi,
} from "../window";
import {
  createWindowsWindowPort,
  parseWindowGeometry,
  parseWindowsNativeRect,
} from "../window";

const writeNativeRect = (
  placement: Uint8Array,
  rect: WindowsNativeRect
): void => {
  const view = new DataView(placement.buffer);
  view.setInt32(28, rect.left, true);
  view.setInt32(32, rect.top, true);
  view.setInt32(36, rect.right, true);
  view.setInt32(40, rect.bottom, true);
};

describe("Windows foreground-window port", () => {
  it("returns explicit unsupported results off Windows without invoking native bindings", async () => {
    let nativeCalls = 0;
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => {
        nativeCalls += 1;
        return 1n;
      },
      getWindowPlacement: () => {
        nativeCalls += 1;
        return 1;
      },
      setWindowPos: () => {
        nativeCalls += 1;
        return 1;
      },
    };
    const port = createWindowsWindowPort({
      nativeApi,
      platform: "linux",
    });

    const results = await Promise.all([
      port.getForegroundWindow(),
      port.getNormalWindowRect(1n),
      port.setWindowPosition(1n, { height: 100, width: 100, x: 0, y: 0 }),
    ]);

    expect(results.map((result) => result._tag)).toEqual([
      "Unsupported",
      "Unsupported",
      "Unsupported",
    ]);
    expect(nativeCalls).toBe(0);
  });

  it("bounds geometry coordinates and dimensions before native calls", () => {
    expect(
      parseWindowGeometry({
        height: 1,
        width: 2_147_483_647,
        x: -2_147_483_648,
        y: 2_147_483_647,
      })
    ).toEqual({
      _tag: "Success",
      value: {
        height: 1,
        width: 2_147_483_647,
        x: -2_147_483_648,
        y: 2_147_483_647,
      },
    });
    expect(
      parseWindowGeometry({ height: 0, width: 100, x: 0, y: 0 })
    ).toMatchObject({
      _tag: "Error",
      operation: "setWindowPosition",
    });
    expect(
      parseWindowGeometry({
        height: 100,
        width: 100,
        x: 2_147_483_648,
        y: 0,
      })
    ).toMatchObject({
      _tag: "Error",
      operation: "setWindowPosition",
    });
  });

  it("parses and bounds a native normal rectangle", () => {
    expect(
      parseWindowsNativeRect({
        bottom: 550,
        left: -100,
        right: 700,
        top: -50,
      })
    ).toEqual({
      _tag: "Success",
      value: { height: 600, width: 800, x: -100, y: -50 },
    });
    expect(
      parseWindowsNativeRect({ bottom: 10, left: 10, right: 10, top: 0 })
    ).toMatchObject({
      _tag: "Error",
      operation: "getNormalWindowRect",
    });
  });

  it("normalizes a non-null foreground HWND", async () => {
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 0x12_34,
      getWindowPlacement: () => 1,
      setWindowPos: () => 1,
    };
    const result = await createWindowsWindowPort({
      nativeApi,
      platform: "win32",
    }).getForegroundWindow();

    expect(result).toEqual({ _tag: "Success", value: 0x12_34n });
  });

  it("classifies a null foreground HWND as unsupported", async () => {
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => null,
      getWindowPlacement: () => 1,
      setWindowPos: () => 1,
    };

    const result = await createWindowsWindowPort({
      nativeApi,
      platform: "win32",
    }).getForegroundWindow();

    expect(result).toMatchObject({
      _tag: "Unsupported",
      operation: "getForegroundWindow",
    });
  });

  it("does not return excluded foreground processes to the caller", async () => {
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: () => 1,
      getWindowProcessId: () => 42,
      setWindowPos: () => 1,
    };

    const result = await createWindowsWindowPort({
      excludedProcessIds: [42],
      nativeApi,
      platform: "win32",
    }).getForegroundWindow();

    expect(result).toMatchObject({
      _tag: "Unsupported",
      operation: "getForegroundWindow",
    });
  });

  it("does not move an excluded target window", async () => {
    let setCalls = 0;
    let inspectedWindow: WindowsNativePointer | undefined;
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: () => 1,
      getWindowProcessId: (window) => {
        inspectedWindow = window;
        return 42;
      },
      setWindowPos: () => {
        setCalls += 1;
        return 1;
      },
    };

    const result = await createWindowsWindowPort({
      excludedProcessIds: [42],
      nativeApi,
      platform: "win32",
    }).setWindowPosition(99n, {
      height: 100,
      width: 100,
      x: 0,
      y: 0,
    });

    expect(result).toMatchObject({
      _tag: "Unsupported",
      operation: "setWindowPosition",
    });
    expect(inspectedWindow).toBe(99n);
    expect(setCalls).toBe(0);
  });

  it("fails closed when excluded-process ownership cannot be checked", async () => {
    let setCalls = 0;
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: () => 1,
      setWindowPos: () => {
        setCalls += 1;
        return 1;
      },
    };

    const result = await createWindowsWindowPort({
      excludedProcessIds: [42],
      nativeApi,
      platform: "win32",
    }).setWindowPosition(99n, {
      height: 100,
      width: 100,
      x: 0,
      y: 0,
    });

    expect(result).toMatchObject({
      _tag: "Unsupported",
      operation: "setWindowPosition",
    });
    expect(setCalls).toBe(0);
  });

  it("fails closed when Windows cannot return the target owner PID", async () => {
    let setCalls = 0;
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: () => 1,
      getWindowProcessId: () => 0,
      setWindowPos: () => {
        setCalls += 1;
        return 1;
      },
    };

    const result = await createWindowsWindowPort({
      excludedProcessIds: [42],
      nativeApi,
      platform: "win32",
    }).setWindowPosition(99n, {
      height: 100,
      width: 100,
      x: 0,
      y: 0,
    });

    expect(result).toMatchObject({
      _tag: "Error",
      operation: "setWindowPosition",
    });
    expect(setCalls).toBe(0);
  });

  it("rejects a foreground window that is not associated with a monitor", async () => {
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowMonitor: () => null,
      getWindowPlacement: () => 1,
      setWindowPos: () => 1,
    };

    const result = await createWindowsWindowPort({
      nativeApi,
      platform: "win32",
    }).getForegroundWindow();

    expect(result).toMatchObject({
      _tag: "Unsupported",
      operation: "getForegroundWindow",
    });
  });

  it("reads the normal rectangle from WINDOWPLACEMENT without native mutation", async () => {
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: (window, placement) => {
        expect(window).toBe(1n);
        expect(placement.byteLength).toBe(44);
        expect(new DataView(placement.buffer).getUint32(0, true)).toBe(44);
        writeNativeRect(placement, {
          bottom: 550,
          left: -100,
          right: 700,
          top: -50,
        });
        return 1;
      },
      setWindowPos: () => 1,
    };

    const result = await createWindowsWindowPort({
      nativeApi,
      platform: "win32",
    }).getNormalWindowRect(1n);

    expect(result).toEqual({
      _tag: "Success",
      value: { height: 600, width: 800, x: -100, y: -50 },
    });
  });

  it("returns typed native failures and does not call SetWindowPos for invalid geometry", async () => {
    let setCalls = 0;
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: () => 0,
      setWindowPos: () => {
        setCalls += 1;
        return 0;
      },
    };
    const port = createWindowsWindowPort({
      nativeApi,
      platform: "win32",
    });

    const readResult = await port.getNormalWindowRect(1n);
    const invalidSetResult = await port.setWindowPosition(1n, {
      height: 0,
      width: 100,
      x: 0,
      y: 0,
    });
    const nativeSetFailureResult = await port.setWindowPosition(1n, {
      height: 100,
      width: 100,
      x: 0,
      y: 0,
    });
    const nullHandleResult = await port.getNormalWindowRect(0n);

    expect(readResult).toMatchObject({
      _tag: "Error",
      operation: "getNormalWindowRect",
    });
    expect(invalidSetResult).toMatchObject({
      _tag: "Error",
      operation: "setWindowPosition",
    });
    expect(nativeSetFailureResult).toMatchObject({
      _tag: "Error",
      operation: "setWindowPosition",
    });
    expect(nullHandleResult).toMatchObject({
      _tag: "Unsupported",
      operation: "getNormalWindowRect",
    });
    expect(setCalls).toBe(1);
  });

  it("passes bounded geometry to SetWindowPos without changing z-order or activation", async () => {
    let request:
      | {
          readonly window: WindowsNativePointer;
          readonly insertAfter: WindowsNativePointer | null;
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
          readonly flags: number;
        }
      | undefined;
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: () => 1,
      setWindowPos: (window, insertAfter, x, y, width, height, flags) => {
        request = {
          flags,
          height,
          insertAfter,
          width,
          window,
          x,
          y,
        };
        return 1;
      },
    };

    const result = await createWindowsWindowPort({
      nativeApi,
      platform: "win32",
    }).setWindowPosition(1n, {
      height: 600,
      width: 800,
      x: -100,
      y: -50,
    });

    expect(result._tag).toBe("Success");
    expect(request).toEqual({
      flags: 0x14,
      height: 600,
      insertAfter: null,
      width: 800,
      window: 1n,
      x: -100,
      y: -50,
    });
  });

  it("restores a window before a snap when the native restore seam is available", async () => {
    let command = 0;
    const nativeApi: WindowsWindowNativeApi = {
      getForegroundWindow: () => 1n,
      getWindowPlacement: () => 1,
      setWindowPos: () => 1,
      showWindow: (_window, value) => {
        command = value;
        return 1;
      },
    };
    const port = createWindowsWindowPort({
      nativeApi,
      platform: "win32",
    });

    if (port.restoreWindow === undefined) {
      throw new Error("Expected the Windows port to expose restoreWindow");
    }
    const result = await port.restoreWindow(1n);

    expect(result._tag).toBe("Success");
    expect(command).toBe(9);
  });
});
