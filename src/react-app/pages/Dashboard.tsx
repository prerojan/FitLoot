import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import BottomNav from "@/react-app/components/BottomNav";
import MissionCard from "@/react-app/components/MissionCard";
import LevelUpModal from "@/react-app/components/LevelUpModal";
import AIRecommendations from "@/react-app/components/AIRecommendations";
import AIMissionGenerator from "@/react-app/components/AIMissionGenerator";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Flame, Footprints, Target, Zap, Bot, Camera } from "lucide-react";
import type { Mission, UserProgression, DailyMetrics, UserProfile, Title } from "@/shared/types";
import { ApiRequestError, api, clearJsonCache, fetchAndCacheJson, prefetchJson, readCachedJson } from "@/react-app/utils/api";

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
      const active = cacheTitles.data.find((title) => title.is_active === 1) ?? null;
      setActiveTitle(active);
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
      const mustFetch = forceRefresh || !hasCachedEntry || stale;
      if (!mustFetch) {
        setSectionLoading(section, false);
        return;
      }

      try {
        const payload = await fetchAndCacheJson<T>(path);
        onSuccess(payload);
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
      runRequest<UserProfile>(
        "profile",
        "/api/profile",
        Boolean(cacheProfile),
        Boolean(cacheProfile?.stale),
        (payload) => setProfile(payload),
        () => {
          shouldRedirectToOnboarding = true;
        }
      ),
      runRequest<UserProgression>(
        "progression",
        "/api/progression",
        Boolean(cacheProgression),
        Boolean(cacheProgression?.stale),
        (payload) => setProgression(payload)
      ),
      runRequest<Mission[]>(
        "missions",
        "/api/missions",
        Boolean(cacheMissions),
        Boolean(cacheMissions?.stale),
        (payload) => setMissions(Array.isArray(payload) ? payload : [])
      ),
      runRequest<DailyMetrics>(
        "metrics",
        "/api/metrics/today",
        Boolean(cacheMetrics),
        Boolean(cacheMetrics?.stale),
        (payload) => setMetrics(payload)
      ),
      runRequest<Array<Title & { is_active?: number | undefined }>>(
        "titles",
        "/api/titles",
        Boolean(cacheTitles),
        Boolean(cacheTitles?.stale),
        (payload) => {
          const active = (Array.isArray(payload) ? payload : []).find((title) => title.is_active === 1) ?? null;
          setActiveTitle(active);
        }
      ),
    ]);

    if (shouldRedirectToApp) {
      navigate("/app");
      return;
    }

    if (shouldRedirectToOnboarding) {
      navigate("/onboarding");
      return;
    }

    if (hasRequestError) {
      return;
    }
  }, [navigate, setSectionLoading]);

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
        setError(payload?.error ?? "Não foi possível concluir a missão.");
        return;
      }

      const result = (await response.json()) as { leveledUp?: boolean | undefined };

      setMissions((currentMissions) =>
        currentMissions.filter((mission) => mission.id !== missionId),
      );

      if (result.leveledUp) {
        clearJsonCache("/api/progression");
        try {
          const updatedProgression = await fetchAndCacheJson<UserProgression>("/api/progression");
          setNewLevel(Number(updatedProgression.level ?? 0));
          setShowLevelUp(true);
        } catch {
          // Non-blocking: dashboard refresh below will reconcile progression state.
        }
      }

      await refreshData();
    } catch {
      setError("Não foi possível concluir a missão agora.");
    }
  };

  const dailyMissions = useMemo(
    () => missions.filter((mission) => mission.type === "daily" && mission.is_completed !== 1 && mission.mission_origin !== "ai"),
    [missions],
  );
  const failedMissions = useMemo(
    () => missions.filter((mission) => mission.status === "failed" && mission.is_completed !== 1 && mission.mission_origin !== "ai"),
    [missions],
  );
  const weeklyMissions = useMemo(
    () => missions.filter((mission) => mission.type === "weekly" && mission.is_completed !== 1 && mission.status !== "failed" && mission.mission_origin !== "ai"),
    [missions],
  );
  const monthlyMissions = useMemo(
    () => missions.filter((mission) => mission.type === "monthly" && mission.is_completed !== 1 && mission.status !== "failed" && mission.mission_origin !== "ai"),
    [missions],
  );
  const aiSpecialMissions = useMemo(
    () => missions.filter((mission) => mission.mission_origin === "ai" && mission.is_completed !== 1),
    [missions],
  );

  const xpForNextLevel = Math.max(100, (progression?.level || 1) * 100);
  const xpProgress = Math.min(100, ((progression?.xp || 0) / xpForNextLevel) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-6 rounded-b-3xl shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">{profile?.full_name ?? "Seu dashboard"}</h1>
            <p className="text-emerald-100 text-sm">@{profile?.username ?? "carregando"}</p>
            {loadingState.titles ? (
              <div className="inline-flex mt-2"><LoadingBall size="sm" /></div>
            ) : activeTitle ? (
              <div className="inline-block mt-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-medium">
                {activeTitle.name}
              </div>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">Nv {progression?.level ?? 1}</div>
            <div className="text-emerald-100 text-sm">{progression?.xp ?? 0}/{xpForNextLevel} XP</div>
          </div>
        </div>

        <div className="bg-white/20 backdrop-blur-sm rounded-full h-3 overflow-hidden">
          <div
            className="bg-white h-full rounded-full transition-all duration-500"
            style={{ width: `${xpProgress}%` }}
          />
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatCard
            icon={<Flame className="w-5 h-5" />}
            label="Streak"
            value={`${progression?.current_streak ?? 0}d`}
            loading={loadingState.progression}
          />
          <StatCard
            icon={<Footprints className="w-5 h-5" />}
            label="Passos"
            value={metrics?.steps?.toLocaleString() || "0"}
            loading={loadingState.metrics}
          />
          <StatCard
            icon={<Zap className="w-5 h-5" />}
            label="Calorias"
            value={metrics?.calories_burned ?? 0}
            loading={loadingState.metrics}
          />
        </div>
      </div>

      {error && (
        <div className="px-6 pt-4">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => { void refreshData(); }} className="fl-btn-primary rounded-lg px-3 py-1 text-xs">Tentar novamente</button>
          </div>
        </div>
      )}

      <div className="px-6 py-6 space-y-6">
        <AIMissionGenerator
          onMissionsGenerated={() => { void refreshData(); }}
          {...(profile?.initial_conditioning ? { conditioning: profile.initial_conditioning } : {})}
        />

        {loadingState.missions ? (
          <div className="fl-card p-5 flex items-center justify-center">
            <LoadingBall size="md" />
          </div>
        ) : (
          <>
            <MissionSection
              title="Missões Diárias"
              icon={<Target className="w-5 h-5" />}
              missions={dailyMissions}
              onComplete={handleMissionComplete}
            />

            {aiSpecialMissions.length > 0 && (
              <MissionSection
                title="Missões Especiais IA"
                icon={<Bot className="w-5 h-5" />}
                missions={aiSpecialMissions}
                onComplete={handleMissionComplete}
              />
            )}

            {failedMissions.length > 0 && (
              <MissionSection
                title="Missões Expiradas"
                icon={<Target className="w-5 h-5" />}
                missions={failedMissions}
                onComplete={handleMissionComplete}
              />
            )}

            {weeklyMissions.length > 0 && (
              <MissionSection
                title="Missões Semanais"
                icon={<Target className="w-5 h-5" />}
                missions={weeklyMissions}
                onComplete={handleMissionComplete}
              />
            )}

            {monthlyMissions.length > 0 && (
              <MissionSection
                title="Missões Mensais"
                icon={<Target className="w-5 h-5" />}
                missions={monthlyMissions}
                onComplete={handleMissionComplete}
              />
            )}
          </>
        )}

        <AIRecommendations />
      </div>

      <button
        onClick={() => navigate("/ai-chat")}
        className="fixed bottom-28 right-6 bg-emerald-600 text-white p-4 rounded-full shadow-lg hover:bg-emerald-700 transition-all"
      >
        <Bot className="w-6 h-6" />
      </button>

      <button
        onClick={() => navigate("/food-analysis")}
        className="fixed bottom-28 left-6 bg-teal-600 text-white p-4 rounded-full shadow-lg hover:bg-teal-700 transition-all"
      >
        <Camera className="w-6 h-6" />
      </button>

      <BottomNav active="missions" />

      {showLevelUp && (
        <LevelUpModal
          level={newLevel}
          onClose={() => setShowLevelUp(false)}
        />
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-3 text-center min-h-[76px] flex flex-col items-center justify-center">
      <div className="flex justify-center mb-1">{icon}</div>
      <div className="text-xs text-emerald-100">{label}</div>
      <div className="text-lg font-bold mt-1">{loading ? <LoadingBall size="sm" /> : value}</div>
    </div>
  );
}

function MissionSection({
  title,
  icon,
  missions,
  onComplete,
}: {
  title: string;
  icon: React.ReactNode;
  missions: Mission[];
  onComplete: (id: number, reps: number, verified: boolean) => Promise<void> | void;
}) {
  if (missions.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="text-emerald-600">{icon}</div>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <div className="text-sm text-gray-500">({missions.length})</div>
      </div>
      <div className="space-y-3">
        {missions.map((mission) => (
          <MissionCard key={mission.id} mission={mission} onComplete={onComplete} />
        ))}
      </div>
    </div>
  );
}

