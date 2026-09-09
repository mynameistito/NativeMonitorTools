import { Data, Effect } from "effect";

import { makeGammaManagerSettings } from "./gamma";
import type { GammaManagerSettings } from "./gamma";

/** The parsed sections of a GammaManager.ini document, keyed by section name. */
export type GammaManagerIni = Readonly<Record<string, GammaManagerSettings>>;

/** A typed failure while parsing a GammaManager.ini document. */
export class InvalidGammaManagerIni extends Data.TaggedError(
  "InvalidGammaManagerIni"
)<{
  /** The section containing the malformed value, when known. */
  readonly section: string | null;
  /** The key containing the malformed value, when known. */
  readonly key: string | null;
  /** The one-based source line, when known. */
  readonly line: number | null;
  /** The rejected source value, when known. */
  readonly value: string | null;
  /** A stable description of the parse failure. */
  readonly reason: string;
}> {}

/** Runtime alias for the parse-error name used by compatibility callers. */
export const GammaManagerIniParseError = InvalidGammaManagerIni;

interface IniEntry {
  readonly key: string;
  readonly line: number;
  readonly value: string;
}

const requiredKeys = [
  "monitor",
  "rgamma",
  "ggamma",
  "bgamma",
  "rcontrast",
  "gcontrast",
  "bcontrast",
  "rbright",
  "gbright",
  "bbright",
  "monitorbrightness",
  "monitorcontrast",
] as const;

const decimalPattern = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/u;

const isRequiredKey = (key: string): boolean =>
  requiredKeys.some((requiredKey) => requiredKey === key);

const invalid = (
  reason: string,
  section: string | null = null,
  key: string | null = null,
  line: number | null = null,
  value: string | null = null
): Effect.Effect<never, InvalidGammaManagerIni> =>
  Effect.fail(
    new InvalidGammaManagerIni({ key, line, reason, section, value })
  );

const parseDecimal = (
  entry: IniEntry,
  section: string
): Effect.Effect<number, InvalidGammaManagerIni> => {
  const normalized = entry.value.trim().replace(",", ".");
  if (!decimalPattern.test(normalized)) {
    return invalid(
      "Expected a finite decimal number using a comma or period separator",
      section,
      entry.key,
      entry.line,
      entry.value
    );
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return invalid(
      "Expected a finite decimal number",
      section,
      entry.key,
      entry.line,
      entry.value
    );
  }
  return Effect.succeed(value);
};

const parseInteger = (
  entry: IniEntry,
  section: string
): Effect.Effect<number, InvalidGammaManagerIni> =>
  parseDecimal(entry, section).pipe(
    Effect.flatMap((value) => {
      if (!Number.isInteger(value)) {
        return invalid(
          "Expected an integer value",
          section,
          entry.key,
          entry.line,
          entry.value
        );
      }
      return Effect.succeed(value);
    })
  );

const requiredEntry = (
  values: ReadonlyMap<string, IniEntry>,
  section: string,
  key: (typeof requiredKeys)[number]
): Effect.Effect<IniEntry, InvalidGammaManagerIni> => {
  const entry = values.get(key);
  if (entry === undefined) {
    return invalid(`Missing required key "${key}"`, section, key);
  }
  return Effect.succeed(entry);
};

const parseSection = (
  section: string,
  values: ReadonlyMap<string, IniEntry>
): Effect.Effect<GammaManagerSettings, InvalidGammaManagerIni> =>
  Effect.gen(function* parseSectionEffect() {
    const monitorEntry = yield* requiredEntry(values, section, "monitor");
    const monitor = monitorEntry.value.trim();
    if (monitor.length === 0) {
      return yield* invalid(
        "Monitor name must not be empty",
        section,
        monitorEntry.key,
        monitorEntry.line,
        monitorEntry.value
      );
    }

    const rGammaEntry = yield* requiredEntry(values, section, "rgamma");
    const gGammaEntry = yield* requiredEntry(values, section, "ggamma");
    const bGammaEntry = yield* requiredEntry(values, section, "bgamma");
    const rContrastEntry = yield* requiredEntry(values, section, "rcontrast");
    const gContrastEntry = yield* requiredEntry(values, section, "gcontrast");
    const bContrastEntry = yield* requiredEntry(values, section, "bcontrast");
    const rBrightEntry = yield* requiredEntry(values, section, "rbright");
    const gBrightEntry = yield* requiredEntry(values, section, "gbright");
    const bBrightEntry = yield* requiredEntry(values, section, "bbright");
    const monitorBrightnessEntry = yield* requiredEntry(
      values,
      section,
      "monitorbrightness"
    );
    const monitorContrastEntry = yield* requiredEntry(
      values,
      section,
      "monitorcontrast"
    );

    const rGamma = yield* parseDecimal(rGammaEntry, section);
    const gGamma = yield* parseDecimal(gGammaEntry, section);
    const bGamma = yield* parseDecimal(bGammaEntry, section);
    const rContrast = yield* parseDecimal(rContrastEntry, section);
    const gContrast = yield* parseDecimal(gContrastEntry, section);
    const bContrast = yield* parseDecimal(bContrastEntry, section);
    const rBright = yield* parseDecimal(rBrightEntry, section);
    const gBright = yield* parseDecimal(gBrightEntry, section);
    const bBright = yield* parseDecimal(bBrightEntry, section);
    const monitorBrightness = yield* parseInteger(
      monitorBrightnessEntry,
      section
    );
    const monitorContrast = yield* parseInteger(monitorContrastEntry, section);

    return makeGammaManagerSettings({
      bBright,
      bContrast,
      bGamma,
      gBright,
      gContrast,
      gGamma,
      monitor,
      monitorBrightness,
      monitorContrast,
      rBright,
      rContrast,
      rGamma,
    });
  });

const parseLine = (
  line: string,
  lineNumber: number,
  currentSection: string | null,
  sections: Map<string, Map<string, IniEntry>>,
  sectionNames: Map<string, string>
): Effect.Effect<string | null, InvalidGammaManagerIni> => {
  const trimmed = line.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith(";") ||
    trimmed.startsWith("#")
  ) {
    return Effect.succeed(currentSection);
  }

  if (trimmed.startsWith("[")) {
    if (!trimmed.endsWith("]")) {
      return invalid(
        "Section header must end with ]",
        currentSection,
        null,
        lineNumber,
        line
      );
    }
    const section = trimmed.slice(1, -1).trim();
    if (section.length === 0) {
      return invalid(
        "Section name must not be empty",
        null,
        null,
        lineNumber,
        line
      );
    }
    const normalizedSection = section.toLowerCase();
    if (sectionNames.has(normalizedSection)) {
      return invalid(
        "Section names must be unique",
        section,
        null,
        lineNumber,
        line
      );
    }
    sectionNames.set(normalizedSection, section);
    sections.set(section, new Map());
    return Effect.succeed(section);
  }

  if (currentSection === null) {
    return invalid(
      "A key/value pair must follow a section header",
      null,
      null,
      lineNumber,
      line
    );
  }

  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    return invalid(
      "Expected a key=value pair",
      currentSection,
      null,
      lineNumber,
      line
    );
  }
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  const normalizedKey = key.toLowerCase();
  if (!isRequiredKey(normalizedKey)) {
    return invalid(
      "Unknown GammaManager.ini key",
      currentSection,
      key,
      lineNumber,
      value
    );
  }
  const values = sections.get(currentSection);
  if (values === undefined) {
    return invalid(
      "Internal section state was not found",
      currentSection,
      key,
      lineNumber,
      value
    );
  }
  if (values.has(normalizedKey)) {
    return invalid(
      "Keys must be unique within a section",
      currentSection,
      key,
      lineNumber,
      value
    );
  }
  values.set(normalizedKey, { key, line: lineNumber, value });
  return Effect.succeed(currentSection);
};

/**
 * Parse the legacy GammaManager.ini text format without throwing.
 *
 * @param input - The UTF-8 text of a GammaManager.ini document.
 * @returns An Effect containing the parsed sections or a typed parse error.
 */
export const parseGammaManagerIni = (
  input: string
): Effect.Effect<GammaManagerIni, InvalidGammaManagerIni> =>
  Effect.gen(function* parseIniEffect() {
    const sections = new Map<string, Map<string, IniEntry>>();
    const sectionNames = new Map<string, string>();
    let currentSection: string | null = null;
    const lines = input.replace(/^\uFEFF/u, "").split(/\r\n|\n|\r/u);

    for (const [index, line] of lines.entries()) {
      currentSection = yield* parseLine(
        line,
        index + 1,
        currentSection,
        sections,
        sectionNames
      );
    }

    const parsed: Record<string, GammaManagerSettings> = {};
    for (const [section, values] of sections) {
      parsed[section] = yield* parseSection(section, values);
    }
    return parsed;
  });

const serializeValue = (value: number): string => value.toString();

const serializeSection = (
  section: string,
  settings: GammaManagerSettings
): readonly string[] => [
  `[${section}]`,
  `monitor=${settings.monitor}`,
  `rGamma=${serializeValue(settings.rGamma)}`,
  `gGamma=${serializeValue(settings.gGamma)}`,
  `bGamma=${serializeValue(settings.bGamma)}`,
  `rContrast=${serializeValue(settings.rContrast)}`,
  `gContrast=${serializeValue(settings.gContrast)}`,
  `bContrast=${serializeValue(settings.bContrast)}`,
  `rBright=${serializeValue(settings.rBright)}`,
  `gBright=${serializeValue(settings.gBright)}`,
  `bBright=${serializeValue(settings.bBright)}`,
  `monitorBrightness=${serializeValue(settings.monitorBrightness)}`,
  `monitorContrast=${serializeValue(settings.monitorContrast)}`,
];

/** Serialize GammaManager.ini sections with stable section and key ordering. */
export const serializeGammaManagerIni = (input: GammaManagerIni): string => {
  const lines: string[] = [];
  for (const section of Object.keys(input).toSorted()) {
    const settings = input[section];
    if (settings === undefined) {
      continue;
    }
    lines.push(...serializeSection(section, settings));
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};
