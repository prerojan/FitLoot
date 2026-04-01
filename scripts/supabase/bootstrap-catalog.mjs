#!/usr/bin/env node
import {
  closePool,
  deleteRows,
  insertRows,
  listAllRows,
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
    attribute_requirements: JSON.stringify(
      skill.attributeRequirements ?? {},
    ),
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

async function deleteCatalogData() {
  await deleteRows({
    schema: "catalog",
    table: "skill_stages",
    filter: { id: "gt.0" },
  });
  await deleteRows({
    schema: "catalog",
    table: "titles",
    filter: { id: "gt.0" },
  });
  await deleteRows({
    schema: "catalog",
    table: "achievements",
    filter: { id: "gt.0" },
  });
  await deleteRows({
    schema: "catalog",
    table: "skills",
    filter: { id: "gt.0" },
  });
}

async function seedSkillStages() {
  const skillRows = await listAllRows({
    schema: "catalog",
    table: "skills",
    select: "id,name",
  });

  const skillIdByKey = new Map();
  for (const skill of skillRows) {
    const key = catalogLookupKey(skill.name);
    if (!skillIdByKey.has(key)) {
      skillIdByKey.set(key, skill.id);
    }
  }

  const stageRows = [];
  for (const stage of stageProgressionSeeds) {
    const skillId = skillIdByKey.get(catalogLookupKey(stage.skillName));
    if (!skillId) continue;
    stageRows.push({
      skill_id: skillId,
      stage_number: safeInt(stage.stageNumber, 1),
      name: normalizeText(stage.name),
      description: normalizeNullableText(stage.description),
      level_required: safeInt(stage.levelRequired, 1),
      exercise_reference: normalizeNullableText(stage.exerciseReference),
    });
  }

  await insertRows({
    schema: "catalog",
    table: "skill_stages",
    rows: stageRows,
  });

  return stageRows.length;
}

async function run() {
  console.log("[supabase][bootstrap-catalog] resetting catalog tables...");
  await deleteCatalogData();

  const skills = buildSkillRows();
  const titles = buildTitleRows();
  const achievements = buildAchievementRows();

  console.log(
    `[supabase][bootstrap-catalog] inserting skills=${skills.length}, titles=${titles.length}, achievements=${achievements.length}`,
  );
  await insertRows({
    schema: "catalog",
    table: "skills",
    rows: skills,
  });
  const stageCount = await seedSkillStages();
  await insertRows({
    schema: "catalog",
    table: "titles",
    rows: titles,
  });
  await insertRows({
    schema: "catalog",
    table: "achievements",
    rows: achievements,
  });

  console.log(
    `[supabase][bootstrap-catalog] done. skill_stages=${stageCount}`,
  );
}

run().catch((error) => {
  console.error("[supabase][bootstrap-catalog][failed]", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}).finally(async () => {
  await closePool();
});
