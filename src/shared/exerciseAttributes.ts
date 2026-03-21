export type AttributeKey = 'FOR' | 'CON' | 'VIT' | 'DEX' | 'FOC';

export type ExerciseAttributeProfile = {
  primary: AttributeKey;
  secondary?: AttributeKey;
  tertiary?: AttributeKey;
  weights?: Partial<Record<AttributeKey, number>>;
  notes?: string;
};

export type SkillAttributeMap = Record<string, ExerciseAttributeProfile>;

export const exerciseAttributes: SkillAttributeMap = {
  // FLEXÕES
  'wall-push-up': {
    primary: 'FOR',
    secondary: 'CON',
    weights: { FOR: 0.6, CON: 0.4 },
    notes: 'Base de resistência e adaptação inicial.',
  },
  'incline-push-up': {
    primary: 'FOR',
    secondary: 'CON',
    weights: { FOR: 0.55, CON: 0.45 },
  },
  'push-up': {
    primary: 'FOR',
    secondary: 'CON',
    weights: { FOR: 0.6, CON: 0.4 },
  },
  'close-grip-push-up': {
    primary: 'FOR',
    secondary: 'CON',
    weights: { FOR: 0.65, CON: 0.35 },
  },
  'diamond-push-up': {
    primary: 'FOR',
    secondary: 'CON',
    weights: { FOR: 0.65, CON: 0.35 },
  },
  'decline-push-up': {
    primary: 'FOR',
    secondary: 'CON',
    weights: { FOR: 0.7, CON: 0.3 },
  },
  'deep-push-up': {
    primary: 'FOR',
    secondary: 'FOC',
    weights: { FOR: 0.75, FOC: 0.25 },
    notes: 'Amplitude maior exige mais controle e força.',
  },
  'push-up-plus': {
    primary: 'FOC',
    secondary: 'FOR',
    tertiary: 'CON',
    weights: { FOC: 0.5, FOR: 0.3, CON: 0.2 },
    notes: 'Ênfase em controle escapular.',
  },
  'clock-push-up': {
    primary: 'DEX',
    secondary: 'FOR',
    tertiary: 'CON',
    weights: { DEX: 0.5, FOR: 0.3, CON: 0.2 },
  },
  'clap-push-up': {
    primary: 'FOR',
    secondary: 'DEX',
    tertiary: 'VIT',
    weights: { FOR: 0.55, DEX: 0.3, VIT: 0.15 },
    notes: 'Explosão e coordenação.',
  },
  'chest-tap-push-up': {
    primary: 'DEX',
    secondary: 'FOR',
    tertiary: 'CON',
    weights: { DEX: 0.45, FOR: 0.35, CON: 0.2 },
  },
  'single-arm-raise-push-up': {
    primary: 'DEX',
    secondary: 'FOR',
    tertiary: 'CON',
    weights: { DEX: 0.45, FOR: 0.35, CON: 0.2 },
    notes: 'Estabilidade unilateral e controle corporal.',
  },

  // AGACHAMENTOS
  'assisted-squat': {
    primary: 'CON',
    secondary: 'VIT',
    weights: { CON: 0.6, VIT: 0.4 },
  },
  'bodyweight-squat': {
    primary: 'CON',
    secondary: 'VIT',
    tertiary: 'FOR',
    weights: { CON: 0.45, VIT: 0.35, FOR: 0.2 },
  },
  'jump-squat': {
    primary: 'VIT',
    secondary: 'FOR',
    tertiary: 'DEX',
    weights: { VIT: 0.45, FOR: 0.35, DEX: 0.2 },
    notes: 'Movimento explosivo com alta exigência metabólica.',
  },
  'sumo-squat': {
    primary: 'CON',
    secondary: 'FOR',
    weights: { CON: 0.55, FOR: 0.45 },
  },
  'bulgarian-squat': {
    primary: 'FOR',
    secondary: 'DEX',
    tertiary: 'CON',
    weights: { FOR: 0.5, DEX: 0.3, CON: 0.2 },
  },
  'assisted-pistol-squat': {
    primary: 'DEX',
    secondary: 'CON',
    tertiary: 'FOR',
    weights: { DEX: 0.45, CON: 0.35, FOR: 0.2 },
  },
  'pistol-squat': {
    primary: 'FOR',
    secondary: 'DEX',
    tertiary: 'FOC',
    weights: { FOR: 0.5, DEX: 0.3, FOC: 0.2 },
  },

  // PRANCHAS
  plank: {
    primary: 'CON',
    secondary: 'FOC',
    weights: { CON: 0.6, FOC: 0.4 },
  },
  'side-plank': {
    primary: 'FOC',
    secondary: 'CON',
    tertiary: 'DEX',
    weights: { FOC: 0.45, CON: 0.35, DEX: 0.2 },
  },
  'high-plank': {
    primary: 'CON',
    secondary: 'FOC',
    weights: { CON: 0.55, FOC: 0.45 },
  },
  'push-up-to-side-plank': {
    primary: 'DEX',
    secondary: 'CON',
    tertiary: 'FOC',
    weights: { DEX: 0.45, CON: 0.35, FOC: 0.2 },
  },

  // ABDOMINAIS
  'quarter-sit-up': {
    primary: 'CON',
    secondary: 'VIT',
    weights: { CON: 0.65, VIT: 0.35 },
  },
  'sit-up': {
    primary: 'CON',
    secondary: 'VIT',
    weights: { CON: 0.6, VIT: 0.4 },
  },
  crunch: {
    primary: 'CON',
    secondary: 'FOC',
    weights: { CON: 0.65, FOC: 0.35 },
  },
  'decline-sit-up': {
    primary: 'FOR',
    secondary: 'CON',
    tertiary: 'VIT',
    weights: { FOR: 0.45, CON: 0.35, VIT: 0.2 },
  },
  'leg-raise': {
    primary: 'FOR',
    secondary: 'FOC',
    tertiary: 'CON',
    weights: { FOR: 0.5, FOC: 0.3, CON: 0.2 },
  },

  // MACRO SKILLS
  handstand: {
    primary: 'DEX',
    secondary: 'FOC',
    tertiary: 'FOR',
    weights: { DEX: 0.45, FOC: 0.4, FOR: 0.15 },
    notes: 'Equilíbrio, controle e coordenação fina.',
  },
  planche: {
    primary: 'FOR',
    secondary: 'FOC',
    tertiary: 'DEX',
    weights: { FOR: 0.5, FOC: 0.35, DEX: 0.15 },
    notes: 'Straight-arm strength com alta exigência de controle.',
  },
  'l-sit': {
    primary: 'FOC',
    secondary: 'FOR',
    tertiary: 'DEX',
    weights: { FOC: 0.45, FOR: 0.35, DEX: 0.2 },
  },
};

export const attributeDisplayNames: Record<AttributeKey, string> = {
  FOR: 'Força',
  CON: 'Constituição',
  VIT: 'Vitalidade',
  DEX: 'Destreza',
  FOC: 'Foco',
};

export function getExerciseAttributes(slug: string): ExerciseAttributeProfile | null {
  return exerciseAttributes[slug] ?? null;
}

export function getExerciseAttributeWeights(
  slug: string,
): Partial<Record<AttributeKey, number>> {
  const profile = getExerciseAttributes(slug);
  if (!profile) return {};

  if (profile.weights) return profile.weights;

  const fallback: Partial<Record<AttributeKey, number>> = {
    [profile.primary]: 1,
  };

  if (profile.secondary) fallback[profile.secondary] = 0.5;
  if (profile.tertiary) fallback[profile.tertiary] = 0.25;

  return fallback;
}

export function distributeExercisePoints(params: {
  slug: string;
  totalPoints: number;
  round?: boolean;
}): Partial<Record<AttributeKey, number>> {
  const { slug, totalPoints, round = true } = params;
  const weights = getExerciseAttributeWeights(slug);

  const entries = Object.entries(weights) as Array<[AttributeKey, number]>;
  if (!entries.length || totalPoints <= 0) return {};

  const weightSum = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (weightSum <= 0) return {};

  const result: Partial<Record<AttributeKey, number>> = {};

  for (const [attribute, weight] of entries) {
    const value = (totalPoints * weight) / weightSum;
    result[attribute] = round ? Math.round(value) : value;
  }

  return result;
}

export function getPrimaryAttribute(slug: string): AttributeKey | null {
  return exerciseAttributes[slug]?.primary ?? null;
}

export function getSecondaryAttribute(slug: string): AttributeKey | null {
  return exerciseAttributes[slug]?.secondary ?? null;
}

export function isSkillFocusedOnAttribute(
  slug: string,
  attribute: AttributeKey,
): boolean {
  const profile = getExerciseAttributes(slug);
  if (!profile) return false;

  return (
    profile.primary === attribute ||
    profile.secondary === attribute ||
    profile.tertiary === attribute
  );
}

/**
 * Fallback semântico por família, útil caso chegue um slug não mapeado ainda.
 */
export function inferAttributesBySlug(slug: string): ExerciseAttributeProfile {
  const normalized = slug.toLowerCase();

  if (normalized.includes('handstand')) {
    return { primary: 'DEX', secondary: 'FOC', tertiary: 'FOR' };
  }

  if (normalized.includes('planche') || normalized.includes('l-sit')) {
    return { primary: 'FOR', secondary: 'FOC', tertiary: 'DEX' };
  }

  if (normalized.includes('plank')) {
    return { primary: 'CON', secondary: 'FOC' };
  }

  if (normalized.includes('push-up') || normalized.includes('pushup')) {
    return { primary: 'FOR', secondary: 'CON' };
  }

  if (normalized.includes('squat')) {
    return { primary: 'CON', secondary: 'VIT', tertiary: 'FOR' };
  }

  if (
    normalized.includes('sit-up') ||
    normalized.includes('situp') ||
    normalized.includes('crunch') ||
    normalized.includes('leg-raise')
  ) {
    return { primary: 'CON', secondary: 'FOC', tertiary: 'FOR' };
  }

  return { primary: 'CON' };
}
