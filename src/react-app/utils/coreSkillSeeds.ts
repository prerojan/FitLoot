import { variantSkillSeeds, macroSkillSeeds, type VariantSkillSeed } from "../../shared/coreSkillSeeds";

export {
  variantSkillSeeds,
  macroSkillSeeds,
  PARENT_SKILL_MAP,
  type VariantSkillSeed,
  type ThresholdType,
} from "../../shared/coreSkillSeeds";

export type SkillSeed = VariantSkillSeed;

/** Todas as variantes + macros para UI/visualização. */
export const coreSkillSeeds: VariantSkillSeed[] = [...variantSkillSeeds, ...macroSkillSeeds];
