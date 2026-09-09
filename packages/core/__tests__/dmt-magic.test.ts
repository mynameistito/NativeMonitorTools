import { describe, expect, it } from "vitest";

import {
  encodeMagicWordParameter,
  expandMagicWord,
  findMagicWordByAlias,
  getMagicWordCompletions,
  parseMagicWord,
} from "../src/dmt/magic-words";

describe("DMT magic words", () => {
  const words = [
    { alias: "Browser", filename: "browser.exe" },
    { alias: "Build", filename: "build.exe" },
    { alias: "Notes", filename: "notes.exe" },
  ];

  it("matches aliases by case-insensitive prefix and exact alias", () => {
    expect(
      getMagicWordCompletions(words, "b").map((word) => word.alias)
    ).toEqual(["Browser", "Build"]);
    expect(findMagicWordByAlias(words, "NOTES")?.alias).toBe("Notes");
    expect(getMagicWordCompletions(words, "missing")).toEqual([]);
  });

  it("parses identity, web, and escaped-dollar sequences", () => {
    expect(parseMagicWord("run $$ $Iuser$ $Wquery$")).toEqual([
      { _tag: "Text", value: "run $ " },
      { _tag: "Parameter", parameter: { kind: "Identity", name: "user" } },
      { _tag: "Text", value: " " },
      { _tag: "Parameter", parameter: { kind: "Web", name: "query" } },
    ]);
  });

  it("expands parameters while preserving literal dollars and escaping web values", () => {
    const values = new Map([
      ["user", "Ada & Grace"],
      ["query", "hello world&x"],
    ]);

    expect(
      expandMagicWord("echo $$ $Iuser$ https://x.test/?q=$Wquery$", values)
    ).toBe("echo $ Ada & Grace https://x.test/?q=hello+world%26x");
    expect(encodeMagicWordParameter("$ a/b")).toBe("$+a%2fb");
    expect(expandMagicWord("$Imissing$", values)).toBe("$Imissing$");
  });
});
