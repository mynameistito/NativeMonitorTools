import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  resolveSlintPanelBackendPath,
  resolveSlintPanelBinaryPath,
  resolveSlintPanelCargoArguments,
  resolveSlintPanelReleaseNoticePaths,
} from "../slint-panel";

describe("Slint panel packaged backend path", () => {
  test("stages the Windows JSON-lines adapter beside the debug panel", () => {
    expect(resolveSlintPanelBackendPath("C:\\repo", "win32")).toBe(
      path.join(
        "C:\\repo",
        "dist",
        "slint-panel",
        "debug",
        "native-monitor-tools-backend.exe"
      )
    );
  });

  test("resolves the Windows release panel and adjacent backend", () => {
    expect(resolveSlintPanelBinaryPath("C:\\repo", "win32")).toBe(
      path.join(
        "C:\\repo",
        "dist",
        "slint-panel",
        "release",
        "native-monitor-tools-slint-ui.exe"
      )
    );
    expect(resolveSlintPanelBackendPath("C:\\repo", "win32", "release")).toBe(
      path.join(
        "C:\\repo",
        "dist",
        "slint-panel",
        "release",
        "native-monitor-tools-backend.exe"
      )
    );
  });

  test("keeps the release names portable outside Windows", () => {
    expect(resolveSlintPanelBackendPath("/repo", "linux", "release")).toBe(
      path.join(
        "/repo",
        "dist",
        "slint-panel",
        "release",
        "native-monitor-tools-backend"
      )
    );
  });

  test("uses the actual Slint crate for Cargo build and run commands", () => {
    expect(resolveSlintPanelCargoArguments("build")).toEqual([
      "build",
      "--manifest-path",
      "apps/slint-ui/Cargo.toml",
      "--target-dir",
      "dist/slint-panel",
    ]);
    expect(resolveSlintPanelCargoArguments("run")).toEqual([
      "run",
      "--manifest-path",
      "apps/slint-ui/Cargo.toml",
      "--target-dir",
      "dist/slint-panel",
    ]);
    expect(resolveSlintPanelCargoArguments("build", "release")).toEqual([
      "build",
      "--release",
      "--manifest-path",
      "apps/slint-ui/Cargo.toml",
      "--target-dir",
      "dist/slint-panel",
    ]);
  });

  test("keeps optional release notices rooted at the repository", () => {
    expect(resolveSlintPanelReleaseNoticePaths("C:\\repo")).toEqual([
      path.join("C:\\repo", "COPYING.txt"),
      path.join("C:\\repo", "NOTICE.md"),
    ]);
  });
});
