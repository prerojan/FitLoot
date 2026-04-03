#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  closePool,
  executeSql,
  normalizeNullableText,
  normalizeText,
  safeInt,
} from "./_common.mjs";

const execFileAsync = promisify(execFile);
const WRANGLER_CLI = path.resolve(
  process.cwd(),
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

function parseArgs(argv) {
  const args = {
    d1Database: process.env.D1_DATABASE_NAME ?? "fitloot-db",
    sourceJsonPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--d1-database") {
      args.d1Database = argv[index + 1] ?? args.d1Database;
      index += 1;
      continue;
    }
    if (token === "--source-json") {
      args.sourceJsonPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
  }

  return args;
}

function extractRowsFromWranglerJson(rawOutput) {
  const parsed = JSON.parse(rawOutput);

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (Array.isArray(entry?.results)) {
        return entry.results;
      }
      if (Array.isArray(entry?.result?.[0]?.results)) {
        return entry.result[0].results;
      }
    }
  }

  if (Array.isArray(parsed?.result?.[0]?.results)) {
    return parsed.result[0].results;
  }

  if (Array.isArray(parsed?.results)) {
    return parsed.results;
  }

  return [];
}

async function loadPromoCodesFromD1(d1Database) {
  const query = [
    "SELECT",
    "  code,",
    "  description,",
    "  effect,",
    "  effect_value,",
    "  max_uses,",
    "  uses_count,",
    "  active,",
    "  expires_at",
    "FROM promo_codes",
    "ORDER BY code ASC",
  ].join(" ");

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      WRANGLER_CLI,
      "d1",
      "execute",
      d1Database,
      "--remote",
      "--command",
      query,
      "--json",
    ],
    {
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return extractRowsFromWranglerJson(stdout);
}

function sanitizePromoCodeRows(rows) {
  const dedup = new Map();

  for (const row of rows) {
    const normalizedCode = normalizeText(row.code).toUpperCase();
    dedup.set(normalizedCode, {
      code: normalizedCode,
      description: normalizeText(row.description),
      effect: normalizeText(row.effect),
      effect_value: normalizeNullableText(row.effect_value),
      max_uses:
        row.max_uses === null || row.max_uses === undefined
          ? null
          : safeInt(row.max_uses, 0),
      uses_count: Math.max(0, safeInt(row.uses_count, 0)),
      active: safeInt(row.active, 0) === 1 ? 1 : 0,
      expires_at: normalizeNullableText(row.expires_at),
    });
  }

  return Array.from(dedup.values());
}

async function loadPromoCodesFromJson(pathname) {
  const raw = await readFile(pathname, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON source must be an array of promo code records.");
  }
  return parsed;
}

async function run() {
  const { d1Database, sourceJsonPath } = parseArgs(process.argv.slice(2));
  console.log(
    `[supabase][promo-codes] loading source (${sourceJsonPath ? "json" : "d1"})...`,
  );

  const rawRows = sourceJsonPath
    ? await loadPromoCodesFromJson(sourceJsonPath)
    : await loadPromoCodesFromD1(d1Database);

  const rows = sanitizePromoCodeRows(rawRows);
  console.log(`[supabase][promo-codes] upserting ${rows.length} promo codes...`);
  for (const row of rows) {
    await executeSql(
      `DELETE FROM catalog.promo_codes
        WHERE lower(code) = lower($1)`,
      [row.code],
    );

    await executeSql(
      `INSERT INTO catalog.promo_codes (
        code,
        description,
        effect,
        effect_value,
        max_uses,
        uses_count,
        active,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (code) DO UPDATE SET
        description = EXCLUDED.description,
        effect = EXCLUDED.effect,
        effect_value = EXCLUDED.effect_value,
        max_uses = EXCLUDED.max_uses,
        uses_count = EXCLUDED.uses_count,
        active = EXCLUDED.active,
        expires_at = EXCLUDED.expires_at`,
      [
        row.code,
        row.description,
        row.effect,
        row.effect_value,
        row.max_uses,
        row.uses_count,
        row.active,
        row.expires_at,
      ],
    );
  }

  console.log("[supabase][promo-codes] done.");
}

run().catch((error) => {
  console.error("[supabase][promo-codes][failed]", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}).finally(async () => {
  await closePool();
});
