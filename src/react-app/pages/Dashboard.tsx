import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import BottomNav from "@/react-app/components/BottomNav";
import MissionCard from "@/react-app/components/MissionCard";
import LevelUpModal from "@/react-app/components/LevelUpModal";
import AIRecommendations from "@/react-app/components/AIRecommendations"
import AIMissionGenerator from "@/react-app/components/AIMissionGenerator"
import { Flame, Footprints, Target, Zap } from "lucide-react";
import { Bot } from "lucide-react";
import { Camera } from "lucide-react";
import type { Mission, UserProgression, DailyMetrics, UserProfile, Title } from "@/shared/types";
import { api } from "@/react-app/utils/api";
import PageLoader from "@/react-app/components/PageLoader";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null);
  const [activeTitle, setActiveTitle] = useState<Title | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [newLevel, setNewLevel] = useState(0);


  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [profileRes, progressionRes, missionsRes, metricsRes, titlesRes] = await Promise.all([
        api("/api/profile"),
        api("/api/progression"),
        api("/api/missions"),
        api("/api/metrics/today"),
        api("/api/titles"),
      ]);

      if (profileRes.status === 401 || profileRes.status === 403) {
        navigate("/app");
        return;
      }

      if (profileRes.status === 404) {
        navigate("/onboarding");
        return;
      }

      if (!profileRes.ok || !progressionRes.ok || !missionsRes.ok || !metricsRes.ok || !titlesRes.ok) {
        throw new Error("Falha ao carregar dados do dashboard.");
      }

      const profileData = await profileRes.json();
      const progressionData = await progressionRes.json();
      const missionsData = await missionsRes.json();
      const metricsData = await metricsRes.json();
      const titlesData = await titlesRes.json();

      setProfile(profileData);
      setProgression(progressionData);
      setMissions(Array.isArray(missionsData) ? missionsData : []);
      setMetrics(metricsData);

      const active = (Array.isArray(titlesData) ? titlesData : []).find((t: { is_active?: number | undefined }) => t.is_active === 1);
      setActiveTitle(active || null);
    } catch (loadError) {
      console.error("Error loading data:", loadError);
      setError("Não foi possível carregar o dashboard agora.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }

    void loadData();
  }, [user, navigate, loadData]);

  const handleMissionComplete = async (missionId: number, reps: number, verified: boolean) => {
    try {
      const response = await api("/api/missions/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_id: missionId,
          reps_completed: reps,
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

      const result = await response.json();

      if (result.leveledUp) {
        const progressionResponse = await api("/api/progression");
        if (progressionResponse.ok) {
          const updatedProgression = await progressionResponse.json();
          setNewLevel(Number(updatedProgression.level ?? 0));
          setShowLevelUp(true);
        }
      }

      await loadData();
    } catch (completeError) {
      console.error("Error completing mission:", completeError);
      setError("Não foi possível concluir a missão agora.");
    }
  };

  if (loading) {
    return <PageLoader />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
        <div className="px-6 py-12 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => { setLoading(true); void loadData(); }} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
        <BottomNav active="missions" />
      </div>
    );
  }

  const dailyMissions = missions.filter(m => m.type === 'daily' && m.is_completed !== 1);
  const failedMissions = missions.filter(m => (m as Mission & { status?: string | undefined }).status === 'failed' && m.is_completed !== 1);
  const weeklyMissions = missions.filter(m => m.type === 'weekly' && m.is_completed !== 1 && (m as Mission & { status?: string | undefined }).status !== 'failed');
  const monthlyMissions = missions.filter(m => m.type === 'monthly' && m.is_completed !== 1 && (m as Mission & { status?: string | undefined }).status !== 'failed');

  const xpForNextLevel = (progression?.level || 1) * 100;
  const xpProgress = ((progression?.xp || 0) / xpForNextLevel) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-6 rounded-b-3xl shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">{profile?.full_name}</h1>
            <p className="text-emerald-100 text-sm">@{profile?.username}</p>
            {activeTitle && (
              <div className="inline-block mt-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-medium">
                {activeTitle.name}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">Nv {progression?.level}</div>
            <div className="text-emerald-100 text-sm">{progression?.xp}/{xpForNextLevel} XP</div>
          </div>
        </div>

        {/* XP Progress Bar */}
        <div className="bg-white/20 backdrop-blur-sm rounded-full h-3 overflow-hidden">
          <div
            className="bg-white h-full rounded-full transition-all duration-500"
            style={{ width: `${xpProgress}%` }}
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatCard icon={<Flame className="w-5 h-5" />} label="Streak" value={`${progression?.current_streak}d`} />
          <StatCard icon={<Footprints className="w-5 h-5" />} label="Passos" value={metrics?.steps?.toLocaleString() || "0"} />
          <StatCard icon={<Zap className="w-5 h-5" />} label="Calorias" value={metrics?.calories_burned || 0} />
        </div>
      </div>

      {/* Missions */}
      <div className="px-6 py-6 space-y-6">
        <AIMissionGenerator
          onMissionsGenerated={loadData}
          {...(profile?.initial_conditioning ? { conditioning: profile.initial_conditioning } : {})}
        />
        <MissionSection
          title="MissÃµes DiÃ¡rias"
          icon={<Target className="w-5 h-5" />}
          missions={dailyMissions}
          onComplete={handleMissionComplete}
        />

        {failedMissions.length > 0 && (
          <MissionSection
            title="MissÃµes Expiradas"
            icon={<Target className="w-5 h-5" />}
            missions={failedMissions}
            onComplete={handleMissionComplete}
          />
        )}

        {weeklyMissions.length > 0 && (
          <MissionSection
            title="MissÃµes Semanais"
            icon={<Target className="w-5 h-5" />}
            missions={weeklyMissions}
            onComplete={handleMissionComplete}
          />
        )}

        {monthlyMissions.length > 0 && (
          <MissionSection
            title="MissÃµes Mensais"
            icon={<Target className="w-5 h-5" />}
            missions={monthlyMissions}
            onComplete={handleMissionComplete}
          />
        )}
        <AIRecommendations />
      </div>
      
      {/* Floating Chatbot Button */}
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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-3 text-center">
      <div className="flex justify-center mb-1">{icon}</div>
      <div className="text-xs text-emerald-100">{label}</div>
      <div className="text-lg font-bold">{value}</div>
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
  onComplete: (id: number, reps: number, verified: boolean) => void;
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



