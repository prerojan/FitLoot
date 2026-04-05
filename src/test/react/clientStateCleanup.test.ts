import { beforeEach, describe, expect, it } from "vitest";

import { clearPersistedAuthenticatedUserState } from "../../react-app/auth/clientStateCleanup";

describe("clearPersistedAuthenticatedUserState", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.style.removeProperty("--app-primary-color");
  });

  it("removes persisted authenticated user artifacts without touching app-wide theme keys", () => {
    localStorage.setItem("fitloot_authenticated_hint", "1");
    localStorage.setItem("fitloot_pending_404_achievement", "1");
    localStorage.setItem("fitloot_ai_chat_u1", JSON.stringify([{ role: "user" }]));
    localStorage.setItem(
      "fitloot.dashboard.step-mission-progress.v1:u1",
      JSON.stringify({ 1: { metricsDate: "2026-04-04", lastDailySteps: 100, progressValue: 100 } }),
    );
    localStorage.setItem("fitloot.offline-sync.queue.v1", JSON.stringify([{ type: "mission_completed" }]));
    localStorage.setItem("fitloot.offline-sync.metrics-cursor.v1", JSON.stringify({ date: "2026-04-04", steps: 100, calories: 20 }));
    localStorage.setItem("fitloot_onboarding_draft", JSON.stringify({ version: 1 }));
    localStorage.setItem("fitloot_app_theme", "dark");
    sessionStorage.setItem("fitloot_activation_notice", JSON.stringify({ title: "ok", message: "msg", tone: "success" }));
    sessionStorage.setItem("fitloot_onboarding_draft", JSON.stringify({ version: 1 }));
    sessionStorage.setItem("onboarding_email", "user@example.com");
    document.documentElement.style.setProperty("--app-primary-color", "#123456");

    clearPersistedAuthenticatedUserState();

    expect(localStorage.getItem("fitloot_authenticated_hint")).toBeNull();
    expect(localStorage.getItem("fitloot_pending_404_achievement")).toBeNull();
    expect(localStorage.getItem("fitloot_ai_chat_u1")).toBeNull();
    expect(localStorage.getItem("fitloot.dashboard.step-mission-progress.v1:u1")).toBeNull();
    expect(localStorage.getItem("fitloot.offline-sync.queue.v1")).toBe("[]");
    expect(localStorage.getItem("fitloot.offline-sync.metrics-cursor.v1")).toBe(
      JSON.stringify({ date: "", steps: 0, calories: 0, distanceMeters: 0 }),
    );
    expect(localStorage.getItem("fitloot_onboarding_draft")).toBeNull();
    expect(sessionStorage.getItem("fitloot_activation_notice")).toBeNull();
    expect(sessionStorage.getItem("fitloot_onboarding_draft")).toBeNull();
    expect(sessionStorage.getItem("onboarding_email")).toBeNull();
    expect(localStorage.getItem("fitloot_app_theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--app-primary-color")).toBe(
      "#10b981",
    );
  });
});
