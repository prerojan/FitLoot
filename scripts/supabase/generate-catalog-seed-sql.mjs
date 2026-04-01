#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  normalizeNullableText,
  normalizeText,
  safeInt,
} from "./_common.mjs";

import {
  PARENT_SKILL_MAP,
  variantSkillSeeds,
} from "../../src/shared/coreSkillSeeds.ts";
import {
  PERFORMANCE_ONLY_LEVEL,
  coreSkillSeeds,
  VARIANT_CATEGORY_BY_PARENT,
} from "../../src/worker/services/gamification/skillSeeds.ts";
import { stageProgressionSeeds } from "../../src/worker/services/gamification/stageProgressionSeeds.ts";
import { titleSeeds } from "../../src/worker/services/gamification/titleSeeds.ts";
import { achievementSeeds } from "../../src/worker/services/gamification/achievementSeeds.ts";

function catalogLookupKey(value) {
  const normalized = normalizeText(value);
  if (typeof normalized !== "string") return "";
  return normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const asString = String(value).replaceAll("'", "''");
  return `'${asString}'`;
}

function buildSkillRows() {
  const coreRows = coreSkillSeeds.map((skill) => ({
    name: normalizeText(skill.name),
    category: normalizeText(skill.category),
    difficulty: normalizeText(skill.difficulty),
    description: normalizeNullableText(skill.description),
    calories_per_rep: 0.5,
    strength_gain: 1,
    constitution_gain: 1,
    vitality_gain: 1,
    dexterity_gain: 1,
    focus_gain: 1,
    required_level: safeInt(skill.requiredLevel, 1),
    tier: normalizeText(skill.tier),
    level_required: safeInt(skill.requiredLevel, 1),
    prerequisites: JSON.stringify(
      Array.isArray(skill.prerequisites)
        ? skill.prerequisites.map((item) => normalizeText(item))
        : [],
    ),
    attribute_requirements: JSON.stringify(skill.attributeRequirements ?? {}),
    unlock_message: normalizeNullableText(skill.unlockMessage),
  }));

  const variantRows = variantSkillSeeds.map((seed) => {
    const parentKey = catalogLookupKey(seed.parentSkill);
    const parentName = normalizeText(
      PARENT_SKILL_MAP[seed.parentSkill] ?? seed.parentSkill,
    );
    const variantName = normalizeText(seed.namePt);
    return {
      name: variantName,
      category: normalizeText(VARIANT_CATEGORY_BY_PARENT[parentKey] ?? "core"),
      difficulty: "intermediario",
      description: normalizeText(`Variante de ${parentName}`),
      calories_per_rep: 0.5,
      strength_gain: 1,
      constitution_gain: 1,
      vitality_gain: 1,
      dexterity_gain: 1,
      focus_gain: 1,
      required_level: PERFORMANCE_ONLY_LEVEL,
      tier: "intermediario",
      level_required: PERFORMANCE_ONLY_LEVEL,
      prerequisites: JSON.stringify([parentName]),
      attribute_requirements: "{}",
      unlock_message: normalizeText(`${variantName} desbloqueada(o).`),
    };
  });

  const dedup = new Map();
  for (const row of [...coreRows, ...variantRows]) {
    dedup.set(catalogLookupKey(row.name), row);
  }
  return Array.from(dedup.values());
}

function buildTitleRows() {
  return titleSeeds.map((title) => ({
    name: normalizeText(title.name),
    rarity: normalizeText(title.rarity),
    requirement_type: "event",
    requirement_value: 1,
    description: normalizeNullableText(title.description),
    reference: normalizeNullableText(title.reference),
    unlock_condition: normalizeNullableText(title.unlock_condition),
    xp_reward: Math.max(0, safeInt(title.xp_reward, 0)),
    points_reward: Math.max(0, safeInt(title.points_reward, 0)),
  }));
}

function buildAchievementRows() {
  return achievementSeeds.map((achievement) => ({
    name: normalizeText(achievement.name),
    description: normalizeNullableText(achievement.description),
    rarity: normalizeText(achievement.rarity),
    icon: normalizeNullableText(achievement.icon),
    requirement_type: "event",
    requirement_value: 1,
    category: normalizeText(achievement.category ?? "geral"),
    color: normalizeText(achievement.color ?? "#9CA3AF"),
    secret: safeInt(achievement.secret, 0) === 1 ? 1 : 0,
    condition: normalizeNullableText(achievement.condition),
    reference: normalizeNullableText(achievement.reference),
    xp_reward: Math.max(0, safeInt(achievement.xp_reward, 50)),
    points_reward: Math.max(0, safeInt(achievement.points_reward, 0)),
  }));
}

function buildInsertSql(tableName, rows) {
  if (rows.length === 0) return `-- no rows for ${tableName}`;
  const columns = Object.keys(rows[0]);
  const columnSql = columns.map((column) => `"${column}"`).join(", ");
  const valuesSql = rows
    .map((row) => {
      const values = columns.map((column) => sqlLiteral(row[column]));
      return `(${values.join(", ")})`;
    })
    .join(",\n");
  return [
    `INSERT INTO ${tableName} (${columnSql})`,
    `VALUES`,
    valuesSql,
    ";",
  ].join("\n");
}

function buildStageInsertSql(stageRows) {
  if (stageRows.length === 0) return "-- no skill stages";
  const valuesSql = stageRows
    .map((stage) => {
      return [
        "(",
        `(SELECT id FROM catalog.skills WHERE name = ${sqlLiteral(stage.skillName)} LIMIT 1),`,
        `${sqlLiteral(safeInt(stage.stageNumber, 1))},`,
        `${sqlLiteral(normalizeText(stage.name))},`,
        `${sqlLiteral(normalizeNullableText(stage.description))},`,
        `${sqlLiteral(safeInt(stage.levelRequired, 1))},`,
        `${sqlLiteral(normalizeNullableText(stage.exerciseReference))}`,
        ")",
      ].join(" ");
    })
    .join(",\n");

  return [
    "INSERT INTO catalog.skill_stages (",
    '  "skill_id", "stage_number", "name", "description", "level_required", "exercise_reference"',
    ")",
    "VALUES",
    valuesSql,
    ";",
  ].join("\n");
}

function buildSqlDocument() {
  const skills = buildSkillRows();
  const titles = buildTitleRows();
  const achievements = buildAchievementRows();

  return [
    "-- Generated by scripts/supabase/generate-catalog-seed-sql.mjs",
    "BEGIN;",
    "",
    "DELETE FROM catalog.skill_stages;",
    "DELETE FROM catalog.titles;",
    "DELETE FROM catalog.achievements;",
    "DELETE FROM catalog.skills;",
    "",
    buildInsertSql("catalog.skills", skills),
    "",
    buildStageInsertSql(stageProgressionSeeds),
    "",
    buildInsertSql("catalog.titles", titles),
    "",
    buildInsertSql("catalog.achievements", achievements),
    "",
    "COMMIT;",
    "",
  ].join("\n");
}

async function run() {
  const destinationArg = process.argv[2] ?? "supabase/seeds/catalog_seed.sql";
  const destination = resolve(process.cwd(), destinationArg);
  const sql = buildSqlDocument();
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, sql, "utf8");
  console.log(`[supabase][generate-catalog-seed-sql] wrote ${destination}`);
}

run().catch((error) => {
  console.error("[supabase][generate-catalog-seed-sql][failed]", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
