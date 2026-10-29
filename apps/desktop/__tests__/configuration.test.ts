import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseDesktopPlatform,
  resolveDesktopPaths,
} from "../src/storage/configuration";

describe("desktop configuration paths", () => {
  it("uses the test override as the data root", () => {
    const paths = resolveDesktopPaths(
      { NATIVE_MONITOR_TOOLS_DATA_DIR: "C:\\test-data" },
      "win32",
      "C:\\Users\\tester"
    );

    expect(paths.dataDirectory).toBe("C:\\test-data");
    expect(paths.profileDirectory).toBe(path.join("C:\\test-data", "profiles"));
  });

  it("selects a platform app-data base when no override is present", () => {
    const paths = resolveDesktopPaths(
      { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      parseDesktopPlatform("win32"),
      "C:\\Users\\tester"
    );

    expect(paths.dataDirectory).toBe(
      path.join("C:\\Users\\tester\\AppData\\Local", "NativeMonitorTools")
    );
  });
});
