import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "worker", "index.ts");
let s = readFileSync(target, "utf8");

const start = s.indexOf("const achievementSeeds = [");
const end = s.indexOf("\n];\n\nfunction conditioningOrder", start);
if (start === -1 || end === -1) throw new Error("achievementSeeds block not found");
const head = s.slice(0, start);
const block = s.slice(start, end);
const tail = s.slice(end);

const fixedBlock = block.replace(/icon:\s*"[^"]*"/g, 'icon: ""');
writeFileSync(target, head + fixedBlock + tail, "utf8");
console.log("achievementSeeds icons cleared");
