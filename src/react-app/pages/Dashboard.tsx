import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import AppPageShell from "@/react-app/components/AppPageShell";
import MissionCard from "@/react-app/components/MissionCard";
import LevelUpModal from "@/react-app/components/LevelUpModal";
import AIRecommendations from "@/react-app/components/AIRecommendations";
import AIMissionGenerator from "@/react-app/components/AIMissionGenerator";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Award, Bot, CalendarDays, Camera, Cloud, Flame, Zap } from "lucide-react";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import type {
  AchievementWithUnlock,
  DailyMetrics,
  Mission,
  Title,
  UserProfile,
  UserProgression,
} from "@/shared/types";
import {
  ApiRequestError,
  api,
  clearJsonCache,
  fetchAndCacheJson,
  prefetchJson,
  readCachedJson,
} from "@/react-app/utils/api";
import { getAchievementShowcaseStyle, resolveShowcasedAchievement } from "@/react-app/utils/achievementShowcase";
import {
  MetricCard,
  SectionHeader,
} from "@/react-app/pages/dashboardHelpers";
import {
  PANEL_STYLE,
  PRIMARY_GLOW_STYLE,
  STEPS_TARGET,
  SUBTLE_PANEL_STYLE,
  buildCenteredDates,
  capitalizeLabel,
  clamp,
  extractDateKey,
  formatDateKey,
  formatNumber,
  isMissionCompleted,
  sortMissions,
} from "@/react-app/pages/dashboardUtils";

type DashboardLoadingState = {
  profile: boolean;
  progression: boolean;
  missions: boolean;
  metrics: boolean;
  titles: boolean;
};

const DEFAULT_LOADING_STATE: DashboardLoadingState = {
  profile: true,
  progression: true,
  missions: true,
  metrics: true,
  titles: true,
};

/** Alinhado ao worker: XP na barra do nível atual ≥ meta ⇒ estado inconsistente; forçar refetch de /api/progression. */
function progressionHasXpOverflow(p: Pick<UserProgression, "xp" | "level">): boolean {
  const level = Math.max(1, Math.floor(Number(p.level ?? 1)));
  const xp = Math.max(0, Math.floor(Number(p.xp ?? 0)));
  const cap = Math.max(100, level * 100);
  return xp >= cap;
}

function normalizeMissionTextKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function missionNeedsSynchronousRefresh(mission: Mission): boolean {
  if (mission.type !== "monthly") return false;
  if (Array.isArray(mission.circuit_tasks) && mission.circuit_tasks.length > 0) return false;

  const title = normalizeMissionTextKey(mission.title);
  const goal = normalizeMissionTextKey(mission.goal);

  if (title.includes("consistencia mensal")) return !goal.includes("missoes concluidas");
  if (title.includes("distancia mensal")) return !goal.includes("passos acumulados");
  if (title.includes("dias ativos") || title.includes("pratica ativa")) return !goal.includes("dias ativos");
  if (title.includes("circuitos semanais")) return !goal.includes("circuitos semanais");
  if (title.includes("volume mensal")) return !goal.includes("missoes concluidas");
  if (title.includes("desafio cardio")) return !goal.includes("passos acumulados");

  return false;
}

function resolveMissionsApiPath(forceRefresh: boolean, cachedMissions: Mission[] | null): string {
  if (forceRefresh) return "/api/missions?refresh=1";
  if (Array.isArray(cachedMissions) && cachedMissions.some(missionNeedsSynchronousRefresh)) {
    return "/api/missions?refresh=1";
  }
  return "/api/missions";
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isExpiredMission = useCallback(
    (mission: Mission) => mission.status === "failed" || mission.status === "expired",
    [],
  );
  const isAiSpecialMission = useCallback(
    (mission: Mission) => Number(mission.is_ai_special ?? 0) === 1 || mission.mission_origin === "ai",
    [],
  );

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null);
  const [achievements, setAchievements] = useState<AchievementWithUnlock[]>([]);
  const [activeTitle, setActiveTitle] = useState<Title | null>(null);
  const [loadingState, setLoadingState] = useState<DashboardLoadingState>(DEFAULT_LOADING_STATE);
  const [error, setError] = useState<string | null>(null);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [newLevel, setNewLevel] = useState(0);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const quickActionsRef = useRef<HTMLDivElement | null>(null);

  const setSectionLoading = useCallback((section: keyof DashboardLoadingState, value: boolean) => {
    setLoadingState((current) => ({ ...current, [section]: value }));
  }, []);

  const loadData = useCallback(async (options?: { forceRefresh?: boolean | undefined }) => {
    const forceRefresh = options?.forceRefresh === true;
    setError(null);

    const cacheProfile = readCachedJson<UserProfile>("/api/profile");
    const cacheProgression = readCachedJson<UserProgression>("/api/progression");
    const cacheMissions = readCachedJson<Mission[]>("/api/missions");
    const cacheMetrics = readCachedJson<DailyMetrics>("/api/metrics/today");
    const cacheAchievements = readCachedJson<AchievementWithUnlock[]>("/api/achievements");
    const cacheTitles = readCachedJson<Array<Title & { is_active?: number | undefined }>>("/api/titles");
    const cachedMissionList = Array.isArray(cacheMissions?.data) ? cacheMissions.data : null;
    const missionsApiPath = resolveMissionsApiPath(forceRefresh, cachedMissionList);
    const shouldForceMissionRefresh = missionsApiPath !== "/api/missions";
    const cachedProgressionPayload = cacheProgression?.data ?? null;
    const progressionNeedsReconcile =
      cachedProgressionPayload !== null && progressionHasXpOverflow(cachedProgressionPayload);

    if (cacheProfile) setProfile(cacheProfile.data);
    if (cacheProgression) setProgression(cacheProgression.data);
    if (cacheMissions) setMissions(Array.isArray(cacheMissions.data) ? cacheMissions.data : []);
    if (cacheMetrics) setMetrics(cacheMetrics.data);
    if (cacheAchievements) setAchievements(Array.isArray(cacheAchievements.data) ? cacheAchievements.data : []);
    if (cacheTitles) {
      setActiveTitle(cacheTitles.data.find((title) => title.is_active === 1) ?? null);
    }

    setLoadingState({
      profile: forceRefresh || !cacheProfile,
      progression: forceRefresh || !cacheProgression || progressionNeedsReconcile,
      missions: shouldForceMissionRefresh || !cacheMissions,
      metrics: forceRefresh || !cacheMetrics,
      titles: forceRefresh || !cacheTitles,
    });

    let shouldRedirectToApp = false;
    let shouldRedirectToOnboarding = false;
    let hasRequestError = false;

    const runRequest = async <T,>(
      section: keyof DashboardLoadingState,
      path: string,
      hasCachedEntry: boolean,
      stale: boolean,
      onSuccess: (payload: T) => void,
      onNotFound?: (() => void) | undefined,
    ) => {
      if (!forceRefresh && hasCachedEntry && !stale) {
        setSectionLoading(section, false);
        return;
      }

      try {
        onSuccess(await fetchAndCacheJson<T>(path));
      } catch (requestError) {
        if (requestError instanceof ApiRequestError) {
          if (requestError.status === 401 || requestError.status === 403) {
            shouldRedirectToApp = true;
            return;
          }
          if (requestError.status === 404 && onNotFound) {
            onNotFound();
            return;
          }
        }

        if (!hasCachedEntry) {
          hasRequestError = true;
          setError("Não foi possível carregar todos os dados do dashboard agora.");
        }
      } finally {
        setSectionLoading(section, false);
      }
    };

    await Promise.all([
      runRequest<UserProfile>("profile", "/api/profile", Boolean(cacheProfile), Boolean(cacheProfile?.stale), setProfile, () => {
        shouldRedirectToOnboarding = true;
      }),
      runRequest<UserProgression>(
        "progression",
        "/api/progression",
        Boolean(cacheProgression),
        Boolean(cacheProgression?.stale) || progressionNeedsReconcile,
        (payload) => {
          const { celebrate_level: celebrateLevel, ...clean } = payload;
          setProgression(clean);
          if (typeof celebrateLevel === "number" && celebrateLevel > 0) {
            setNewLevel(celebrateLevel);
            setShowLevelUp(true);
          }
        },
      ),
      runRequest<Mission[]>("missions", missionsApiPath, Boolean(cacheMissions), shouldForceMissionRefresh || Boolean(cacheMissions?.stale), (payload) => {
        setMissions(Array.isArray(payload) ? payload : []);
      }),
      runRequest<DailyMetrics>("metrics", "/api/metrics/today", Boolean(cacheMetrics), Boolean(cacheMetrics?.stale), setMetrics),
      (async () => {
        try {
          const payload = await fetchAndCacheJson<AchievementWithUnlock[]>("/api/achievements");
          setAchievements(Array.isArray(payload) ? payload : []);
        } catch (requestError) {
          if (requestError instanceof ApiRequestError && (requestError.status === 401 || requestError.status === 403)) {
            shouldRedirectToApp = true;
          }
        }
      })(),
      runRequest<Array<Title & { is_active?: number | undefined }>>("titles", "/api/titles", Boolean(cacheTitles), Boolean(cacheTitles?.stale), (payload) => {
        setActiveTitle((Array.isArray(payload) ? payload : []).find((title) => title.is_active === 1) ?? null);
      }),
    ]);

    if (shouldRedirectToApp) {
      navigate("/app");
      return;
    }

    if (shouldRedirectToOnboarding) {
      navigate("/onboarding");
      return;
    }

    if (hasRequestError) return;
  }, [navigate, setSectionLoading]);

  useEffect(() => {
    if (!quickActionsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (quickActionsRef.current?.contains(target)) return;
      setQuickActionsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [quickActionsOpen]);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadData();
  }, [user, navigate, loadData]);

  useEffect(() => {
    void import("@/react-app/pages/Profile");
    void import("@/react-app/pages/MiniGames");
    void import("@/react-app/pages/Friends");
    void import("@/react-app/pages/Shop");
    void import("@/react-app/pages/Ranking");
    void import("@/react-app/pages/AIChat");
    void import("@/react-app/pages/FoodAnalysis");
    void prefetchJson("/api/profile");
    void prefetchJson("/api/missions");
    void prefetchJson("/api/metrics/today");
    void prefetchJson("/api/titles");
  }, []);

  const refreshData = useCallback(async () => {
    clearJsonCache("/api/profile");
    clearJsonCache("/api/progression");
    clearJsonCache("/api/missions");
    clearJsonCache("/api/missions?refresh=1");
    clearJsonCache("/api/metrics/today");
    clearJsonCache("/api/titles");
    await loadData({ forceRefresh: true });
  }, [loadData]);

  const handleMissionComplete = async (missionId: number, metricValue: number, verified: boolean) => {
    try {
      const response = await api("/api/missions/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_id: missionId,
          reps_completed: metricValue,
          metric_completed: metricValue,
          sensor_verified: verified,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        setError(payload?.error ?? "Não foi possível concluir a missão.");
        return;
      }

      const result = (await response.json()) as { leveledUp?: boolean | undefined };
      setMissions((current) => current.filter((mission) => mission.id !== missionId));

      if (result.leveledUp) {
        clearJsonCache("/api/progression");
        try {
          const updatedProgression = await fetchAndCacheJson<UserProgression>("/api/progression");
          setNewLevel(Number(updatedProgression.level ?? 0));
          setShowLevelUp(true);
        } catch {
          // Dashboard refresh right below reconciles the state.
        }
      }

      await refreshData();
    } catch {
      setError("Não foi possível concluir a missão agora.");
    }
  };

  const allDailyMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.type === "daily" && !isAiSpecialMission(mission))),
    [isAiSpecialMission, missions],
  );
  const visibleDailyMissions = useMemo(() => allDailyMissions.slice(0, 3), [allDailyMissions]);
  const aiSpecialMissions = useMemo(
    () => sortMissions(missions.filter((mission) => isAiSpecialMission(mission) && mission.is_completed !== 1 && !isExpiredMission(mission))),
    [isAiSpecialMission, isExpiredMission, missions],
  );
  const weeklyMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.type === "weekly" && mission.is_completed !== 1 && !isExpiredMission(mission) && !isAiSpecialMission(mission))),
    [isAiSpecialMission, isExpiredMission, missions],
  );
  const monthlyMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.type === "monthly" && mission.is_completed !== 1 && !isExpiredMission(mission) && !isAiSpecialMission(mission))),
    [isAiSpecialMission, isExpiredMission, missions],
  );
  const failedMissions = useMemo(
    () => sortMissions(missions.filter((mission) => isExpiredMission(mission) && mission.is_completed !== 1 && !isAiSpecialMission(mission))),
    [isAiSpecialMission, isExpiredMission, missions],
  );
  const missionFeedSections = useMemo(
    () =>
      [
        { title: "Todas as missões de hoje", missions: allDailyMissions },
        { title: "Missões especiais da IA", missions: aiSpecialMissions },
        { title: "Missões semanais", missions: weeklyMissions },
        { title: "Missões mensais", missions: monthlyMissions },
        { title: "Missões expiradas", missions: failedMissions },
      ].filter((section) => section.missions.length > 0),
    [aiSpecialMissions, allDailyMissions, failedMissions, monthlyMissions, weeklyMissions],
  );

  const levelValue = progression?.level ?? 1;
  const xpForNextLevel = Math.max(100, levelValue * 100);
  const xpProgress = clamp((Math.max(0, progression?.xp ?? 0) / xpForNextLevel) * 100, 0, 100);
  const stepsValue = metrics?.steps ?? 0;
  const caloriesValue = metrics?.calories_burned ?? 0;
  const stepsProgress = clamp((stepsValue / STEPS_TARGET) * 100, 0, 100);
  const todayKey = useMemo(() => formatDateKey(new Date()), []);
  const calendarDates = useMemo(() => buildCenteredDates(new Date(), 2), []);
  const currentDateLabel = useMemo(() => {
    const label = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "short" }).format(new Date());
    return capitalizeLabel(label.replace(".", ""));
  }, []);
  const completedWeekKeys = useMemo(() => {
    const keys = new Set<string>();
    missions.forEach((mission) => {
      if (isMissionCompleted(mission)) {
        const completedKey = extractDateKey(mission.completed_at);
        if (completedKey) keys.add(completedKey);
      }
    });
    const lastActivityKey = extractDateKey(progression?.last_activity_date);
    if (lastActivityKey) keys.add(lastActivityKey);
    return keys;
  }, [missions, progression?.last_activity_date]);
  const recentStepDates = useMemo(
    () => Array.from({ length: 5 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (4 - index));
      return date;
    }),
    [],
  );
  const stepBars = useMemo(() => {
    const currentSteps = Math.max(0, stepsValue);
    const fallbackRatios = [0.42, 0.56, 0.72, 0.64, 1];
    const values = recentStepDates.map((date, index) => {
      const dateKey = formatDateKey(date);
      if (dateKey === todayKey) return currentSteps;
      if (currentSteps === 0) return 0;

      const activityAdjustment = completedWeekKeys.has(dateKey) ? 0.12 : -0.04;
      const baseRatio = fallbackRatios[index] ?? 1;
      const ratio = clamp(baseRatio + activityAdjustment, 0.18, 0.94);
      return Math.round(currentSteps * ratio);
    });
    const maxValue = Math.max(...values, 0);

    return values.map((value, index) => ({
      height: maxValue > 0 ? (value / maxValue) * 100 : 0,
      opacity: index === values.length - 1 ? 1 : 0.3 + index * 0.12,
      value,
    }));
  }, [completedWeekKeys, recentStepDates, stepsValue, todayKey]);

  const displayName = profile?.full_name ?? user?.name ?? "Seu dashboard";
  const usernameLabel = profile?.username ? `@${profile.username}` : user?.email ?? "fitloot";

  const scrollToSection = useCallback((sectionId: string) => {
    const section = document.getElementById(sectionId);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const handleQuickAction = useCallback((path: string) => {
    setQuickActionsOpen(false);
    navigate(path);
  }, [navigate]);

  const xpDisplayValue = Math.max(0, progression?.xp ?? 0);
  const xpStrLength = xpDisplayValue.toString().length;
  const xpTextSizeClass = xpStrLength >= 5 ? "text-xl md:text-2xl" : xpStrLength === 4 ? "text-2xl md:text-3xl" : "text-3xl md:text-4xl";
  const xpLabelSizeClass = xpStrLength >= 5 ? "text-[0.6rem] md:text-[0.65rem]" : xpStrLength === 4 ? "text-[0.65rem] md:text-[0.7rem]" : "text-[0.7rem] md:text-[0.8rem]";
  const showcasedAchievement = useMemo(
    () => resolveShowcasedAchievement(profile?.showcased_achievements ?? user?.showcased_achievements ?? null, achievements),
    [achievements, profile?.showcased_achievements, user?.showcased_achievements],
  );
  const showcasedAchievementDisplay = useMemo(() => {
    if (!showcasedAchievement) return null;
    return getAchievementShowcaseStyle(showcasedAchievement.rarity);
  }, [showcasedAchievement]);

  return (
    <AppPageShell bottomNavActive="missions" profile={profile} progression={progression}>
      <main className="mx-auto w-full max-w-[48rem] px-4 pb-[98px] pt-4 sm:px-5 md:px-8 md:pt-8 min-w-0">
        <div className="space-y-2 sm:space-y-4 md:space-y-6 min-w-0">
          <div className="flex w-full items-start justify-between gap-4 px-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="text-xs sm:text-sm md:text-base font-bold truncate" style={{ color: "var(--fl-color-text)" }}>{displayName}</p>
              <p className="text-[10px] sm:text-xs text-slate-400 font-medium truncate" style={{ color: "var(--fl-color-text-muted)" }}>{usernameLabel}</p>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-1 md:flex-row md:items-center md:gap-2">
              {loadingState.titles ? <LoadingBall size="sm" /> : activeTitle ? (
                <div
                  className="max-w-[10rem] sm:max-w-[14rem] rounded-full px-2 py-0.5 sm:px-3 sm:py-1 text-[9px] sm:text-[0.68rem] font-bold uppercase tracking-[0.16em] truncate"
                  style={{
                    background: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)",
                    color: "var(--app-primary-color)",
                    border: "1px solid color-mix(in srgb, var(--app-primary-color) 22%, transparent)",
                  }}
                >
                  {activeTitle.name}
                </div>
              ) : null}
              <div
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] sm:text-[0.6rem] font-black uppercase tracking-[0.15em] md:hidden shrink-0"
                style={{
                  borderColor: "color-mix(in srgb, var(--app-primary-color) 22%, transparent)",
                  background: "color-mix(in srgb, var(--fl-surface-strong) 82%, transparent)",
                  color: "var(--fl-color-text)",
                }}
              >
                {loadingState.progression ? <LoadingBall size="sm" /> : `LVL ${levelValue}`}
              </div>
            </div>
          </div>

          {error ? (
            <div className="flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 min-w-0" style={SUBTLE_PANEL_STYLE}>
              <span className="text-xs sm:text-sm truncate" style={{ color: "var(--fl-color-text)" }}>{error}</span>
              <button type="button" onClick={() => { void refreshData(); }} className="rounded-xl px-3 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-sm font-semibold shrink-0" style={PRIMARY_GLOW_STYLE}>
                Tentar novamente
              </button>
            </div>
          ) : null}


          <section className="space-y-2 sm:space-y-4 min-w-0">
            <div className="rounded-[1.5rem] sm:rounded-[2rem] px-3 py-4 sm:px-4 sm:py-5 md:px-8 md:py-6 min-w-0" style={PRIMARY_GLOW_STYLE}>
              <div className="flex min-h-[7.5rem] sm:min-h-[9.5rem] md:min-h-[10rem] flex-row items-center justify-between gap-1 sm:gap-2 min-w-0">
                <div className="flex flex-col justify-center gap-2 sm:gap-3 md:gap-4 pl-1 min-w-0">
                  <div className="inline-flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[0.64rem] md:text-[0.68rem] font-black uppercase tracking-[0.2em] sm:tracking-[0.24em] md:tracking-[0.28em] text-black/80">
                    <Cloud className="h-4 w-4" />
                    <span>Pontos de experiência</span>
                  </div>
                  <div className="inline-flex w-fit items-center gap-1.5 sm:gap-2 rounded-full px-2 py-1 md:px-4 md:py-3 text-[10px] sm:text-xs md:text-sm font-black bg-black/10 text-black">
                      <Flame className="h-4 w-4" />
                      <span>{loadingState.progression ? <LoadingBall size="sm" /> : `${progression?.current_streak ?? 0} dias de sequência`}</span>
                  </div>
                  {showcasedAchievement && showcasedAchievementDisplay ? (
                    <div className="min-w-0">
                      <div
                        className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] sm:text-xs font-bold"
                        style={{
                          borderColor: showcasedAchievementDisplay.borderColor,
                          color: showcasedAchievementDisplay.textColor,
                          backgroundColor: showcasedAchievementDisplay.backgroundColor,
                          boxShadow: showcasedAchievementDisplay.badgeShadow,
                        }}
                      >
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                          style={{
                            backgroundColor: showcasedAchievementDisplay.iconBackground,
                            color: showcasedAchievementDisplay.accent,
                          }}
                        >
                          <Award className="h-3 w-3" />
                        </span>
                        <span className="max-w-full truncate">{showcasedAchievement.name}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-1 sm:mt-2 text-[8px] sm:text-[0.6rem] md:text-xs font-black uppercase tracking-[0.15em] sm:tracking-[0.2em] text-black/60 truncate">
                    {loadingState.progression ? <LoadingBall size="sm" /> : `${formatNumber(Math.max(0, progression?.xp ?? 0))} / ${formatNumber(xpForNextLevel)} PARA O PRÓXIMO NÍVEL`}
                  </div>
                </div>

                <div className="relative flex shrink-0 items-center justify-center min-w-0">
                  <div className="h-[6.5rem] w-[7.5rem] sm:h-[8rem] sm:w-[9rem] md:h-[9.5rem] md:w-[11rem] relative shrink-0">
                    <svg viewBox="0 0 176 104" className="absolute inset-0 h-full w-full" aria-hidden="true">
                      <path
                        d="M18 86 A70 70 0 0 1 158 86"
                        fill="none"
                        stroke="rgba(0,0,0,0.15)"
                        strokeLinecap="round"
                        strokeWidth="18"
                      />
                      <path
                        d="M18 86 A70 70 0 0 1 158 86"
                        fill="none"
                        pathLength={100}
                        stroke="var(--fl-nav-item-active-text)"
                        strokeDasharray={`${xpProgress} 100`}
                        strokeLinecap="round"
                        strokeWidth="18"
                      />
                    </svg>
                    <div className="absolute inset-x-0 bottom-3 flex items-baseline justify-center gap-0.5 sm:bottom-4 md:bottom-5">
                      <span className={`${xpTextSizeClass} font-black leading-none text-black drop-shadow-sm transition-all`}>
                        {loadingState.progression ? <LoadingBall size="sm" /> : formatNumber(xpDisplayValue)}
                      </span>
                      <span className={`pb-0.5 ${xpLabelSizeClass} font-black uppercase text-black`}>XP</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 md:gap-3 min-w-0">
              <div className="min-w-0">
              <MetricCard
                label="Passos"
                value={formatNumber(stepsValue)}
                icon="directions_walk"
                loading={loadingState.metrics}
                footer={
                  <div className="mt-2 sm:mt-3 flex h-7 sm:h-9 items-end gap-1">
                    {stepBars.map((bar, index) => (
                      <div
                        key={`${bar.value}-${index}`}
                        className="w-full rounded-[0.2rem]"
                        style={{
                          height: `${bar.height}%`,
                          background: `color-mix(in srgb, var(--app-primary-color) ${Math.round(bar.opacity * 100)}%, transparent)`,
                        }}
                      />
                    ))}
                  </div>
                }
                />
              </div>
              <div className="min-w-0">
                <MetricCard label="Calorias" value={`${formatNumber(caloriesValue)} kcal`} icon="local_fire_department" sublabel="Queimadas hoje" loading={loadingState.metrics} />
              </div>
            </div>
          </section>

          <section className="px-1 pt-1 sm:px-2 min-w-0">
            <div className="flex w-full gap-1.5 sm:gap-2 justify-center min-w-0 overflow-x-auto pb-1">
              {calendarDates.map((date) => {
                const dateKey = formatDateKey(date);
                const isCurrentDay = dateKey === todayKey;
                const weekdayLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", "").toUpperCase();
                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => scrollToSection("mission-feed")}
                    className={`flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 flex-col items-center justify-center rounded-lg sm:rounded-xl ${
                      isCurrentDay
                        ? "bg-[var(--app-primary-color)] text-[var(--fl-background-color,#0f172a)] shadow-lg"
                        : "bg-transparent text-slate-400"
                    }`}
                    aria-label={`Abrir missões de ${weekdayLabel} ${String(date.getDate()).padStart(2, "0")}`}
                    style={isCurrentDay ? {
                      boxShadow: "0 8px 20px color-mix(in srgb, var(--app-primary-color) 20%, transparent)"
                    } : {}}
                  >
                    <span className="text-[9px] sm:text-[0.6rem] font-black uppercase tracking-[0.05em] sm:tracking-[0.1em]">{weekdayLabel}</span>
                    <span className="mt-0.5 text-sm sm:text-base font-black leading-none">{String(date.getDate()).padStart(2, "0")}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <SectionHeader title="Missões de Hoje" actionLabel="Ver todas" onAction={() => scrollToSection("mission-feed")} />
            <div className="rounded-[2rem] p-3 md:p-5" style={SUBTLE_PANEL_STYLE}>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.68rem] font-bold" style={{ background: "color-mix(in srgb, var(--fl-surface-strong) 86%, transparent)", color: "var(--fl-color-text-muted)", border: "1px solid var(--fl-border-soft)" }}>
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="truncate">{currentDateLabel}</span>
              </div>

              {loadingState.missions ? (
                <div className="flex items-center justify-center py-8"><LoadingBall size="md" /></div>
              ) : visibleDailyMissions.length > 0 ? (
                <div className="space-y-4">
                  {visibleDailyMissions.map((mission, index) => (
                    <div key={mission.id}>
                      <MissionCard mission={mission} onComplete={handleMissionComplete} />
                      {index < visibleDailyMissions.length - 1 ? <div className="mt-3 sm:mt-4 h-px w-full" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }} /> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.25rem] sm:rounded-[1.5rem] p-4 sm:p-5 text-xs sm:text-sm" style={PANEL_STYLE}>Nenhuma missão disponível para hoje no momento.</div>
              )}
            </div>
          </section>

          <section>
            <SectionHeader title="Passos" actionLabel="Ver todos" onAction={() => scrollToSection("assistant-tools")} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="shrink-0 whitespace-nowrap">
                <span className="text-xl font-black md:text-[1.8rem]" style={{ color: "var(--fl-color-text)" }}>{loadingState.metrics ? <LoadingBall size="sm" /> : formatNumber(stepsValue)}</span>
                <span className="ml-2 text-sm font-bold" style={{ color: "var(--fl-color-text-muted)" }}>/ {formatNumber(STEPS_TARGET)}</span>
              </div>
              <div className="relative h-3 flex-1 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--fl-color-text) 6%, transparent)" }}>
                <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${stepsProgress}%`, background: "var(--app-primary-color)" }}>
                  <div className="absolute right-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" style={{ background: "color-mix(in srgb, var(--fl-nav-item-active-text) 60%, transparent)" }} />
                </div>
              </div>
            </div>
          </section>

          {missionFeedSections.length > 0 ? (
            <section id="mission-feed" className="space-y-6">
              <SectionHeader title="Explorar Missões" />
              {missionFeedSections.map((section) => (
                <div key={section.title}>
                  <h3 className="mb-2 sm:mb-3 text-[10px] sm:text-xs md:text-sm font-black uppercase tracking-[0.12em] sm:tracking-[0.18em] truncate" style={{ color: "var(--fl-color-text-muted)" }}>{section.title}</h3>
                  <div className="rounded-[1.5rem] sm:rounded-[2rem] p-2 sm:p-3 md:p-5 min-w-0" style={SUBTLE_PANEL_STYLE}>
                    <div className="space-y-4">
                      {section.missions.map((mission, index) => (
                        <div key={mission.id}>
                          <MissionCard mission={mission} onComplete={handleMissionComplete} />
                          {index < section.missions.length - 1 ? <div className="mt-3 sm:mt-4 h-px w-full" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }} /> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          <section id="assistant-tools" className="space-y-2 sm:space-y-4 min-w-0">
            <SectionHeader title="Ferramentas de IA" />
            <AIMissionGenerator onMissionsGenerated={() => { void refreshData(); }} />
            <AIRecommendations />
          </section>
        </div>
      </main>

      <div
        ref={quickActionsRef}
        className="fl-z-fab fixed bottom-24 right-4 flex flex-col items-end gap-3 md:bottom-8 md:right-8"
      >
        <div
          className={`flex flex-col items-end gap-3 transition-all duration-200 ${quickActionsOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}
        >
          <button
            type="button"
            onClick={() => handleQuickAction(ROUTE_PATHS.aiChat)}
            className="flex items-center gap-3 rounded-full px-4 py-3 text-sm font-bold shadow-lg transition-transform hover:-translate-y-0.5"
            style={PANEL_STYLE}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)", color: "var(--app-primary-color)" }}
            >
              <Bot className="h-5 w-5" />
            </span>
            <span style={{ color: "var(--fl-color-text)" }}>FitBot</span>
          </button>

          <button
            type="button"
            onClick={() => handleQuickAction(ROUTE_PATHS.foodAnalysis)}
            className="flex items-center gap-3 rounded-full px-4 py-3 text-sm font-bold shadow-lg transition-transform hover:-translate-y-0.5"
            style={PANEL_STYLE}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)", color: "var(--app-primary-color)" }}
            >
              <Camera className="h-5 w-5" />
            </span>
            <span style={{ color: "var(--fl-color-text)" }}>Analisar Alimento</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setQuickActionsOpen((current) => !current)}
          className="flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-200"
          style={PRIMARY_GLOW_STYLE}
          aria-label="Abrir acoes rapidas"
          aria-expanded={quickActionsOpen}
        >
          <Zap className={`h-6 w-6 transition-transform duration-200 ${quickActionsOpen ? "rotate-12" : ""}`} />
        </button>
      </div>

      {showLevelUp ? <LevelUpModal level={newLevel} onClose={() => setShowLevelUp(false)} /> : null}
    </AppPageShell>
  );
}
