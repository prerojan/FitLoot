import type { MissionMetricType } from "../../shared/types";

export type MissionAttributeDelta = {
  strength: number;
  constitution: number;
  vitality: number;
  dexterity: number;
  focus: number;
};

type MissionProgressionDeps = {
  ensureUserAttributesRow: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
};

function emptyMissionAttributeDelta(): MissionAttributeDelta {
  return { strength: 0, constitution: 0, vitality: 0, dexterity: 0, focus: 0 };
}

function scaleMissionAttributeDelta(
  delta: MissionAttributeDelta,
  factor: number,
): MissionAttributeDelta {
  const normalizedFactor = Math.max(0, Math.min(3, Math.floor(factor)));
  if (normalizedFactor <= 0) return emptyMissionAttributeDelta();
  return {
    strength: delta.strength * normalizedFactor,
    constitution: delta.constitution * normalizedFactor,
    vitality: delta.vitality * normalizedFactor,
    dexterity: delta.dexterity * normalizedFactor,
    focus: delta.focus * normalizedFactor,
  };
}

// Ganhos base por categoria de exercício da missão (quando não há skill ou skill sem gains).
function baseMissionAttributeDeltaForExerciseCategory(
  category: string,
): MissionAttributeDelta {
  const normalizedCategory = String(category || "default").toLowerCase();
  switch (normalizedCategory) {
    case "plank":
    case "isometric":
      return {
        strength: 0,
        constitution: 1,
        vitality: 0,
        dexterity: 1,
        focus: 1,
      };
    case "walk":
      return {
        strength: 0,
        constitution: 1,
        vitality: 1,
        dexterity: 0,
        focus: 1,
      };
    case "run":
      return {
        strength: 0,
        constitution: 1,
        vitality: 2,
        dexterity: 1,
        focus: 0,
      };
    case "yoga":
      return {
        strength: 0,
        constitution: 0,
        vitality: 1,
        dexterity: 1,
        focus: 1,
      };
    case "stretching":
    case "mobility":
      return {
        strength: 0,
        constitution: 1,
        vitality: 0,
        dexterity: 2,
        focus: 1,
      };
    case "cardio_circuit":
      return {
        strength: 1,
        constitution: 1,
        vitality: 1,
        dexterity: 1,
        focus: 0,
      };
    case "abdominal":
      return {
        strength: 1,
        constitution: 1,
        vitality: 0,
        dexterity: 1,
        focus: 1,
      };
    case "strength":
      return {
        strength: 1,
        constitution: 1,
        vitality: 1,
        dexterity: 1,
        focus: 0,
      };
    default:
      return {
        strength: 1,
        constitution: 1,
        vitality: 1,
        dexterity: 1,
        focus: 0,
      };
  }
}

function tweakMissionAttributeDeltaForBodyArea(
  delta: MissionAttributeDelta,
  bodyArea: string,
): MissionAttributeDelta {
  const output = { ...delta };
  const normalizedBodyArea = String(bodyArea || "").toLowerCase();
  if (normalizedBodyArea === "upper") output.strength += 1;
  else if (normalizedBodyArea === "lower") output.vitality += 1;
  else if (normalizedBodyArea === "core") output.constitution += 1;
  return output;
}

function tweakMissionAttributeDeltaForExerciseType(
  delta: MissionAttributeDelta,
  exerciseType: string,
): MissionAttributeDelta {
  const output = { ...delta };
  const normalizedExerciseType = String(exerciseType || "").toLowerCase();
  if (normalizedExerciseType === "cardio") {
    output.vitality += 1;
    output.constitution += 1;
  } else if (normalizedExerciseType === "flexibilidade") {
    output.dexterity += 1;
    output.focus += 1;
  } else if (normalizedExerciseType === "equilibrio") {
    output.focus += 1;
    output.constitution += 1;
  }
  return output;
}

function missionCompletionEffortFactor(
  metricType: MissionMetricType,
  completedValue: number,
  missionMetricValue: number,
): number {
  if (completedValue <= 0) return 1;
  const target = Math.max(1, Math.floor(Number(missionMetricValue) || 1));
  if (metricType === "repetitions" || metricType === "sets_reps") {
    const ratio = completedValue / target;
    return Math.max(
      1,
      Math.min(2, Math.round(Math.min(1.15, Math.max(0.75, ratio)) * 1.5)),
    );
  }
  if (metricType === "duration_seconds") {
    return Math.max(1, Math.min(2, 1 + Math.floor(completedValue / 120)));
  }
  if (metricType === "duration_minutes") {
    return Math.max(
      1,
      Math.min(2, 1 + Math.floor((completedValue * 60) / 120)),
    );
  }
  if (metricType === "steps") {
    return Math.max(1, Math.min(2, 1 + Math.floor(completedValue / 4000)));
  }
  if (metricType === "distance_meters") {
    return Math.max(1, Math.min(2, 1 + Math.floor(completedValue / 1500)));
  }
  return 1;
}

export function createMissionProgressionService(deps: MissionProgressionDeps) {
  function computeMissionTypeAttributeDelta(
    missionRow: Record<string, unknown>,
    metricType: MissionMetricType,
    completedMetricValue: number,
  ): MissionAttributeDelta {
    const category = String(missionRow.exercise_category ?? "default");
    const bodyArea = String(missionRow.body_area ?? "full_body");
    const exerciseType = String(missionRow.exercise_type ?? "forca");
    const metricValue = Number(
      missionRow.metric_value ??
        missionRow.target_reps ??
        missionRow.target_time ??
        1,
    );
    let base = baseMissionAttributeDeltaForExerciseCategory(category);
    base = tweakMissionAttributeDeltaForBodyArea(base, bodyArea);
    base = tweakMissionAttributeDeltaForExerciseType(base, exerciseType);
    const factor = missionCompletionEffortFactor(
      metricType,
      completedMetricValue,
      metricValue,
    );
    return scaleMissionAttributeDelta(base, factor);
  }

  function totalSkillTableAttributeGain(skill: Record<string, unknown>): number {
    return (
      Number(skill.strength_gain ?? 0) +
      Number(skill.constitution_gain ?? 0) +
      Number(skill.vitality_gain ?? 0) +
      Number(skill.dexterity_gain ?? 0) +
      Number(skill.focus_gain ?? 0)
    );
  }

  async function applyMissionAttributeDeltaToUser(
    db: D1Database,
    userId: string,
    delta: MissionAttributeDelta,
  ): Promise<void> {
    const total =
      delta.strength +
      delta.constitution +
      delta.vitality +
      delta.dexterity +
      delta.focus;
    if (total <= 0) return;
    await deps.ensureUserAttributesRow(db, userId);
    await db
      .prepare(
        `UPDATE user_attributes SET
          strength = strength + ?,
          constitution = constitution + ?,
          vitality = vitality + ?,
          dexterity = dexterity + ?,
          focus = focus + ?,
          updated_at = datetime('now')
        WHERE user_id = ?`,
      )
      .bind(
        delta.strength,
        delta.constitution,
        delta.vitality,
        delta.dexterity,
        delta.focus,
        userId,
      )
      .run();
  }

  return {
    applyMissionAttributeDeltaToUser,
    computeMissionTypeAttributeDelta,
    totalSkillTableAttributeGain,
  };
}
