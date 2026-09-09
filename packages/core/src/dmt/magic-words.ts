/* oxlint-disable anti-slop/no-runtime-typeof -- Map and record values share a structural boundary. */

/** A configured launcher entry used by prefix matching. */
export interface MagicWord {
  /** User-facing alias typed into the launcher. */
  readonly alias: string;
  /** Optional launcher metadata retained by callers. */
  readonly filename?: string;
  readonly parameters?: string;
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
 * represents one literal dollar sign. An unclosed sequence remains literal so
 * partially typed launcher input can be safely displayed.
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

const isUrlSafe = (value: number): boolean =>
  URL_SAFE_CHARACTERS.has(String.fromCodePoint(value));

const encodeCharacter = (character: string, encoder: TextEncoder): string => {
  const codePoint = character.codePointAt(0);
  if (codePoint !== undefined && isUrlSafe(codePoint)) {
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
 * Encode a DMT web parameter using application/x-www-form-urlencoded rules.
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

const tokenText = (
  token: Extract<MagicWordToken, { readonly _tag: "Parameter" }>
): string => {
  const marker = token.parameter.kind === "Web" ? "W" : "I";
  return `$${marker}${token.parameter.name}$`;
};

/**
 * Expand a parsed magic-word template with caller-supplied parameter values.
 *
 * Missing values are left as their original `$I...$`/`$W...$` sequence. This
 * makes the function safe for autocomplete and allows an outer interaction
 * layer to decide how to collect input without putting UI effects in core.
 *
 * @param input - Magic-word template text.
 * @param values - Parameter lookup values.
 * @param options - Optional default key for unnamed parameters.
 * @returns Expanded template text.
 */
export const expandMagicWord = (
  input: string,
  values: MagicParameterValues,
  options: MagicWordExpansionOptions = {}
): string =>
  parseMagicWord(input)
    .map((token) => {
      if (token._tag === "Text") {
        return token.value;
      }
      const name = token.parameter.name || options.defaultParameterName || "";
      const value = lookupValue(values, name);
      if (value === undefined) {
        return tokenText(token);
      }
      return token.parameter.kind === "Web"
        ? encodeMagicWordParameter(value)
        : value;
    })
    .join("");

/** Alias for callers that use the command-line terminology. */
export const expandMagicWords = expandMagicWord;

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
