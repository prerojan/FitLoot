/**
 * One-off / maintenance: repair double-encoded UTF-8 (mojibake) in a source file.
 * Usage: node scripts/repair-file-mojibake.mjs [path]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const KNOWN_MOJIBAKE_REPLACEMENTS = [
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

const MARKERS = ["\u00c3", "\u00c2", "\u00e2", "\u0192"];

function repairOnce(value) {
  if (!MARKERS.some((m) => value.includes(m))) return value;
  let next = value;
  for (const [broken, fixed] of KNOWN_MOJIBAKE_REPLACEMENTS) {
    next = next.split(broken).join(fixed);
  }
  return next;
}

function repairAll(value) {
  let out = value;
  for (let i = 0; i < 20; i += 1) {
    const next = repairOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

const target = process.argv[2] ? join(root, process.argv[2]) : join(root, "src", "worker", "index.ts");
const raw = readFileSync(target, "utf8");
const fixed = repairAll(raw);
writeFileSync(target, fixed, "utf8");
console.log("repaired:", target, "length", raw.length, "->", fixed.length);
