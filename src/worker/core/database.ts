import type { Context } from "hono";

import { USER_PURGE_TARGETS } from "./constants";
import type { AppContext } from "./types";

let cachedSchemaState: { ready: boolean; checkedAt: number } | null = null;
const SCHEMA_CACHE_TTL_MS = 10_000;
const TABLE_COLUMN_CACHE_TTL_MS = 60_000;
const tableColumnCache = new Map<string, { checkedAt: number; columns: Set<string> }>();

export async function hasCoreSchema(db: D1Database) {
  const now = Date.now();
  if (cachedSchemaState && now - cachedSchemaState.checkedAt < SCHEMA_CACHE_TTL_MS) {
    return cachedSchemaState.ready;
  }

  try {
    const result = await db.prepare(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name IN ('users', 'sessions')`,
    ).first<{ count: number }>();

    const ready = Number(result?.count ?? 0) >= 2;
    cachedSchemaState = { ready, checkedAt: now };
    return ready;
  } catch (error) {
    console.error("[schema-check]", error);
    cachedSchemaState = { ready: false, checkedAt: now };
    return false;
  }
}

export function databaseNotInitializedResponse(c: Context<AppContext>) {
  return c.json(
    {
      error: "Banco local não inicializado. Execute as migrations D1 antes de usar a API.",
      code: "DB_NOT_INITIALIZED",
    },
    503,
  );
}

async function getTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  const cacheKey = tableName.trim().toLowerCase();
  const now = Date.now();
  const cached = tableColumnCache.get(cacheKey);
  if (cached && now - cached.checkedAt < TABLE_COLUMN_CACHE_TTL_MS) {
    return cached.columns;
  }

  const info = await db.prepare(`PRAGMA table_info('${cacheKey}')`).all<{ name: string | null }>();
  const columns = new Set(
    (Array.isArray(info.results) ? info.results : [])
      .map((row) => (typeof row.name === "string" ? row.name.toLowerCase() : ""))
      .filter((value) => value.length > 0),
  );

  tableColumnCache.set(cacheKey, { checkedAt: now, columns });
  return columns;
}

export async function hasTableColumn(db: D1Database, tableName: string, columnName: string): Promise<boolean> {
  const columns = await getTableColumns(db, tableName);
  return columns.has(columnName.trim().toLowerCase());
}

async function deleteUserDataByColumns(
  db: D1Database,
  table: string,
  columns: ReadonlyArray<string>,
  userId: string,
): Promise<void> {
  const availableColumns: string[] = [];

  for (const column of columns) {
    if (await hasTableColumn(db, table, column)) {
      availableColumns.push(column);
    }
  }

  if (availableColumns.length === 0) {
    return;
  }

  const clause = availableColumns.map((column) => `${column} = ?`).join(" OR ");
  const params = availableColumns.map(() => userId);
  await db.prepare(`DELETE FROM ${table} WHERE ${clause}`).bind(...params).run();
}

export async function purgeUserAccountData(db: D1Database, userId: string): Promise<void> {
  for (const target of USER_PURGE_TARGETS) {
    await deleteUserDataByColumns(db, target.table, target.columns, userId);
  }
}
