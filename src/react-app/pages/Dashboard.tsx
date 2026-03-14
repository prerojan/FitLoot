import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Avatar } from "@/react-app/components/ui/avatar";
import { useAuth } from "@/react-app/contexts/auth";
import BottomNav from "@/react-app/components/BottomNav";
import MissionCard from "@/react-app/components/MissionCard";
import LevelUpModal from "@/react-app/components/LevelUpModal";
import AIRecommendations from "@/react-app/components/AIRecommendations";
import AIMissionGenerator from "@/react-app/components/AIMissionGenerator";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Bot, CalendarDays, Camera, Cloud, Flame } from "lucide-react";
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
  primaryMissionLabel,
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
  const checklistMissions = useMemo(() => allDailyMissions.slice(0, 2), [allDailyMissions]);
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

  const xpForNextLevel = Math.max(100, (progression?.level || 1) * 100);
  const xpProgress = clamp(((progression?.xp || 0) / xpForNextLevel) * 100, 0, 100);
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

  const displayName = profile?.full_name ?? user?.name ?? "Seu dashboard";
  const usernameLabel = profile?.username ? `@${profile.username}` : user?.email ?? "fitloot";
  const avatarName = profile?.full_name ?? user?.name ?? profile?.username ?? "FitLoot";

  const scrollToSection = useCallback((sectionId: string) => {
    const section = document.getElementById(sectionId);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header
        className="sticky top-0 z-40 hidden md:block"
        style={{
          background: "color-mix(in srgb, var(--fl-surface-strong) 90%, transparent)",
          borderBottom: "1px solid color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
          backdropFilter: "blur(18px)",
        }}
      >
        <div className="mx-auto flex max-w-[82rem] items-center justify-between gap-6 px-6 py-4 lg:px-12">
          <button type="button" onClick={() => navigate("/dashboard")} className="flex items-center gap-4" aria-label="Abrir dashboard">
            <div style={{ color: "var(--app-primary-color)" }}>
              <svg fill="none" viewBox="0 0 48 48" className="h-8 w-8" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4H17.3334V17.3334H30.6666V30.6666H44V44H4V4Z" fill="currentColor" />
              </svg>
            </div>
            <span className="text-xl font-bold uppercase tracking-[0.12em]" style={{ color: "var(--fl-color-text)" }}>FitLoot</span>
          </button>

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

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: "color-mix(in srgb, var(--app-primary-color) 16%, transparent)", color: "var(--app-primary-color)" }}
              aria-label="Abrir configuracoes"
            >
              <MaterialIcon name="settings" filled className="text-2xl" />
            </button>
            <button type="button" onClick={() => navigate("/profile")} className="rounded-full" aria-label="Abrir perfil">
              <span className="flex rounded-full border-2 p-[2px]" style={{ borderColor: "var(--app-primary-color)" }}>
                <Avatar src={user?.avatar_url ?? null} name={avatarName} className="h-10 w-10 object-cover" />
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[46rem] px-4 pb-12 pt-4 md:px-8 md:pt-8">
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
            <div className="rounded-[2rem] px-6 py-6" style={PRIMARY_GLOW_STYLE}>
              <div className="flex items-center justify-between gap-6">
                <div className="flex min-h-[8rem] flex-1 flex-col justify-between">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.64rem] font-black uppercase tracking-[0.28em]" style={{ background: "color-mix(in srgb, var(--fl-nav-item-active-text) 8%, transparent)" }}>
                      <Cloud className="h-3.5 w-3.5" />
                      <span>Pontos de Experiencia</span>
                      <span className="opacity-65">Nivel {progression?.level ?? 1}</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-black" style={{ background: "color-mix(in srgb, var(--fl-nav-item-active-text) 10%, transparent)" }}>
                      <Flame className="h-4 w-4" />
                      <span>{loadingState.progression ? <LoadingBall size="sm" /> : `${progression?.current_streak ?? 0} dias de sequencia`}</span>
                    </div>
                  </div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] opacity-70">Progresso atual para o proximo nivel</p>
                </div>

                <div className="relative flex shrink-0 flex-col items-center justify-end">
                  <svg viewBox="0 0 120 72" className="h-20 w-36">
                    <path d="M18 62 A42 42 0 0 1 102 62" fill="none" stroke="color-mix(in srgb, var(--fl-nav-item-active-text) 18%, transparent)" strokeLinecap="round" strokeWidth="10" />
                    <path d="M18 62 A42 42 0 0 1 102 62" fill="none" pathLength={100} stroke="var(--fl-nav-item-active-text)" strokeDasharray={`${xpProgress} 100`} strokeLinecap="round" strokeWidth="10" />
                  </svg>
                  <div className="absolute bottom-0 flex items-end gap-1">
                    <span className="text-4xl font-black">{loadingState.progression ? <LoadingBall size="sm" /> : formatNumber(progression?.xp ?? 0)}</span>
                    <span className="pb-2 text-xs font-bold uppercase opacity-70">XP</span>
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
                    {[28, 62, 100, 74, 46].map((height, index) => (
                      <div
                        key={`${height}-${index}`}
                        className="w-full rounded-[0.2rem]"
                        style={{
                          height: `${height}%`,
                          background: index === 2 ? "var(--app-primary-color)" : `color-mix(in srgb, var(--app-primary-color) ${26 + index * 14}%, transparent)`,
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

          <section>
            <SectionHeader title="Checklist de Treino" actionLabel="Ver todos" onAction={() => scrollToSection("mission-feed")} />
            <div className="rounded-[2rem] p-5" style={SUBTLE_PANEL_STYLE}>
              {loadingState.missions ? (
                <div className="flex items-center justify-center py-6"><LoadingBall size="md" /></div>
              ) : checklistMissions.length > 0 ? (
                <div className="space-y-4">
                  {checklistMissions.map((mission, index) => (
                    <div key={mission.id}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.68rem] font-black" style={PRIMARY_GLOW_STYLE}>
                            <MaterialIcon name="schedule" className="text-[1rem]" filled />
                            <span>{mission.duration_estimate_minutes ?? 10} minutos</span>
                          </div>
                          <span className="truncate font-bold" style={{ color: "var(--fl-color-text)" }}>{primaryMissionLabel(mission)}</span>
                        </div>
                        <div className="flex h-7 w-7 items-center justify-center rounded-full border-2" style={{ borderColor: isMissionCompleted(mission) ? "var(--app-primary-color)" : "color-mix(in srgb, var(--fl-color-text-muted) 46%, transparent)" }}>
                          {isMissionCompleted(mission) ? <div className="h-4 w-4 rounded-full" style={{ background: "var(--app-primary-color)" }} /> : null}
                        </div>
                      </div>
                      {index < checklistMissions.length - 1 ? <div className="mt-4 h-px w-full" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }} /> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.5rem] p-5 text-sm" style={PANEL_STYLE}>O checklist de treino vai aparecer aqui assim que novas missoes forem geradas.</div>
              )}
            </div>
          </section>

          <section id="assistant-tools">
            <SectionHeader title="Acoes Rapidas" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => navigate("/ai-chat")} className="flex items-center justify-between rounded-[1.75rem] p-4 text-left transition-transform hover:-translate-y-0.5" style={PANEL_STYLE}>
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--fl-color-text)" }}>Assistente IA</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--fl-color-text-muted)" }}>Abra o chat para suporte tecnico e motivacional.</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)" }}>
                  <Bot className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                </div>
              </button>

              <button type="button" onClick={() => navigate("/food-analysis")} className="flex items-center justify-between rounded-[1.75rem] p-4 text-left transition-transform hover:-translate-y-0.5" style={PANEL_STYLE}>
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--fl-color-text)" }}>Analise de alimentos</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--fl-color-text-muted)" }}>Envie fotos e acompanhe calorias pelo scanner.</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)" }}>
                  <Camera className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                </div>
              </button>
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

          <section className="space-y-4">
            <SectionHeader title="Ferramentas de IA" />
            <AIMissionGenerator onMissionsGenerated={() => { void refreshData(); }} {...(profile?.initial_conditioning ? { conditioning: profile.initial_conditioning } : {})} />
            <AIRecommendations />
          </section>
        </div>
      </main>

      <div className="md:hidden"><BottomNav active="missions" /></div>
      {showLevelUp ? <LevelUpModal level={newLevel} onClose={() => setShowLevelUp(false)} /> : null}
    </div>
  );
}
