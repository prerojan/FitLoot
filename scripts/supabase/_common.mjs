import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const DEFAULT_TIMEOUT_MS = 30_000;

let cachedPool = null;

function normalizeConnectionUrl(connectionUrl) {
  const parsed = new URL(connectionUrl);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("sslrootcert");
  parsed.searchParams.delete("sslcert");
  parsed.searchParams.delete("sslkey");
  parsed.searchParams.delete("uselibpqcompat");
  return parsed.toString();
}

function quoteIdent(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function quoteQualified(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

export function requireSupabaseEnv() {
  const dbUrl = process.env.SUPABASE_DB_URL ?? null;
  if (!dbUrl) {
    throw new Error(
      "Missing SUPABASE_DB_URL. Provide a Postgres connection string (pooler or direct).",
    );
  }
  return { dbUrl };
}

function getPool() {
  if (cachedPool) return cachedPool;
  const { dbUrl } = requireSupabaseEnv();
  const normalizedUrl = normalizeConnectionUrl(dbUrl);
  cachedPool = new Pool({
    connectionString: normalizedUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    statement_timeout: DEFAULT_TIMEOUT_MS,
    ssl: {
      rejectUnauthorized: false,
    },
  });
  return cachedPool;
}

export async function closePool() {
  if (!cachedPool) return;
  await cachedPool.end();
  cachedPool = null;
}

export async function executeSql(sql, params = []) {
  const pool = getPool();
  return pool.query(sql, params);
}

export async function listAllRows({
  schema,
  table,
  select = "*",
  order = "id.asc",
}) {
  const orderParts = String(order).split(".");
  const orderColumn = orderParts[0] ?? "id";
  const orderDirection =
    (orderParts[1] ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const selectClause = select
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => quoteIdent(value))
    .join(", ");

  const sql = [
    `SELECT ${selectClause || "*"}`,
    `FROM ${quoteQualified(schema, table)}`,
    `ORDER BY ${quoteIdent(orderColumn)} ${orderDirection}`,
  ].join(" ");

  const { rows } = await executeSql(sql);
  return rows;
}

export async function insertRows({
  schema,
  table,
  rows,
}) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  const params = [];
  const valueGroups = rows.map((row, rowIndex) => {
    const placeholders = columns.map((column, columnIndex) => {
      params.push(row[column]);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const sql = [
    `INSERT INTO ${quoteQualified(schema, table)}`,
    `(${columns.map((column) => quoteIdent(column)).join(", ")})`,
    `VALUES ${valueGroups.join(", ")}`,
  ].join(" ");

  await executeSql(sql, params);
}

export async function upsertRows({
  schema,
  table,
  rows,
  onConflict,
}) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const conflictColumns = String(onConflict)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (conflictColumns.length === 0) {
    throw new Error("upsertRows requires a non-empty onConflict column list.");
  }

  const columns = Object.keys(rows[0]);
  const conflictSetColumns = columns.filter(
    (column) => !conflictColumns.includes(column),
  );
  const params = [];
  const valueGroups = rows.map((row, rowIndex) => {
    const placeholders = columns.map((column, columnIndex) => {
      params.push(row[column]);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const onConflictClause = conflictSetColumns.length === 0
    ? "DO NOTHING"
    : `DO UPDATE SET ${conflictSetColumns
      .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
      .join(", ")}`;

  const sql = [
    `INSERT INTO ${quoteQualified(schema, table)}`,
    `(${columns.map((column) => quoteIdent(column)).join(", ")})`,
    `VALUES ${valueGroups.join(", ")}`,
    `ON CONFLICT (${conflictColumns.map((column) => quoteIdent(column)).join(", ")})`,
    onConflictClause,
  ].join(" ");

  await executeSql(sql, params);
}

function parseFilterExpression(column, expression) {
  const normalized = String(expression).trim().toLowerCase();

  if (normalized === "not.is.null") {
    return {
      sql: `${quoteIdent(column)} IS NOT NULL`,
      params: [],
    };
  }

  if (normalized.startsWith("gt.")) {
    return {
      sql: `${quoteIdent(column)} > $1`,
      params: [normalized.slice(3)],
    };
  }

  if (normalized.startsWith("gte.")) {
    return {
      sql: `${quoteIdent(column)} >= $1`,
      params: [normalized.slice(4)],
    };
  }

  if (normalized.startsWith("eq.")) {
    return {
      sql: `${quoteIdent(column)} = $1`,
      params: [normalized.slice(3)],
    };
  }

  throw new Error(`Unsupported filter expression: ${expression}`);
}

export async function deleteRows({
  schema,
  table,
  filter,
}) {
  const conditions = [];
  const params = [];

  for (const [column, expression] of Object.entries(filter ?? {})) {
    const parsed = parseFilterExpression(column, expression);
    let conditionSql = parsed.sql;
    for (let index = 0; index < parsed.params.length; index += 1) {
      const parameterNumber = params.length + index + 1;
      conditionSql = conditionSql.replace(`$${index + 1}`, `$${parameterNumber}`);
    }
    conditions.push(conditionSql);
    params.push(...parsed.params);
  }

  if (conditions.length === 0) {
    throw new Error(`deleteRows requires at least one filter for ${schema}.${table}`);
  }

  const sql = [
    `DELETE FROM ${quoteQualified(schema, table)}`,
    `WHERE ${conditions.join(" AND ")}`,
  ].join(" ");

  await executeSql(sql, params);
}

const KNOWN_MOJIBAKE_REPLACEMENTS = [
  ["\u00c3\u0192\u00c2\u00a3", "Ã£"],
  ["\u00c3\u0192\u00c2\u00b5", "Ãµ"],
  ["\u00c3\u0192\u00c2\u00a1", "Ã¡"],
  ["\u00c3\u0192\u00c2\xa9", "Ã©"],
  ["\u00c3\u0192\u00c2\xad", "Ã­"],
  ["\u00c3\u0192\u00c2\xb3", "Ã³"],
  ["\u00c3\u0192\u00c2\xba", "Ãº"],
  ["\u00c3\u0192\u00c2\xa7", "Ã§"],
  ["\u00c3\u0192\u00c2\xaa", "Ãª"],
  ["\u00c3\u0192\u00c2\xb4", "Ã´"],
  ["\u00c3\u0192\u00c2\xa0", "Ã "],
  ["\u00c3\u0192\u00c2\u00a2", "Ã¢"],
  ["\u00c3\u0192\u00e2\u20ac\xb0", "Ã‰"],
  ["\u00c3\u0192\u00c5\xa1", "Ãš"],
  ["\u00c3\u00a3", "Ã£"],
  ["\u00c3\u00b5", "Ãµ"],
  ["\u00c3\u00a1", "Ã¡"],
  ["\u00c3\u00a9", "Ã©"],
  ["\u00c3\xad", "Ã­"],
  ["\u00c3\xb3", "Ã³"],
  ["\u00c3\xba", "Ãº"],
  ["\u00c3\xa7", "Ã§"],
  ["\u00c3\xaa", "Ãª"],
  ["\u00c3\xb4", "Ã´"],
  ["\u00c3\xa0", "Ã "],
  ["\u00c3\u2030", "Ã‰"],
  ["\u00c3\u0161", "Ãš"],
];

const MOJIBAKE_MARKERS = ["\u00c3", "\u00c2", "\u00e2", "\u0192"];

function latin1ToUtf8(value) {
  const bytes = Uint8Array.from(
    Array.from(value, (char) => char.charCodeAt(0) & 0xff),
  );
  return new TextDecoder("utf-8", {
    fatal: false,
    ignoreBOM: false,
  }).decode(bytes);
}

function mojibakeScore(value) {
  return MOJIBAKE_MARKERS.reduce(
    (total, marker) => total + value.split(marker).length - 1,
    0,
  );
}

function hasMojibakeMarkers(value) {
  return mojibakeScore(value) > 0;
}

function isBetterDecodedCandidate(currentValue, nextValue) {
  if (nextValue.length === 0) return false;
  if (nextValue === currentValue) return false;
  if (nextValue.includes("\ufffd") && !currentValue.includes("\ufffd")) {
    return false;
  }

  const currentScore = mojibakeScore(currentValue);
  const nextScore = mojibakeScore(nextValue);

  if (nextScore < currentScore) return true;
  if (nextScore > currentScore) return false;

  if (currentScore === 0) return false;

  const currentQuestionMarks = (currentValue.match(/\?/g) ?? []).length;
  const nextQuestionMarks = (nextValue.match(/\?/g) ?? []).length;
  return nextQuestionMarks < currentQuestionMarks;
}

export function normalizeText(value) {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;

  let repairedValue = value.trim();
  if (!hasMojibakeMarkers(repairedValue)) {
    return repairedValue.normalize("NFC").trim();
  }

  for (let pass = 0; pass < 12; pass += 1) {
    let nextValue = repairedValue;
    for (const [brokenValue, fixedValue] of KNOWN_MOJIBAKE_REPLACEMENTS) {
      nextValue = nextValue.split(brokenValue).join(fixedValue);
    }
    if (hasMojibakeMarkers(nextValue)) {
      const decodedCandidate = latin1ToUtf8(nextValue);
      if (isBetterDecodedCandidate(nextValue, decodedCandidate)) {
        nextValue = decodedCandidate;
      }
    }

    if (nextValue === repairedValue) break;
    repairedValue = nextValue;
  }

  return repairedValue.normalize("NFC").trim();
}

export function normalizeNullableText(value) {
  if (value === null || value === undefined) return null;
  const normalized = normalizeText(value);
  if (typeof normalized !== "string") return null;
  return normalized.length > 0 ? normalized : null;
}

export function safeInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(numeric);
}

export function generateRequestId(prefix) {
  return `${prefix}-${randomUUID()}`;
}
