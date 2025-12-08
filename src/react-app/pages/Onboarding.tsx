import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import BottomNav from "@/react-app/components/BottomNav";
import MissionCard from "@/react-app/components/MissionCard";
import LevelUpModal from "@/react-app/components/LevelUpModal";
import { Flame, Footprints, Target, Zap } from "lucide-react";
import type { Mission, UserProgression, DailyMetrics, UserProfile, Title } from "@/shared/types";
import { api } from "@/react-app/utils/api";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null);
  const [activeTitle, setActiveTitle] = useState<Title | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [newLevel, setNewLevel] = useState(0);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }

    loadData();
  }, [user, navigate]);

  const loadData = async () => {
    try {
      const [profileRes, progressionRes, missionsRes, metricsRes, titlesRes] = await Promise.all([
        api("/api/profile"),
        api("/api/progression"),
        api("/api/missions"),
        api("/api/metrics/today"),
        api("/api/titles"),
      ]);

      if (!profileRes.ok) {
        navigate("/onboarding");
        return;
      }

      const profileData = await profileRes.json();
      const progressionData = await progressionRes.json();
      const missionsData = await missionsRes.json();
      const metricsData = await metricsRes.json();
      const titlesData = await titlesRes.json();

      setProfile(profileData);
      setProgression(progressionData);
      setMissions(missionsData);
      setMetrics(metricsData);

      const active = titlesData.find((t: any) => t.is_active === 1);
      setActiveTitle(active || null);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

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

      if (response.ok) {
        const result = await response.json();
        
        if (result.leveledUp) {
          const updatedProgression = await api("/api/progression").then(r => r.json());
          setNewLevel(updatedProgression.level);
          setShowLevelUp(true);
        }

        await loadData();
      }
    } catch (error) {
      console.error("Error completing mission:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
        <div className="text-emerald-600">Carregando...</div>
      </div>
    );
  }

  const dailyMissions = missions.filter(m => m.type === 'daily');
  const weeklyMissions = missions.filter(m => m.type === 'weekly');
  const monthlyMissions = missions.filter(m => m.type === 'monthly');

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
        <MissionSection
          title="Missões Diárias"
          icon={<Target className="w-5 h-5" />}
          missions={dailyMissions}
          onComplete={handleMissionComplete}
        />

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
      </div>

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
