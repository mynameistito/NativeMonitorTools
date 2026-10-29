import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  findExecutableOnPath,
  getVsDevCmdCandidates,
  getVsWhereCandidates,
  parseCommandEnvironment,
} from "../cargo-msvc";

describe("cargo-msvc path helpers", () => {
  test("prioritizes configured and PATH vswhere locations before installer paths", () => {
    const environment = {
      PATH: ["C:\\tools", "C:\\other"].join(path.delimiter),
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      VSWHERE_PATH: "C:\\configured\\vswhere.exe",
    };

    expect(getVsWhereCandidates(environment)).toEqual([
      "C:\\configured\\vswhere.exe",
      path.join("C:\\tools", "vswhere.exe"),
      path.join("C:\\other", "vswhere.exe"),
      path.join(
        "C:\\Program Files (x86)",
        "Microsoft Visual Studio",
        "Installer",
        "vswhere.exe"
      ),
      path.join(
        "C:\\Program Files",
        "Microsoft Visual Studio",
        "Installer",
        "vswhere.exe"
      ),
    ]);
  });

  test("includes VSINSTALLDIR and standard Build Tools locations", () => {
    const candidates = getVsDevCmdCandidates({
      ProgramFiles: "C:\\Program Files",
      VSINSTALLDIR: "C:\\custom\\BuildTools",
    });

    expect(candidates[0]).toBe(
      path.join("C:\\custom\\BuildTools", "Common7", "Tools", "VsDevCmd.bat")
    );
    expect(candidates).toContain(
      path.join(
        "C:\\Program Files",
        "Microsoft Visual Studio",
        "2022",
        "BuildTools",
        "Common7",
        "Tools",
        "VsDevCmd.bat"
      )
    );
  });
});

describe("cargo-msvc environment helpers", () => {
  test("parses developer-shell output without duplicating case-insensitive keys", () => {
    const environment = parseCommandEnvironment(
      "Path=C:\\msvc;C:\\Windows\\System32\r\nVCToolsInstallDir=C:\\msvc\\\r\n=C:\\ignored\r\n",
      { CI: "1", PATH: "C:\\original" }
    );

    expect(environment).toEqual({
      CI: "1",
      PATH: "C:\\msvc;C:\\Windows\\System32",
      VCToolsInstallDir: "C:\\msvc\\",
    });
  });

  test("finds an executable using the supplied PATH", () => {
    const executable = findExecutableOnPath(
      "executable-that-does-not-exist.exe",
      {
        PATH: process.cwd(),
      }
    );

    expect(executable).toBeUndefined();
  });
});
