const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/u;
const TOKEN_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}][\p{L}\p{N}_./#+:-]*/gu;
const TECHNICAL_SEPARATOR = /[._/#+:-]+/u;
const SPACED_IDENTIFIER = /([a-z]{2,})[\s._/#+:-]+(\d[a-z\d]*)/giu;
const NATURAL_QUANTITY = /^\d+(?:[.,]\d+)?\s*(?:millilitri?|chilogrammi?|grammi?|litri?|kcal|mcg|mg|kg|gr|ml|cl|dl|ug|cal|g|l)\b/iu;
const LOWERCASE_OR_NUMBER = /[\p{Ll}\p{N}]/u;
const UPPERCASE = /\p{Lu}/u;
const LOWERCASE = /\p{Ll}/u;

let wordSegmenter: Intl.Segmenter | undefined;

function getWordSegmenter(): Intl.Segmenter | undefined {
  if (wordSegmenter !== undefined) {
    return wordSegmenter;
  }

  if (typeof Intl.Segmenter !== "function") {
    return undefined;
  }

  wordSegmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
  return wordSegmenter;
}

function pushIfUseful(tokens: string[], value: string): void {
  const token = value.trim();
  if (!token) {
    return;
  }
  if (/^[a-z]$/u.test(token)) {
    return;
  }
  tokens.push(token);
}

/**
 * Splits camel-case identifiers without regular-expression lookbehind.
 * Lookbehind is unavailable on iOS versions before 16.4, while this explicit
 * scan works on every mobile version supported by Obsidian.
 */
function splitCamelCase(value: string): string[] {
  const characters = Array.from(value);
  const parts: string[] = [];
  let partStart = 0;

  for (let index = 1; index < characters.length; index += 1) {
    const previous = characters[index - 1] ?? "";
    const current = characters[index] ?? "";
    const next = characters[index + 1] ?? "";
    const startsWord = LOWERCASE_OR_NUMBER.test(previous) && UPPERCASE.test(current);
    const endsAcronym = UPPERCASE.test(previous) && UPPERCASE.test(current) && LOWERCASE.test(next);
    if (!startsWord && !endsAcronym) {
      continue;
    }
    parts.push(characters.slice(partStart, index).join(""));
    partStart = index;
  }

  parts.push(characters.slice(partStart).join(""));
  return parts;
}

function tokenizeCjkRun(run: string): string[] {
  const tokens: string[] = [];
  const segmenter = getWordSegmenter();

  if (segmenter) {
    for (const segment of segmenter.segment(run)) {
      if (segment.isWordLike !== false) {
        const word = segment.segment;
        pushIfUseful(tokens, word);
        const wordCharacters = Array.from(word);
        if (wordCharacters.length > 2) {
          for (let index = 0; index < wordCharacters.length - 1; index += 1) {
            pushIfUseful(tokens, `${wordCharacters[index]}${wordCharacters[index + 1]}`);
          }
        }
      }
    }
  } else {
    const characters = Array.from(run);
    if (characters.length === 1) {
      pushIfUseful(tokens, run);
    } else {
      for (let index = 0; index < characters.length - 1; index += 1) {
        pushIfUseful(tokens, `${characters[index]}${characters[index + 1]}`);
      }
    }
  }

  return [...new Set(tokens)];
}

function tokenizeTechnicalRun(run: string): string[] {
  const tokens: string[] = [];
  pushIfUseful(tokens, run.toLocaleLowerCase());

  for (const part of run.split(TECHNICAL_SEPARATOR)) {
    pushIfUseful(tokens, part.toLocaleLowerCase());
    for (const camelPart of splitCamelCase(part)) {
      pushIfUseful(tokens, camelPart.toLocaleLowerCase());
    }
  }

  return [...new Set(tokens)];
}

function addTechnicalIdentifier(identifiers: Set<string>, value: string): void {
  const token = value.toLocaleLowerCase().split(TECHNICAL_SEPARATOR).join("");
  if (NATURAL_QUANTITY.test(token)) {
    return;
  }
  if (/[a-z]/iu.test(token) && /\d/u.test(token) && token.length >= 3) {
    identifiers.add(token);
  }
}

/**
 * Tokenizes both Chinese prose and technical identifiers without a dictionary
 * dependency. Intl.Segmenter contributes word candidates while overlapping CJK
 * bigrams provide a deterministic mobile-safe fallback and improve partial match.
 */
export function tokenizeForSearch(input: string): string[] {
  const normalized = input.normalize("NFKC");
  const tokens: string[] = [];

  for (const match of normalized.matchAll(TOKEN_RUN)) {
    const run = match[0];
    if (CJK_RUN.test(run)) {
      tokens.push(...tokenizeCjkRun(run));
    } else {
      tokens.push(...tokenizeTechnicalRun(run));
    }
  }

  return tokens;
}

/**
 * Extracts exact alphanumeric identifiers that should act as retrieval anchors.
 * Compound identifiers also contribute stable atomic parts, while ordinary prose
 * and bare numbers do not. The rule is domain-independent and applies equally to
 * product IDs, document numbers, software versions, standards, and other entities.
 */
export function technicalIdentifierTokens(input: string): string[] {
  const normalized = input.normalize("NFKC");
  const identifiers = new Set<string>();

  for (const token of tokenizeForSearch(normalized)) {
    addTechnicalIdentifier(identifiers, token);
  }
  for (const match of normalized.matchAll(SPACED_IDENTIFIER)) {
    const start = (match.index ?? 0) + (match[0]?.length ?? 0) - (match[2]?.length ?? 0);
    if (NATURAL_QUANTITY.test(normalized.slice(start))) {
      continue;
    }
    addTechnicalIdentifier(identifiers, `${match[1] ?? ""}${match[2] ?? ""}`);
  }
  return [...identifiers];
}

/**
 * Extracts product/document-like identifiers for hard exact-match boundaries.
 * This deliberately leaves the broader technical extractor intact for lexical
 * retrieval, so values such as workout notation can still inform ranking.
 */
export function strictTechnicalIdentifierTokens(input: string): string[] {
  const identifiers = new Set<string>();
  for (const token of tokenizeForSearch(input.normalize("NFKC"))) {
    addTechnicalIdentifier(identifiers, token);
  }
  return [...identifiers].filter((identifier) =>
    /^[a-z]/iu.test(identifier) &&
    (identifier.match(/[a-z]/giu)?.length ?? 0) >= 2 &&
    /\d/u.test(identifier)
  );
}

export function containsCjk(input: string): boolean {
  return CJK_RUN.test(input);
}
