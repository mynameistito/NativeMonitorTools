import { describe, expect, it } from "vitest";

import { renderCliResult } from "../src/cli/renderer";

describe("desktop CLI renderer", () => {
  it("renders machine output as parseable JSON with command context", () => {
    const output = renderCliResult(
      { _tag: "ProfileListResult", profiles: ["desk", "travel"] },
      "json"
    );

    expect(JSON.parse(output)).toEqual({
      command: "profile list",
      profiles: ["desk", "travel"],
    });
  });

  it("renders dry-run apply results without hiding the preview", () => {
    const output = renderCliResult(
      {
        _tag: "ProfileAppliedResult",
        dryRun: true,
        name: "desk",
        plan: { dryRun: true, isNoop: true, operations: [] },
      },
      "text"
    );

    expect(output).toContain("Dry run for profile desk");
    expect(output).toContain("No display changes are required.");
  });
});
