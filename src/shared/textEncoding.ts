const KNOWN_MOJIBAKE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["\u00c3\u0192\u00c2\u00a3", "ã"],
  ["\u00c3\u0192\u00c2\u00b5", "õ"],
  ["\u00c3\u0192\u00c2\u00a1", "á"],
  ["\u00c3\u0192\u00c2\xa9", "é"],
  ["\u00c3\u0192\u00c2\xad", "í"],
  ["\u00c3\u0192\u00c2\xb3", "ó"],
  ["\u00c3\u0192\u00c2\xba", "ú"],
  ["\u00c3\u0192\u00c2\xa7", "ç"],
  ["\u00c3\u0192\u00c2\xaa", "ê"],
  ["\u00c3\u0192\u00c2\xb4", "ô"],
  ["\u00c3\u0192\u00c2\xa0", "à"],
  ["\u00c3\u0192\u00c2\u00a2", "â"],
  ["\u00c3\u0192\u00e2\u20ac\xb0", "É"],
  ["\u00c3\u0192\u00c5\xa1", "Ú"],
  ["\u00c3\u00a3", "ã"],
  ["\u00c3\u00b5", "õ"],
  ["\u00c3\u00a1", "á"],
  ["\u00c3\u00a9", "é"],
  ["\u00c3\xad", "í"],
  ["\u00c3\xb3", "ó"],
  ["\u00c3\xba", "ú"],
  ["\u00c3\xa7", "ç"],
  ["\u00c3\xaa", "ê"],
  ["\u00c3\xb4", "ô"],
  ["\u00c3\xa0", "à"],
  ["\u00c3\u2030", "É"],
  ["\u00c3\u0161", "Ú"],
];

const MOJIBAKE_MARKERS = [
  "\u00c3",
  "\u00c2",
  "\u00e2",
  "\u0192",
];

function latin1ToUtf8(value: string): string {
  const bytes = Uint8Array.from(
    Array.from(value, (char) => char.charCodeAt(0) & 0xff),
  );
  return new TextDecoder("utf-8", {
    fatal: false,
    ignoreBOM: false,
  }).decode(bytes);
}

function mojibakeScore(value: string): number {
  return MOJIBAKE_MARKERS.reduce(
    (total, marker) => total + value.split(marker).length - 1,
    0,
  );
}

function isBetterDecodedCandidate(
  currentValue: string,
  nextValue: string,
): boolean {
  if (nextValue.length === 0) return false;
  if (nextValue === currentValue) return false;
  if (nextValue.includes("\ufffd") && !currentValue.includes("\ufffd")) {
    return false;
  }

  const currentScore = mojibakeScore(currentValue);
  const nextScore = mojibakeScore(nextValue);

  if (nextScore < currentScore) return true;
  if (nextScore > currentScore) return false;

  return nextValue !== currentValue;
}

export function repairKnownMojibake(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  let repairedValue = value;

  for (let pass = 0; pass < 12; pass += 1) {
    if (!MOJIBAKE_MARKERS.some((marker) => repairedValue.includes(marker))) {
      break;
    }

    let nextValue = repairedValue;

    for (const [brokenValue, fixedValue] of KNOWN_MOJIBAKE_REPLACEMENTS) {
      nextValue = nextValue.split(brokenValue).join(fixedValue);
    }

    if (nextValue === repairedValue) {
      break;
    }

    repairedValue = nextValue;

    if (MOJIBAKE_MARKERS.some((marker) => repairedValue.includes(marker))) {
      const decodedCandidate = latin1ToUtf8(repairedValue);
      if (isBetterDecodedCandidate(repairedValue, decodedCandidate)) {
        repairedValue = decodedCandidate;
      }
    }
  }

  return repairedValue;
}

export function repairKnownMojibakeString(value: string): string {
  return repairKnownMojibake(value) ?? value;
}
