import { variantSkillSeeds, macroSkillSeeds, type VariantSkillSeed } from "../../shared/coreSkillSeeds";

// Reexporta os seeds compartilhados para os consumidores legados do frontend.
export {
  variantSkillSeeds,
  macroSkillSeeds,
  PARENT_SKILL_MAP,
  type VariantSkillSeed,
  type ThresholdType,
} from "../../shared/coreSkillSeeds";

export type SkillSeed = VariantSkillSeed;

// Junta variantes e macros em uma lista unica para UI e exibicao.
export const coreSkillSeeds: VariantSkillSeed[] = [...variantSkillSeeds, ...macroSkillSeeds];
