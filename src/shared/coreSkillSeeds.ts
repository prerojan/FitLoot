export type ThresholdType = "reps" | "time";

export type VariantSkillSeed = {
  slug: string;
  namePt: string;
  parentSkill: string;
  thresholdType: ThresholdType;
  threshold: number;
  thresholdUnit: "reps" | "seconds";
  exerciseDbTerms: string[];
  aliases?: string[];
  notes?: string;
};

export const PARENT_SKILL_MAP: Record<string, string> = {
  Flexões: "Flexão",
  Agachamentos: "Agachamento",
  Pranchas: "Prancha",
  Abdominais: "Abdominal",
};

/** Variantes de exercício desbloqueáveis por desempenho (reps/time no parent). */
export const variantSkillSeeds: VariantSkillSeed[] = [
  // FLEXÕES
  { slug: "wall-push-up", namePt: "Flexão na parede", parentSkill: "Flexões", thresholdType: "reps", threshold: 20, thresholdUnit: "reps", exerciseDbTerms: ["push-up (wall)", "wall push up"], aliases: ["flexão parede"] },
  { slug: "incline-push-up", namePt: "Flexão inclinada", parentSkill: "Flexões", thresholdType: "reps", threshold: 15, thresholdUnit: "reps", exerciseDbTerms: ["incline push-up"], aliases: ["flexão inclinada"] },
  { slug: "push-up", namePt: "Flexão tradicional", parentSkill: "Flexões", thresholdType: "reps", threshold: 10, thresholdUnit: "reps", exerciseDbTerms: ["push-up", "push up"], aliases: ["flexão", "flexão tradicional"] },
  { slug: "close-grip-push-up", namePt: "Flexão fechada", parentSkill: "Flexões", thresholdType: "reps", threshold: 8, thresholdUnit: "reps", exerciseDbTerms: ["close-grip push-up", "close grip push up"], aliases: ["flexão fechada"] },
  { slug: "diamond-push-up", namePt: "Flexão diamante", parentSkill: "Flexões", thresholdType: "reps", threshold: 8, thresholdUnit: "reps", exerciseDbTerms: ["diamond push-up", "diamond push up"], aliases: ["flexão diamante"] },
  { slug: "decline-push-up", namePt: "Flexão declinada", parentSkill: "Flexões", thresholdType: "reps", threshold: 8, thresholdUnit: "reps", exerciseDbTerms: ["decline push-up", "decline push up"], aliases: ["flexão declinada"] },
  { slug: "deep-push-up", namePt: "Flexão profunda", parentSkill: "Flexões", thresholdType: "reps", threshold: 6, thresholdUnit: "reps", exerciseDbTerms: ["deep push up", "deep push-up"], aliases: ["flexão profunda"] },
  { slug: "push-up-plus", namePt: "Flexão com protração escapular", parentSkill: "Flexões", thresholdType: "reps", threshold: 12, thresholdUnit: "reps", exerciseDbTerms: ["push-up plus", "push up plus"], aliases: ["push up plus", "flexão escapular"] },
  { slug: "clock-push-up", namePt: "Flexão relógio", parentSkill: "Flexões", thresholdType: "reps", threshold: 6, thresholdUnit: "reps", exerciseDbTerms: ["clock push-up", "clock push up"], aliases: ["flexão relógio"] },
  { slug: "clap-push-up", namePt: "Flexão explosiva com palmas", parentSkill: "Flexões", thresholdType: "reps", threshold: 5, thresholdUnit: "reps", exerciseDbTerms: ["clap push up", "clap push-up"], aliases: ["flexão com palmas", "flexão explosiva"] },
  { slug: "chest-tap-push-up", namePt: "Flexão com toque no peito", parentSkill: "Flexões", thresholdType: "reps", threshold: 5, thresholdUnit: "reps", exerciseDbTerms: ["chest tap push-up", "chest tap push-up (male)"], aliases: ["flexão toque no peito"] },
  { slug: "single-arm-raise-push-up", namePt: "Flexão unilateral assistida", parentSkill: "Flexões", thresholdType: "reps", threshold: 5, thresholdUnit: "reps", exerciseDbTerms: ["raise single arm push-up", "single arm raise push up"], aliases: ["flexão unilateral assistida"] },
  // AGACHAMENTOS
  { slug: "assisted-squat", namePt: "Agachamento assistido", parentSkill: "Agachamentos", thresholdType: "reps", threshold: 20, thresholdUnit: "reps", exerciseDbTerms: ["assisted squat"], aliases: ["agachamento assistido"] },
  { slug: "bodyweight-squat", namePt: "Agachamento livre", parentSkill: "Agachamentos", thresholdType: "reps", threshold: 20, thresholdUnit: "reps", exerciseDbTerms: ["bodyweight squat", "squat"], aliases: ["agachamento livre", "agachamento tradicional"] },
  { slug: "jump-squat", namePt: "Agachamento com salto", parentSkill: "Agachamentos", thresholdType: "reps", threshold: 10, thresholdUnit: "reps", exerciseDbTerms: ["jump squat"], aliases: ["agachamento com salto"] },
  { slug: "sumo-squat", namePt: "Agachamento sumô", parentSkill: "Agachamentos", thresholdType: "reps", threshold: 15, thresholdUnit: "reps", exerciseDbTerms: ["sumo squat"], aliases: ["agachamento sumô", "agachamento sumo"] },
  { slug: "bulgarian-squat", namePt: "Agachamento búlgaro", parentSkill: "Agachamentos", thresholdType: "reps", threshold: 8, thresholdUnit: "reps", exerciseDbTerms: ["bulgarian squat", "split squat"], aliases: ["búlgaro", "agachamento búlgaro"] },
  { slug: "assisted-pistol-squat", namePt: "Pistol squat assistido", parentSkill: "Agachamentos", thresholdType: "reps", threshold: 5, thresholdUnit: "reps", exerciseDbTerms: ["assisted pistol squat"], aliases: ["pistol assistido"] },
  { slug: "pistol-squat", namePt: "Pistol squat", parentSkill: "Agachamentos", thresholdType: "reps", threshold: 3, thresholdUnit: "reps", exerciseDbTerms: ["pistol squat"], aliases: ["agachamento pistol"] },
  // PRANCHAS
  { slug: "plank", namePt: "Prancha frontal", parentSkill: "Pranchas", thresholdType: "time", threshold: 30, thresholdUnit: "seconds", exerciseDbTerms: ["plank"], aliases: ["prancha frontal", "prancha"] },
  { slug: "side-plank", namePt: "Prancha lateral", parentSkill: "Pranchas", thresholdType: "time", threshold: 20, thresholdUnit: "seconds", exerciseDbTerms: ["side plank"], aliases: ["prancha lateral"] },
  { slug: "high-plank", namePt: "Prancha alta", parentSkill: "Pranchas", thresholdType: "time", threshold: 30, thresholdUnit: "seconds", exerciseDbTerms: ["high plank"], aliases: ["prancha alta"] },
  { slug: "push-up-to-side-plank", namePt: "Prancha com rotação lateral", parentSkill: "Pranchas", thresholdType: "reps", threshold: 10, thresholdUnit: "reps", exerciseDbTerms: ["push-up to side plank"], aliases: ["prancha com toque lateral", "prancha com rotação"] },
  // ABDOMINAIS
  { slug: "quarter-sit-up", namePt: "Abdominal parcial", parentSkill: "Abdominais", thresholdType: "reps", threshold: 20, thresholdUnit: "reps", exerciseDbTerms: ["quarter sit-up", "quarter sit up"], aliases: ["abdominal parcial"] },
  { slug: "sit-up", namePt: "Abdominal tradicional", parentSkill: "Abdominais", thresholdType: "reps", threshold: 15, thresholdUnit: "reps", exerciseDbTerms: ["sit-up", "sit up"], aliases: ["abdominal tradicional", "abdominal"] },
  { slug: "crunch", namePt: "Abdominal crunch", parentSkill: "Abdominais", thresholdType: "reps", threshold: 20, thresholdUnit: "reps", exerciseDbTerms: ["crunch"], aliases: ["crunch", "abdominal crunch"] },
  { slug: "decline-sit-up", namePt: "Abdominal declinado", parentSkill: "Abdominais", thresholdType: "reps", threshold: 10, thresholdUnit: "reps", exerciseDbTerms: ["decline sit-up", "decline sit up"], aliases: ["abdominal declinado"] },
  { slug: "leg-raise", namePt: "Elevação de pernas", parentSkill: "Abdominais", thresholdType: "reps", threshold: 12, thresholdUnit: "reps", exerciseDbTerms: ["leg raise"], aliases: ["elevação de pernas"] },
];

/** Skills macro (Handstand, Planche, L-sit) — usam stageProgression, não variantes. Mantido para referência/UI. */
export const macroSkillSeeds: VariantSkillSeed[] = [
  { slug: "handstand", namePt: "Handstand", parentSkill: "Calistenia / Invertidos", thresholdType: "time", threshold: 10, thresholdUnit: "seconds", exerciseDbTerms: ["pike push up", "decline push-up", "push-up", "push-up (wall)"], aliases: ["parada de mão", "bananeira", "hand stand"] },
  { slug: "planche", namePt: "Planche", parentSkill: "Calistenia / Straight-arm strength", thresholdType: "time", threshold: 5, thresholdUnit: "seconds", exerciseDbTerms: ["push-up plus", "deep push up", "close-grip push-up", "decline push-up"], aliases: ["prancha planche"] },
  { slug: "l-sit", namePt: "L-sit", parentSkill: "Core / Isometrias", thresholdType: "time", threshold: 10, thresholdUnit: "seconds", exerciseDbTerms: ["l-sit", "leg raise"], aliases: ["l sit"] },
];
