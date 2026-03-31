import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER,
  SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD,
} from "../../worker/constants/missionRetention";

describe("missionRetention constants", () => {
  it("define retention por periodo conforme regra de negocio", () => {
    expect(SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.daily).toBe(
      "-5 minutes",
    );
    expect(SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.weekly).toBe(
      "-7 days",
    );
    expect(SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.monthly).toBe(
      "-30 days",
    );
    expect(DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER).toBe("-30 days");
  });
});

