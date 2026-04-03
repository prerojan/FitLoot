#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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

function buildStamp() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function snapshotTable(schema, table, snapshotDir) {
  const query = `SELECT * FROM ${quoteQualified(schema, table)}`;
  const { rows } = await executeSql(query);
  const snapshotPath = path.join(snapshotDir, `${schema}.${table}.json`);
  await writeFile(snapshotPath, JSON.stringify(rows, null, 2), "utf8");
  return rows.length;
}

async function run() {
  const stamp = buildStamp();
  const snapshotDir = path.resolve(process.cwd(), "scripts", "supabase", "snapshots", stamp);
  await mkdir(snapshotDir, { recursive: true });

  console.log(`[supabase][quarantine] snapshot dir: ${snapshotDir}`);

  for (const { schema, table } of CANDIDATE_TABLES) {
    const exists = await tableExists(schema, table);
    if (!exists) {
      console.log(`[supabase][quarantine] skip missing table ${schema}.${table}`);
      continue;
    }

    const legacyTable = `${table}__legacy_${stamp}`;
    const legacyExists = await tableExists(schema, legacyTable);
    if (legacyExists) {
      console.log(`[supabase][quarantine] legacy already exists, skip ${schema}.${legacyTable}`);
      continue;
    }

    const rowCount = await snapshotTable(schema, table, snapshotDir);
    console.log(`[supabase][quarantine] snapshot ${schema}.${table} rows=${rowCount}`);

    await executeSql(
      `ALTER TABLE ${quoteQualified(schema, table)} RENAME TO ${quoteIdent(legacyTable)}`,
    );
    await executeSql(
      `CREATE VIEW ${quoteQualified(schema, table)} AS
       SELECT * FROM ${quoteQualified(schema, legacyTable)}`,
    );

    console.log(
      `[supabase][quarantine] moved ${schema}.${table} -> ${schema}.${legacyTable} and created compatibility view`,
    );
  }

  console.log(
    `[supabase][quarantine] complete. Use SUPABASE_LEGACY_SUFFIX=${stamp} for restore/drop scripts.`,
  );
}

run()
  .catch((error) => {
    console.error("[supabase][quarantine][failed]", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });

