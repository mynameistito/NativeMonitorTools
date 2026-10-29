import { describe, expect, it } from "vitest";

import {
  encodeMagicWordParameter,
  expandMagicWord,
  expandMagicWordEntry,
  expandMagicWordWithReport,
  findMagicWordByAlias,
  getMagicWordCompletions,
  getMagicWordParameterRequirements,
  mergeMagicWords,
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

  it("uses the word comment for unnamed parameters and reports missing values", () => {
    expect(parseMagicWord("$Qvalue$")).toEqual([
      { _tag: "Parameter", parameter: { kind: "Identity", name: "value" } },
    ]);
    expect(
      getMagicWordParameterRequirements("$I$ $W$ $I$", { comment: "term" })
    ).toEqual([{ kind: "Identity", name: "term" }]);

    const report = expandMagicWordWithReport(
      "find $Iknown$ $Imissing$ $Wmissing$",
      new Map([["known", "Ada"]])
    );
    expect(report).toEqual({
      missing: [{ kind: "Identity", name: "missing" }],
      text: "find Ada $Imissing$ $Wmissing$",
    });
    expect(
      expandMagicWordWithReport("$Imissing$", new Map(), { missing: "empty" })
    ).toEqual({
      missing: [{ kind: "Identity", name: "missing" }],
      text: "",
    });
  });

  it("expands filename and parameter fields without mutating launcher metadata", () => {
    const word = {
      alias: "Search",
      comment: "term",
      filename: "browser.exe?$I$",
      parameters: "--query=$Wquery$",
      startDirectory: "C:/tools",
    };
    const expanded = expandMagicWordEntry(
      word,
      new Map([
        ["term", "Ada Lovelace"],
        ["query", "hello world"],
      ])
    );

    expect(expanded).toEqual({
      ...word,
      filename: "browser.exe?Ada Lovelace",
      parameters: "--query=hello+world",
    });
    expect(word.filename).toBe("browser.exe?$I$");
  });

  it("replaces imported aliases while preserving unrelated and duplicate imports", () => {
    const existing = [
      { alias: "Browser", filename: "old.exe" },
      { alias: "Keep", filename: "keep.exe" },
    ];
    const imported = [
      { alias: "browser", filename: "new.exe" },
      { alias: "Browser", filename: "also-new.exe" },
    ];

    expect(mergeMagicWords(existing, imported)).toEqual([
      { alias: "Keep", filename: "keep.exe" },
      { alias: "browser", filename: "new.exe" },
      { alias: "Browser", filename: "also-new.exe" },
    ]);
    expect(existing[0]?.filename).toBe("old.exe");
  });
});
