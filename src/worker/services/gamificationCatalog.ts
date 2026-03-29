import type { ConditioningLevel } from "../../shared/types";
import {
  repairKnownMojibake,
  repairKnownMojibakeString,
} from "../../shared/textEncoding";
import {
  PARENT_SKILL_MAP,
  variantSkillSeeds,
} from "../../shared/coreSkillSeeds";
import type { SkillSeed, SkillStageSeed } from "../core/types";
import { achievementSeeds } from "./gamification/achievementSeeds";
import {
  PERFORMANCE_ONLY_LEVEL,
  coreSkillSeeds,
  VARIANT_CATEGORY_BY_PARENT,
} from "./gamification/skillSeeds";
import { stageProgressionSeeds } from "./gamification/stageProgressionSeeds";
import { titleSeeds } from "./gamification/titleSeeds";
import type {
  AchievementSeed,
  TitleSeed,
} from "./gamification/types";

type NamedCatalogRow = {
  id: number;
  name: string;
};

export function conditioningOrder(level: ConditioningLevel): number {
  return { sedentario: 0, iniciante: 1, intermediario: 2, avancado: 3 }[
    level
  ] ?? 0;
}

export function skillTierOrder(tier: string): number {
  return {
    iniciante: 1,
    intermediario: 2,
    avancado: 3,
    calistenico: 4,
  }[tier as keyof Record<string, number>] ?? 1;
}

function catalogLookupKey(value: string): string {
  return repairKnownMojibakeString(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function buildNamedCatalogIndex(
  rows: readonly NamedCatalogRow[],
): Map<string, NamedCatalogRow[]> {
  const index = new Map<string, NamedCatalogRow[]>();
  for (const row of rows) {
    const key = catalogLookupKey(row.name);
    const current = index.get(key) ?? [];
    current.push(row);
    index.set(key, current);
  }
  return index;
}

function rememberNamedRow(
  index: Map<string, NamedCatalogRow[]>,
  row: NamedCatalogRow,
): void {
  const key = catalogLookupKey(row.name);
  const current = index.get(key) ?? [];
  current.push(row);
  index.set(key, current);
}

async function loadNamedCatalogRows(
  db: D1Database,
  tableName: "skills" | "titles" | "achievements",
): Promise<NamedCatalogRow[]> {
  const rows = await db
    .prepare(`SELECT id, name FROM ${tableName}`)
    .all<NamedCatalogRow>();
  return Array.isArray(rows.results) ? rows.results : [];
}

async function upsertSkillSeed(
  db: D1Database,
  skillRowsByKey: Map<string, NamedCatalogRow[]>,
  skill: SkillSeed,
): Promise<void> {
  const existing = skillRowsByKey.get(catalogLookupKey(skill.name))?.[0] ?? null;
  const bindings = [
    skill.name,
    skill.category,
    skill.difficulty,
    skill.description,
    0.5,
    1,
    1,
    1,
    1,
    1,
    skill.requiredLevel,
    skill.tier,
    skill.requiredLevel,
    JSON.stringify(skill.prerequisites ?? []),
    JSON.stringify(skill.attributeRequirements ?? {}),
    skill.unlockMessage,
  ];

  if (existing) {
    await db
      .prepare(
        `UPDATE skills
            SET name = ?,
                category = ?,
                difficulty = ?,
                description = ?,
                calories_per_rep = ?,
                strength_gain = ?,
                constitution_gain = ?,
                vitality_gain = ?,
                dexterity_gain = ?,
                focus_gain = ?,
                required_level = ?,
                tier = ?,
                level_required = ?,
                prerequisites = ?,
                attribute_requirements = ?,
                unlock_message = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(...bindings, existing.id)
      .run();
    return;
  }

  const result = await db
    .prepare(
      `INSERT INTO skills (
        name,
        category,
        difficulty,
        description,
        calories_per_rep,
        strength_gain,
        constitution_gain,
        vitality_gain,
        dexterity_gain,
        focus_gain,
        required_level,
        tier,
        level_required,
        prerequisites,
        attribute_requirements,
        unlock_message,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(...bindings)
    .run();

  const insertedId = Number(result.meta.last_row_id ?? 0);
  if (insertedId > 0) {
    rememberNamedRow(skillRowsByKey, { id: insertedId, name: skill.name });
  }
}

async function upsertTitleSeed(
  db: D1Database,
  titleRowsByKey: Map<string, NamedCatalogRow[]>,
  title: TitleSeed,
): Promise<void> {
  const existing = titleRowsByKey.get(catalogLookupKey(title.name))?.[0] ?? null;
  const bindings = [
    title.name,
    title.rarity,
    "event",
    1,
    title.description,
    title.reference,
    title.unlock_condition,
  ];

  if (existing) {
    await db
      .prepare(
        `UPDATE titles
            SET name = ?,
                rarity = ?,
                requirement_type = ?,
                requirement_value = ?,
                description = ?,
                reference = ?,
                unlock_condition = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(...bindings, existing.id)
      .run();
    return;
  }

  const result = await db
    .prepare(
      `INSERT INTO titles (
        name,
        rarity,
        requirement_type,
        requirement_value,
        description,
        reference,
        unlock_condition,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(...bindings)
    .run();

  const insertedId = Number(result.meta.last_row_id ?? 0);
  if (insertedId > 0) {
    rememberNamedRow(titleRowsByKey, { id: insertedId, name: title.name });
  }
}

async function upsertAchievementSeed(
  db: D1Database,
  achievementRowsByKey: Map<string, NamedCatalogRow[]>,
  achievement: AchievementSeed,
): Promise<void> {
  const existing =
    achievementRowsByKey.get(catalogLookupKey(achievement.name))?.[0] ?? null;
  const bindings = [
    achievement.name,
    achievement.description,
    achievement.rarity,
    achievement.icon,
    "event",
    1,
    achievement.category,
    achievement.color,
    achievement.secret,
    achievement.condition,
    achievement.reference,
  ];

  if (existing) {
    await db
      .prepare(
        `UPDATE achievements
            SET name = ?,
                description = ?,
                rarity = ?,
                icon = ?,
                requirement_type = ?,
                requirement_value = ?,
                category = ?,
                color = ?,
                secret = ?,
                condition = ?,
                reference = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(...bindings, existing.id)
      .run();
    return;
  }

  const result = await db
    .prepare(
      `INSERT INTO achievements (
        name,
        description,
        rarity,
        icon,
        requirement_type,
        requirement_value,
        category,
        color,
        secret,
        condition,
        reference,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(...bindings)
    .run();

  const insertedId = Number(result.meta.last_row_id ?? 0);
  if (insertedId > 0) {
    rememberNamedRow(achievementRowsByKey, {
      id: insertedId,
      name: achievement.name,
    });
  }
}

async function upsertSkillStageSeed(
  db: D1Database,
  stage: SkillStageSeed,
  skillIdByKey: Map<string, number>,
): Promise<void> {
  const skillId = skillIdByKey.get(catalogLookupKey(stage.skillName));
  if (!skillId) return;

  const existing = await db
    .prepare(
      `SELECT id
         FROM skill_stages
        WHERE skill_id = ? AND stage_number = ?
        LIMIT 1`,
    )
    .bind(skillId, stage.stageNumber)
    .first<{ id: number }>();

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE skill_stages
            SET name = ?,
                description = ?,
                level_required = ?,
                exercise_reference = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(
        repairKnownMojibakeString(stage.name),
        repairKnownMojibakeString(stage.description),
        stage.levelRequired,
        repairKnownMojibakeString(stage.exerciseReference),
        existing.id,
      )
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO skill_stages (
        skill_id,
        stage_number,
        name,
        description,
        level_required,
        exercise_reference,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(
      skillId,
      stage.stageNumber,
      repairKnownMojibakeString(stage.name),
      repairKnownMojibakeString(stage.description),
      stage.levelRequired,
      repairKnownMojibakeString(stage.exerciseReference),
    )
    .run();
}

export async function ensureGamificationCatalog(db: D1Database): Promise<void> {
  const [existingSkills, existingTitles, existingAchievements] =
    await Promise.all([
      loadNamedCatalogRows(db, "skills"),
      loadNamedCatalogRows(db, "titles"),
      loadNamedCatalogRows(db, "achievements"),
    ]);

  const skillRowsByKey = buildNamedCatalogIndex(existingSkills);
  const titleRowsByKey = buildNamedCatalogIndex(existingTitles);
  const achievementRowsByKey = buildNamedCatalogIndex(existingAchievements);

  for (const skill of coreSkillSeeds) {
    await upsertSkillSeed(db, skillRowsByKey, {
      ...skill,
      name: repairKnownMojibakeString(skill.name),
      category: repairKnownMojibakeString(skill.category),
      difficulty: repairKnownMojibakeString(skill.difficulty),
      description: repairKnownMojibakeString(skill.description),
      unlockMessage: repairKnownMojibakeString(skill.unlockMessage),
      prerequisites: skill.prerequisites?.map((value) =>
        repairKnownMojibakeString(value),
      ),
    });
  }

  for (const variantSeed of variantSkillSeeds) {
    const parentKey = catalogLookupKey(variantSeed.parentSkill);
    const parentName = repairKnownMojibakeString(
      PARENT_SKILL_MAP[variantSeed.parentSkill] ?? variantSeed.parentSkill,
    );
    const category = VARIANT_CATEGORY_BY_PARENT[parentKey] ?? "core";
    await upsertSkillSeed(db, skillRowsByKey, {
      name: repairKnownMojibakeString(variantSeed.namePt),
      category,
      difficulty: "intermediario",
      tier: "intermediario",
      requiredLevel: PERFORMANCE_ONLY_LEVEL,
      description: `Variante de ${parentName}`,
      unlockMessage: `${repairKnownMojibakeString(
        variantSeed.namePt,
      )} desbloqueada(o).`,
      prerequisites: [parentName],
      attributeRequirements: {},
    });
  }

  const refreshedSkills = await loadNamedCatalogRows(db, "skills");
  const skillIdByKey = new Map<string, number>();
  for (const row of refreshedSkills) {
    if (!skillIdByKey.has(catalogLookupKey(row.name))) {
      skillIdByKey.set(catalogLookupKey(row.name), row.id);
    }
  }

  for (const stage of stageProgressionSeeds) {
    await upsertSkillStageSeed(db, stage, skillIdByKey);
  }

  for (const achievement of achievementSeeds) {
    await upsertAchievementSeed(db, achievementRowsByKey, {
      ...achievement,
      name: repairKnownMojibakeString(achievement.name),
      description: repairKnownMojibakeString(achievement.description),
      rarity: repairKnownMojibakeString(achievement.rarity),
      reference:
        repairKnownMojibake(achievement.reference) ?? achievement.reference,
    });
  }

  for (const title of titleSeeds) {
    await upsertTitleSeed(db, titleRowsByKey, {
      ...title,
      name: repairKnownMojibakeString(title.name),
      description: repairKnownMojibakeString(title.description),
      rarity: repairKnownMojibakeString(title.rarity),
      reference: repairKnownMojibake(title.reference) ?? title.reference,
    });
  }
}

export async function ensureCaminhadaLeveUserSkill(
  db: D1Database,
  userId: string,
): Promise<void> {
  const skill = await db
    .prepare("SELECT id FROM skills WHERE name = ?")
    .bind("Caminhada leve")
    .first<{ id: number }>();
  if (!skill?.id) return;

  await db
    .prepare(
      `INSERT OR IGNORE INTO user_skills (
        user_id,
        skill_id,
        status,
        current_stage,
        total_reps,
        total_time,
        best_reps,
        unlocked_at,
        updated_at
      ) VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`,
    )
    .bind(userId, skill.id)
    .run();
}
