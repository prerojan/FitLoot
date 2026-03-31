import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
} from "../../react-app/utils/onboardingDraft";

const ONBOARDING_DRAFT_STORAGE_KEY = "fitloot_onboarding_draft";

const SAMPLE_DRAFT: OnboardingDraft = {
  username: "fitloot_user",
  full_name: "Fit Loot",
  weight: "78",
  height: "178",
  initial_conditioning: "iniciante",
  initial_pushups: "12",
  initial_situps: "18",
  initial_squats: "24",
  injuries: "",
  equipment: "colchonete",
  main_goal: "ganhar_massa",
  gender: "homem",
  age: "29",
  weeklyFrequency: 4,
  selectedEquipment: ["halteres", "elastico"],
};

describe("onboardingDraft", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("persists the onboarding draft in localStorage", () => {
    saveOnboardingDraft(SAMPLE_DRAFT);

    expect(loadOnboardingDraft()).toEqual(SAMPLE_DRAFT);
    expect(localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toContain("\"version\":1");
    expect(sessionStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("migrates a legacy sessionStorage draft to localStorage", () => {
    sessionStorage.setItem(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify(SAMPLE_DRAFT),
    );

    expect(loadOnboardingDraft()).toEqual(SAMPLE_DRAFT);
    expect(localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toContain("\"draft\"");
    expect(sessionStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("clears stale stored drafts after the ttl window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-30T10:00:00.000Z"));

    localStorage.setItem(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: Date.now() - 13 * 60 * 60 * 1000,
        draft: SAMPLE_DRAFT,
      }),
    );

    expect(loadOnboardingDraft()).toBeNull();
    expect(localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("removes all local copies when cleared", () => {
    saveOnboardingDraft(SAMPLE_DRAFT);
    sessionStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(SAMPLE_DRAFT));

    clearOnboardingDraft();

    expect(localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY)).toBeNull();
  });
});
