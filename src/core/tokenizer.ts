const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/u;
const TOKEN_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}][\p{L}\p{N}_./#+:-]*/gu;
const TECHNICAL_SEPARATOR = /[._/#+:-]+/u;
const CAMEL_BOUNDARY = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/gu;

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
    for (const camelPart of part.split(CAMEL_BOUNDARY)) {
      pushIfUseful(tokens, camelPart.toLocaleLowerCase());
    }
  }

  return [...new Set(tokens)];
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
 * Compound identifiers still contribute their stable atomic parts: for example,
 * `MS6-ND` contributes `ms6`, while ordinary prose and bare numbers do not.
 */
export function technicalIdentifierTokens(input: string): string[] {
  return [...new Set(tokenizeForSearch(input)
    .map((token) => token.toLocaleLowerCase())
    .filter((token) =>
      !TECHNICAL_SEPARATOR.test(token) &&
      /[a-z]/iu.test(token) &&
      /\d/u.test(token) &&
      token.length >= 3
    ))];
}

export function containsCjk(input: string): boolean {
  return CJK_RUN.test(input);
}
