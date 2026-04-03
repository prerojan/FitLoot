#!/usr/bin/env node
import {
  closePool,
  executeSql,
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
      "Missing SUPABASE_LEGACY_SUFFIX. Example: SUPABASE_LEGACY_SUFFIX=20260402 npm run supabase:drop-quarantine",
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

    const hasView = await viewExists(schema, table);
    if (hasView) {
      await executeSql(`DROP VIEW ${quoteQualified(schema, table)}`);
      console.log(`[supabase][drop] dropped compatibility view ${schema}.${table}`);
    }

    const hasLegacy = await tableExists(schema, legacyTable);
    if (!hasLegacy) {
      console.log(`[supabase][drop] skip missing legacy table ${schema}.${legacyTable}`);
      continue;
    }

    await executeSql(`DROP TABLE ${quoteQualified(schema, legacyTable)}`);
    console.log(`[supabase][drop] dropped ${schema}.${legacyTable}`);
  }

  console.log("[supabase][drop] complete.");
}

run()
  .catch((error) => {
    console.error("[supabase][drop][failed]", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });

