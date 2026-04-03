#!/usr/bin/env node
import {
  closePool,
  executeSql,
  quoteIdent,
  quoteQualified,
  tableExists,
} from "./_common.mjs";

const CANDIDATE_TABLES = [
  { schema: "core", table: "user_sessions" },
  { schema: "core", table: "magic_link_tokens" },
];

function requireLegacySuffix() {
  const suffix = (process.env.SUPABASE_LEGACY_SUFFIX ?? "").trim();
  if (!suffix) {
    throw new Error(
      "Missing SUPABASE_LEGACY_SUFFIX. Example: SUPABASE_LEGACY_SUFFIX=20260402 npm run supabase:restore-quarantine",
    );
  }
  return suffix;
}

async function viewExists(schema, viewName) {
  const { rows } = await executeSql(
    `SELECT 1
       FROM information_schema.views
      WHERE table_schema = $1
        AND table_name = $2
      LIMIT 1`,
    [schema, viewName],
  );
  return rows.length > 0;
}

async function run() {
  const suffix = requireLegacySuffix();

  for (const { schema, table } of CANDIDATE_TABLES) {
    const legacyTable = `${table}__legacy_${suffix}`;
    const hasLegacy = await tableExists(schema, legacyTable);
    if (!hasLegacy) {
      console.log(`[supabase][restore] skip missing legacy table ${schema}.${legacyTable}`);
      continue;
    }

    const hasView = await viewExists(schema, table);
    if (hasView) {
      await executeSql(`DROP VIEW ${quoteQualified(schema, table)}`);
    }

    const hasCurrentTable = await tableExists(schema, table);
    if (hasCurrentTable) {
      throw new Error(
        `Restore blocked: table ${schema}.${table} already exists as real table.`,
      );
    }

    await executeSql(
      `ALTER TABLE ${quoteQualified(schema, legacyTable)} RENAME TO ${quoteIdent(table)}`,
    );
    console.log(`[supabase][restore] restored ${schema}.${table} from ${schema}.${legacyTable}`);
  }

  console.log("[supabase][restore] complete.");
}

run()
  .catch((error) => {
    console.error("[supabase][restore][failed]", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });

