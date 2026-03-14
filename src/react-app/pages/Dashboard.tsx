import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Avatar } from "@/react-app/components/ui/avatar";
import { useAuth } from "@/react-app/contexts/auth";
import BottomNav from "@/react-app/components/BottomNav";
import MissionCard from "@/react-app/components/MissionCard";
import LevelUpModal from "@/react-app/components/LevelUpModal";
import AIRecommendations from "@/react-app/components/AIRecommendations";
import AIMissionGenerator from "@/react-app/components/AIMissionGenerator";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Bot, CalendarDays, Camera, Cloud, Flame, Zap } from "lucide-react";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import type { DailyMetrics, Mission, Title, UserProfile, UserProgression } from "@/shared/types";
import {
  ApiRequestError,
  api,
  clearJsonCache,
  fetchAndCacheJson,
  prefetchJson,
  readCachedJson,
} from "@/react-app/utils/api";
import {
  MetricCard,
  MaterialIcon,
  SectionHeader,
} from "@/react-app/pages/dashboardHelpers";
import {
  DESKTOP_NAV_ITEMS,
  PANEL_STYLE,
  PRIMARY_GLOW_STYLE,
  STEPS_TARGET,
  SUBTLE_PANEL_STYLE,
  buildWeekDates,
  capitalizeLabel,
  clamp,
  ensureMaterialSymbolsLoaded,
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

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null);
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
    const cacheTitles = readCachedJson<Array<Title & { is_active?: number | undefined }>>("/api/titles");

    if (cacheProfile) setProfile(cacheProfile.data);
    if (cacheProgression) setProgression(cacheProgression.data);
    if (cacheMissions) setMissions(Array.isArray(cacheMissions.data) ? cacheMissions.data : []);
    if (cacheMetrics) setMetrics(cacheMetrics.data);
    if (cacheTitles) {
      setActiveTitle(cacheTitles.data.find((title) => title.is_active === 1) ?? null);
    }

    setLoadingState({
      profile: forceRefresh || !cacheProfile,
      progression: forceRefresh || !cacheProgression,
      missions: forceRefresh || !cacheMissions,
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
          setError("Nao foi possivel carregar todos os dados do dashboard agora.");
        }
      } finally {
        setSectionLoading(section, false);
      }
    };

    await Promise.all([
      runRequest<UserProfile>("profile", "/api/profile", Boolean(cacheProfile), Boolean(cacheProfile?.stale), setProfile, () => {
        shouldRedirectToOnboarding = true;
      }),
      runRequest<UserProgression>("progression", "/api/progression", Boolean(cacheProgression), Boolean(cacheProgression?.stale), setProgression),
      runRequest<Mission[]>("missions", "/api/missions", Boolean(cacheMissions), Boolean(cacheMissions?.stale), (payload) => {
        setMissions(Array.isArray(payload) ? payload : []);
      }),
      runRequest<DailyMetrics>("metrics", "/api/metrics/today", Boolean(cacheMetrics), Boolean(cacheMetrics?.stale), setMetrics),
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
    ensureMaterialSymbolsLoaded();
  }, []);

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
    void import("@/react-app/pages/Arena");
    void import("@/react-app/pages/Shop");
    void import("@/react-app/pages/Ranking");
    void import("@/react-app/pages/AIChat");
    void import("@/react-app/pages/FoodAnalysis");
    void prefetchJson("/api/profile");
    void prefetchJson("/api/progression");
    void prefetchJson("/api/missions");
    void prefetchJson("/api/metrics/today");
    void prefetchJson("/api/titles");
  }, []);

  const refreshData = useCallback(async () => {
    clearJsonCache("/api/profile");
    clearJsonCache("/api/progression");
    clearJsonCache("/api/missions");
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
        setError(payload?.error ?? "Nao foi possivel concluir a missao.");
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
      setError("Nao foi possivel concluir a missao agora.");
    }
  };

  const allDailyMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.type === "daily" && mission.mission_origin !== "ai")),
    [missions],
  );
  const visibleDailyMissions = useMemo(() => allDailyMissions.slice(0, 3), [allDailyMissions]);
  const aiSpecialMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.mission_origin === "ai" && mission.is_completed !== 1)),
    [missions],
  );
  const weeklyMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.type === "weekly" && mission.is_completed !== 1 && mission.status !== "failed" && mission.mission_origin !== "ai")),
    [missions],
  );
  const monthlyMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.type === "monthly" && mission.is_completed !== 1 && mission.status !== "failed" && mission.mission_origin !== "ai")),
    [missions],
  );
  const failedMissions = useMemo(
    () => sortMissions(missions.filter((mission) => mission.status === "failed" && mission.is_completed !== 1 && mission.mission_origin !== "ai")),
    [missions],
  );
  const missionFeedSections = useMemo(
    () =>
      [
        { title: "Todas as missoes de hoje", missions: allDailyMissions },
        { title: "Missoes especiais da IA", missions: aiSpecialMissions },
        { title: "Missoes semanais", missions: weeklyMissions },
        { title: "Missoes mensais", missions: monthlyMissions },
        { title: "Missoes expiradas", missions: failedMissions },
      ].filter((section) => section.missions.length > 0),
    [aiSpecialMissions, allDailyMissions, failedMissions, monthlyMissions, weeklyMissions],
  );

  const stepsValue = metrics?.steps ?? 0;
  const caloriesValue = metrics?.calories_burned ?? 0;
  const stepsProgress = clamp((stepsValue / STEPS_TARGET) * 100, 0, 100);
  const todayKey = useMemo(() => formatDateKey(new Date()), []);
  const weekDates = useMemo(() => buildWeekDates(new Date()), []);
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
  const avatarName = profile?.full_name ?? user?.name ?? profile?.username ?? "FitLoot";

  const scrollToSection = useCallback((sectionId: string) => {
    const section = document.getElementById(sectionId);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const handleQuickAction = useCallback((path: string) => {
    setQuickActionsOpen(false);
    navigate(path);
  }, [navigate]);

  return (
    <div className="min-h-screen pb-32 md:pb-14">
      <header
        className="sticky top-0 z-40 hidden md:block"
        style={{
          background: "color-mix(in srgb, var(--fl-surface-strong) 90%, transparent)",
          borderBottom: "1px solid color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
          backdropFilter: "blur(18px)",
        }}
      >
        <div className="mx-auto grid max-w-[82rem] grid-cols-[auto_1fr_auto] items-center gap-6 px-6 py-4 lg:px-12">
          <button type="button" onClick={() => navigate(ROUTE_PATHS.dashboard)} className="flex items-center gap-4" aria-label="Abrir dashboard">
            <div style={{ color: "var(--app-primary-color)" }}>
              <svg fill="none" viewBox="0 0 48 48" className="h-8 w-8" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4H17.3334V17.3334H30.6666V30.6666H44V44H4V4Z" fill="currentColor" />
              </svg>
            </div>
            <span className="text-xl font-bold uppercase tracking-[0.12em]" style={{ color: "var(--fl-color-text)" }}>FitLoot</span>
          </button>

          <div className="flex items-center justify-center gap-4">
            <div
              className="inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.22em]"
              style={{
                borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
                background: "color-mix(in srgb, var(--fl-surface-strong) 74%, transparent)",
                color: "var(--fl-color-text)",
              }}
            >
              {loadingState.progression ? <LoadingBall size="sm" /> : `LVL ${progression?.level ?? 1}`}
            </div>

            <nav className="flex items-center gap-1">
              {DESKTOP_NAV_ITEMS.map((item) => {
                const isActive = item.matches.some((path) => path === location.pathname);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-colors hover:opacity-85"
                    style={isActive ? {
                      background: "var(--app-primary-color)",
                      color: "var(--fl-nav-item-active-text)",
                      boxShadow: "0 0 22px color-mix(in srgb, var(--app-primary-color) 34%, transparent)",
                    } : { color: "var(--fl-nav-item-muted)" }}
                  >
                    <MaterialIcon name={item.icon} filled={isActive} className="text-xl" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate(ROUTE_PATHS.profile)}
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: "color-mix(in srgb, var(--app-primary-color) 16%, transparent)", color: "var(--app-primary-color)" }}
              aria-label="Abrir configuracoes"
            >
              <MaterialIcon name="settings" filled className="text-2xl" />
            </button>
            <button type="button" onClick={() => navigate(ROUTE_PATHS.profile)} className="rounded-full" aria-label="Abrir perfil">
              <span className="flex rounded-full border-2 p-[2px]" style={{ borderColor: "var(--app-primary-color)" }}>
                <Avatar src={user?.avatar_url ?? null} name={avatarName} className="h-10 w-10 object-cover" />
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[46rem] px-4 pb-16 pt-4 md:px-8 md:pt-8">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 px-1">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--fl-color-text)" }}>{displayName}</p>
              <p className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>{usernameLabel}</p>
            </div>
            {loadingState.titles ? <LoadingBall size="sm" /> : activeTitle ? (
              <div
                className="rounded-full px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em]"
                style={{
                  background: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)",
                  color: "var(--app-primary-color)",
                  border: "1px solid color-mix(in srgb, var(--app-primary-color) 22%, transparent)",
                }}
              >
                {activeTitle.name}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="flex flex-col gap-3 rounded-[1.75rem] p-4 sm:flex-row sm:items-center sm:justify-between" style={SUBTLE_PANEL_STYLE}>
              <span className="text-sm" style={{ color: "var(--fl-color-text)" }}>{error}</span>
              <button type="button" onClick={() => { void refreshData(); }} className="rounded-xl px-4 py-2 text-sm font-semibold" style={PRIMARY_GLOW_STYLE}>
                Tentar novamente
              </button>
            </div>
          ) : null}

          <section className="space-y-4">
            <div className="rounded-[2rem] px-6 py-6 md:px-8" style={PRIMARY_GLOW_STYLE}>
              <div className="flex min-h-[9.25rem] items-center justify-between gap-6">
                <div className="flex flex-1 flex-col justify-center gap-5">
                  <div className="inline-flex items-center gap-2 text-[0.68rem] font-black uppercase tracking-[0.28em]">
                    <Cloud className="h-3.5 w-3.5" />
                    <span>Experience Points</span>
                  </div>
                  <div className="inline-flex w-fit items-center gap-2 rounded-full px-4 py-3 text-sm font-black" style={{ background: "color-mix(in srgb, var(--fl-nav-item-active-text) 10%, transparent)" }}>
                    <Flame className="h-4 w-4" />
                    <span>{loadingState.progression ? <LoadingBall size="sm" /> : `${progression?.current_streak ?? 0}-Day Streak`}</span>
                  </div>
                </div>

                <div className="relative flex h-[6.6rem] w-[12.5rem] shrink-0 items-end justify-center">
                  <svg viewBox="0 0 176 104" className="absolute inset-x-0 top-0 h-[5.5rem] w-full">
                    <path d="M26 86 A62 62 0 0 1 150 86" fill="none" stroke="var(--fl-nav-item-active-text)" strokeLinecap="round" strokeWidth="14" />
                  </svg>
                  <div className="absolute bottom-0 flex items-end gap-1">
                    <span className="text-[2.35rem] font-black leading-none">{loadingState.progression ? <LoadingBall size="sm" /> : formatNumber(progression?.xp ?? 0)}</span>
                    <span className="pb-1 text-xs font-black uppercase opacity-75">XP</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label="Passos"
                value={formatNumber(stepsValue)}
                icon="directions_walk"
                loading={loadingState.metrics}
                footer={
                  <div className="mt-3 flex h-9 items-end gap-1">
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
              <MetricCard label="Calorias" value={`${formatNumber(caloriesValue)} kcal`} icon="local_fire_department" sublabel="Queimadas hoje" loading={loadingState.metrics} />
            </div>
          </section>

          <section className="px-2 pt-1">
            <div className="grid grid-cols-7 gap-2">
              {weekDates.map((date) => {
                const dateKey = formatDateKey(date);
                const isCurrentDay = dateKey === todayKey;
                const isCompletedDay = completedWeekKeys.has(dateKey);
                const weekdayLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", "").toUpperCase();
                return (
                  <div
                    key={dateKey}
                    className={`flex flex-col items-center rounded-[1.35rem] px-1 py-2 ${isCurrentDay ? "shadow-lg" : ""}`}
                    style={isCurrentDay ? {
                      background: "var(--app-primary-color)",
                      color: "var(--fl-nav-item-active-text)",
                      boxShadow: "0 12px 26px color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                    } : { color: "var(--fl-color-text-muted)" }}
                  >
                    <span className="text-[0.64rem] font-black uppercase tracking-[0.18em]">{weekdayLabel}</span>
                    <span className="mt-1 text-lg font-black">{String(date.getDate()).padStart(2, "0")}</span>
                    <span className="mt-2 h-1.5 w-1.5 rounded-full" style={{ background: isCompletedDay ? (isCurrentDay ? "color-mix(in srgb, var(--fl-nav-item-active-text) 72%, transparent)" : "color-mix(in srgb, var(--app-primary-color) 72%, transparent)") : "transparent" }} />
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <SectionHeader title="Missoes de Hoje" actionLabel="Ver todas" onAction={() => scrollToSection("mission-feed")} />
            <div className="rounded-[2rem] p-5" style={SUBTLE_PANEL_STYLE}>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.68rem] font-bold" style={{ background: "color-mix(in srgb, var(--fl-surface-strong) 86%, transparent)", color: "var(--fl-color-text-muted)", border: "1px solid var(--fl-border-soft)" }}>
                <CalendarDays className="h-3.5 w-3.5" />
                <span>{currentDateLabel}</span>
              </div>

              {loadingState.missions ? (
                <div className="flex items-center justify-center py-8"><LoadingBall size="md" /></div>
              ) : visibleDailyMissions.length > 0 ? (
                <div className="space-y-4">
                  {visibleDailyMissions.map((mission, index) => (
                    <div key={mission.id}>
                      <MissionCard mission={mission} onComplete={handleMissionComplete} layout="compact" />
                      {index < visibleDailyMissions.length - 1 ? <div className="mt-4 h-px w-full" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }} /> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.5rem] p-5 text-sm" style={PANEL_STYLE}>Nenhuma missao disponivel para hoje no momento.</div>
              )}
            </div>
          </section>

          <section>
            <SectionHeader title="Passos" actionLabel="Ver todos" onAction={() => scrollToSection("assistant-tools")} />
            <div className="flex items-center gap-4">
              <div className="shrink-0 whitespace-nowrap">
                <span className="text-[1.8rem] font-black" style={{ color: "var(--fl-color-text)" }}>{loadingState.metrics ? <LoadingBall size="sm" /> : formatNumber(stepsValue)}</span>
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
              <SectionHeader title="Explorar Missoes" />
              {missionFeedSections.map((section) => (
                <div key={section.title}>
                  <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em]" style={{ color: "var(--fl-color-text-muted)" }}>{section.title}</h3>
                  <div className="rounded-[2rem] p-5" style={SUBTLE_PANEL_STYLE}>
                    <div className="space-y-4">
                      {section.missions.map((mission, index) => (
                        <div key={mission.id}>
                          <MissionCard mission={mission} onComplete={handleMissionComplete} layout="compact" />
                          {index < section.missions.length - 1 ? <div className="mt-4 h-px w-full" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }} /> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          <section id="assistant-tools" className="space-y-4">
            <SectionHeader title="Ferramentas de IA" />
            <AIMissionGenerator onMissionsGenerated={() => { void refreshData(); }} {...(profile?.initial_conditioning ? { conditioning: profile.initial_conditioning } : {})} />
            <AIRecommendations />
          </section>
        </div>
      </main>

      <div
        ref={quickActionsRef}
        className="fixed bottom-24 left-4 z-50 flex flex-col items-start gap-3 md:bottom-8 md:left-8"
      >
        <div
          className={`flex flex-col items-start gap-3 transition-all duration-200 ${quickActionsOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}
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

      <div className="md:hidden"><BottomNav active="missions" /></div>
      {showLevelUp ? <LevelUpModal level={newLevel} onClose={() => setShowLevelUp(false)} /> : null}
    </div>
  );
}
