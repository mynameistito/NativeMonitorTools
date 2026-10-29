/* oxlint-disable anti-slop/no-runtime-typeof -- Map and record values share a structural boundary. */

/** A configured launcher entry used by prefix matching and later expansion. */
export interface MagicWord {
  /** User-facing alias typed into the launcher. */
  readonly alias: string;
  /** Application, document, directory, URL, or internal command to launch. */
  readonly filename?: string;
  /** Optional command-line parameters. */
  readonly parameters?: string;
  /** Prompt used for an unnamed `$I$` or `$W$` parameter. */
  readonly comment?: string;
  /** Optional launcher metadata retained for a later platform adapter. */
  readonly startDirectory?: string;
  readonly windowClass?: string;
  readonly captionRegExpr?: string;
  readonly useCount?: number;
  readonly lastUsed?: string;
}

/** The two DMT dynamic parameter expansion modes. */
export type MagicParameterKind = "Identity" | "Web";

/** A dynamic parameter from a `$I...$` or `$W...$` sequence. */
export interface MagicParameter {
  /** Whether the value is inserted literally or URL encoded. */
  readonly kind: MagicParameterKind;
  /** Named lookup key, or an empty string for the default prompt. */
  readonly name: string;
}

/** One parsed piece of a magic-word template. */
export type MagicWordToken =
  | { readonly _tag: "Text"; readonly value: string }
  | { readonly _tag: "Parameter"; readonly parameter: MagicParameter };

/** Values supplied by a platform-independent caller during expansion. */
export type MagicParameterValues =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>;

/** Options for resolving unnamed dynamic parameters. */
export interface MagicWordExpansionOptions {
  /** Lookup key to use when a sequence contains only `$I$` or `$W$`. */
  readonly defaultParameterName?: string;
  /** Legacy DMT/SlickRun fallback prompt for an unnamed sequence. */
  readonly comment?: string;
  /** Whether missing values remain visible or are replaced by an empty string. */
  readonly missing?: "preserve" | "empty";
}

/** A normalized parameter requirement exposed to a launcher or CLI prompt layer. */
export interface MagicWordParameterRequirement {
  /** Resolved lookup key used by the parameter map. */
  readonly name: string;
  /** Encoding behavior required by this occurrence. */
  readonly kind: MagicParameterKind;
}

/** Expansion output plus the values a later interaction layer still needs. */
export interface MagicWordExpansionResult {
  /** Expanded text, preserving or emptying missing parameters per options. */
  readonly text: string;
  /** Missing unique lookup keys in first-appearance order. */
  readonly missing: readonly MagicWordParameterRequirement[];
}

const appendText = (tokens: MagicWordToken[], text: string): void => {
  if (text.length === 0) {
    return;
  }
  const last = tokens.at(-1);
  if (last?._tag === "Text") {
    tokens[tokens.length - 1] = { _tag: "Text", value: last.value + text };
    return;
  }
  tokens.push({ _tag: "Text", value: text });
};

const flushText = (tokens: MagicWordToken[], text: string): string => {
  if (text.length > 0) {
    appendText(tokens, text);
  }
  return "";
};

interface DollarSequence {
  readonly nextIndex: number;
  readonly text?: string;
  readonly token?: MagicWordToken;
}

const parseDollarSequence = (input: string, index: number): DollarSequence => {
  if (input[index + 1] === "$") {
    return {
      nextIndex: index + 2,
      token: { _tag: "Text", value: "$" },
    };
  }

  const end = input.indexOf("$", index + 1);
  if (end === -1) {
    return { nextIndex: input.length, text: input.slice(index) };
  }

  const body = input.slice(index + 1, end);
  if (body.length === 0) {
    return { nextIndex: end + 1, text: "$" };
  }

  const marker = body[0]?.toLocaleUpperCase();
  const kind: MagicParameterKind = marker === "W" ? "Web" : "Identity";
  return {
    nextIndex: end + 1,
    token: {
      _tag: "Parameter",
      parameter: { kind, name: body.slice(1) },
    },
  };
};

/**
 * Parse DMT dynamic parameters and dollar escaping without performing I/O.
 *
 * `$Ivalue$` inserts a value literally, `$Wvalue$` URL-encodes it, and `$$`
 * represents one literal dollar sign. Unknown markers retain DMT's legacy
 * behavior and are treated as identity parameters. An unclosed sequence
 * remains literal so partially typed launcher input is safe to display.
 *
 * @param input - Magic-word template text.
 * @returns Parsed text and parameter tokens.
 */
export const parseMagicWord = (input: string): readonly MagicWordToken[] => {
  const tokens: MagicWordToken[] = [];
  let text = "";
  let index = 0;

  while (index < input.length) {
    if (input[index] === "$") {
      const sequence = parseDollarSequence(input, index);
      if (sequence.token === undefined) {
        text += sequence.text ?? "";
      } else if (sequence.token._tag === "Text") {
        text = flushText(tokens, text);
        appendText(tokens, sequence.token.value);
      } else {
        text = flushText(tokens, text);
        tokens.push(sequence.token);
      }
      index = sequence.nextIndex;
    } else {
      text += input[index] ?? "";
      index += 1;
    }
  }

  flushText(tokens, text);
  return tokens;
};

/** Alias using the plural terminology from launcher configuration. */
export const parseMagicWords = parseMagicWord;

const isParameterMap = (
  values: MagicParameterValues
): values is ReadonlyMap<string, string> =>
  "get" in values && typeof values.get === "function";

const lookupValue = (
  values: MagicParameterValues,
  name: string
): string | undefined => {
  if (isParameterMap(values)) {
    return values.get(name);
  }
  return values[name];
};

const URL_SAFE_CHARACTERS = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$-_@.!*(),"
);

const isUrlSafe = (character: string): boolean =>
  URL_SAFE_CHARACTERS.has(character);

const encodeCharacter = (character: string, encoder: TextEncoder): string => {
  if (isUrlSafe(character)) {
    return character;
  }
  if (character === " ") {
    return "+";
  }
  let encoded = "";
  for (const byte of encoder.encode(character)) {
    encoded += `%${byte.toString(16).padStart(2, "0")}`;
  }
  return encoded;
};

/**
 * Encode a DMT web parameter using DMT's form-url-encoding rules.
 *
 * @param value - Raw user input.
 * @returns URL-safe value with spaces represented by `+`.
 */
export const encodeMagicWordParameter = (value: string): string => {
  const encoder = new TextEncoder();
  return Array.from(value, (character) =>
    encodeCharacter(character, encoder)
  ).join("");
};

const parameterName = (
  parameter: MagicParameter,
  options: MagicWordExpansionOptions
): string =>
  parameter.name || options.defaultParameterName || options.comment || "";

const requirementKey = (requirement: MagicWordParameterRequirement): string =>
  // Identity and web occurrences share one raw value in DMT's parameter map.
  requirement.name;

/**
 * List dynamic values required by a template in first-appearance order.
 *
 * Repeated names are listed once because DMT shares a parameter map across
 * magic words with the same alias.
 *
 * @param input - Magic-word template text.
 * @param options - Fallback prompt options for unnamed parameters.
 * @returns Unique parameter requirements.
 */
export const getMagicWordParameterRequirements = (
  input: string,
  options: MagicWordExpansionOptions = {}
): readonly MagicWordParameterRequirement[] => {
  const seen = new Set<string>();
  const requirements: MagicWordParameterRequirement[] = [];
  for (const token of parseMagicWord(input)) {
    if (token._tag === "Text") {
      continue;
    }
    const requirement = {
      kind: token.parameter.kind,
      name: parameterName(token.parameter, options),
    };
    const key = requirementKey(requirement);
    if (!seen.has(key)) {
      seen.add(key);
      requirements.push(requirement);
    }
  }
  return requirements;
};

/** Alias using launcher-oriented wording. */
export const collectMagicWordParameters = getMagicWordParameterRequirements;

const tokenText = (
  token: Extract<MagicWordToken, { readonly _tag: "Parameter" }>
): string => {
  const marker = token.parameter.kind === "Web" ? "W" : "I";
  return `$${marker}${token.parameter.name}$`;
};

/**
 * Expand a magic-word template and report values still missing from the map.
 *
 * Missing values are not prompted for here. The returned requirements allow a
 * launcher or CLI adapter to collect them, then call this function again with
 * the completed map. Existing values are always treated as raw values and are
 * encoded only at the `$W...$` occurrence.
 *
 * @param input - Magic-word template text.
 * @param values - Parameter lookup values.
 * @param options - Fallback prompt and missing-value behavior.
 * @returns Expanded text plus missing requirements.
 */
export const expandMagicWordWithReport = (
  input: string,
  values: MagicParameterValues,
  options: MagicWordExpansionOptions = {}
): MagicWordExpansionResult => {
  const missing: MagicWordParameterRequirement[] = [];
  const seenMissing = new Set<string>();
  const parts = parseMagicWord(input).map((token) => {
    if (token._tag === "Text") {
      return token.value;
    }

    const name = parameterName(token.parameter, options);
    const value = lookupValue(values, name);
    if (value === undefined) {
      const requirement = { kind: token.parameter.kind, name };
      const key = requirementKey(requirement);
      if (!seenMissing.has(key)) {
        seenMissing.add(key);
        missing.push(requirement);
      }
      return options.missing === "empty" ? "" : tokenText(token);
    }
    return token.parameter.kind === "Web"
      ? encodeMagicWordParameter(value)
      : value;
  });

  return { missing, text: parts.join("") };
};

/**
 * Expand a magic-word template with caller-supplied parameter values.
 *
 * @param input - Magic-word template text.
 * @param values - Parameter lookup values.
 * @param options - Fallback prompt and missing-value behavior.
 * @returns Expanded template text.
 */
export const expandMagicWord = (
  input: string,
  values: MagicParameterValues,
  options: MagicWordExpansionOptions = {}
): string => expandMagicWordWithReport(input, values, options).text;

/** Alias for callers that use the command-line terminology. */
export const expandMagicWords = expandMagicWord;

/**
 * Expand the launch-bearing fields of one configured magic word.
 *
 * Filename and parameters share one map, matching the reference launcher. The
 * word comment is used as the fallback prompt for unnamed parameters.
 * Metadata fields are copied without platform-specific interpretation.
 *
 * @param word - Configured magic word.
 * @param values - Parameter lookup values.
 * @param options - Optional expansion overrides.
 * @returns A new expanded magic-word value.
 */
export const expandMagicWordEntry = (
  word: MagicWord,
  values: MagicParameterValues,
  options: MagicWordExpansionOptions = {}
): MagicWord => {
  const expansionOptions = {
    ...options,
    comment: options.comment ?? word.comment,
  };
  const filename =
    word.filename === undefined
      ? undefined
      : expandMagicWord(word.filename, values, expansionOptions);
  const parameters =
    word.parameters === undefined
      ? undefined
      : expandMagicWord(word.parameters, values, expansionOptions);
  const expanded = { ...word };
  if (filename !== undefined) {
    expanded.filename = filename;
  }
  if (parameters !== undefined) {
    expanded.parameters = parameters;
  }
  return expanded;
};

/** Alias using plural launcher terminology. */
export const expandMagicWordFields = expandMagicWordEntry;

/**
 * Return magic words whose aliases start with a case-insensitive prefix.
 *
 * Input order is retained so callers can provide a configured preference
 * order; no platform-dependent sorting is introduced here.
 *
 * @param words - Configured magic words.
 * @param prefix - Prefix to match.
 * @returns Matching words in input order.
 */
export const matchMagicWordPrefix = (
  words: readonly MagicWord[],
  prefix: string
): readonly MagicWord[] => {
  const normalizedPrefix = prefix.toLocaleLowerCase();
  return words.filter((word) =>
    word.alias.toLocaleLowerCase().startsWith(normalizedPrefix)
  );
};

/** Alias matching the original DMT autocomplete name. */
export const getMagicWordCompletions = matchMagicWordPrefix;

/** Alias matching the original DMT collection method. */
export const getAutoCompleteWords = matchMagicWordPrefix;

/**
 * Find all magic words with an exact case-insensitive alias.
 *
 * @param words - Configured magic words.
 * @param alias - Alias to resolve.
 * @returns All matching entries in input order.
 */
export const findMagicWordsByAlias = (
  words: readonly MagicWord[],
  alias: string
): readonly MagicWord[] => {
  const normalizedAlias = alias.toLocaleLowerCase();
  return words.filter(
    (word) => word.alias.toLocaleLowerCase() === normalizedAlias
  );
};

/** Find the first exact alias match, if one exists. */
export const findMagicWordByAlias = (
  words: readonly MagicWord[],
  alias: string
): MagicWord | undefined => findMagicWordsByAlias(words, alias)[0];

/**
 * Merge configured words using the reference launcher's alias replacement rule.
 *
 * Every existing entry with an imported alias is removed before imported
 * entries are appended. Duplicate imported aliases are intentionally retained
 * because DMT launches all entries selected for one alias.
 *
 * @param existing - Existing configured words.
 * @param imported - Words being imported.
 * @returns A new merged collection; neither input is mutated.
 */
export const mergeMagicWords = (
  existing: readonly MagicWord[],
  imported: readonly MagicWord[]
): readonly MagicWord[] => {
  const importedAliases = new Set(
    imported.map((word) => word.alias.toLocaleLowerCase())
  );
  return [
    ...existing.filter(
      (word) => !importedAliases.has(word.alias.toLocaleLowerCase())
    ),
    ...imported,
  ];
};
