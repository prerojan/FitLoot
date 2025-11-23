import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@getmocha/users-service/react";
import BottomNav from "@/react-app/components/BottomNav";
import { LogOut, Trophy, Award, Dumbbell, Target } from "lucide-react";
import type { UserProfile, UserAttributes, UserProgression } from "@/shared/types";

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [attributes, setAttributes] = useState<UserAttributes | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [titles, setTitles] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'attributes' | 'skills' | 'achievements' | 'titles'>('attributes');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    loadData();
  }, [user, navigate]);

  const loadData = async () => {
    try {
      const [profileRes, attrsRes, progRes, skillsRes, achievementsRes, titlesRes] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/attributes"),
        fetch("/api/progression"),
        fetch("/api/skills"),
        fetch("/api/achievements"),
        fetch("/api/titles"),
      ]);

      setProfile(await profileRes.json());
      setAttributes(await attrsRes.json());
      setProgression(await progRes.json());
      setSkills(await skillsRes.json());
      setAchievements(await achievementsRes.json());
      setTitles(await titlesRes.json());
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/app");
  };

  const handleActivateTitle = async (titleId: number) => {
    try {
      await fetch(`/api/titles/${titleId}/activate`, { method: "POST" });
      await loadData();
    } catch (error) {
      console.error("Error activating title:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
        <div className="text-emerald-600">Carregando...</div>
      </div>
    );
  }

  const activeTitle = titles.find(t => t.is_active === 1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-8 rounded-b-3xl shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold">{profile?.full_name}</h1>
            <p className="text-emerald-100">@{profile?.username}</p>
            {activeTitle && (
              <div className="inline-block mt-2 px-4 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-sm font-medium">
                {activeTitle.name}
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="text-white/80 hover:text-white transition-colors"
          >
            <LogOut className="w-6 h-6" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatBox label="Nível" value={progression?.level || 1} />
          <StatBox label="XP Total" value={(progression?.level || 1) * 100 + (progression?.xp || 0)} />
          <StatBox label="Pontos" value={progression?.points || 0} />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 mt-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-1 shadow-lg flex gap-1">
          <TabButton
            icon={<Target className="w-4 h-4" />}
            label="Atributos"
            active={activeTab === 'attributes'}
            onClick={() => setActiveTab('attributes')}
          />
          <TabButton
            icon={<Dumbbell className="w-4 h-4" />}
            label="Habilidades"
            active={activeTab === 'skills'}
            onClick={() => setActiveTab('skills')}
          />
          <TabButton
            icon={<Trophy className="w-4 h-4" />}
            label="Conquistas"
            active={activeTab === 'achievements'}
            onClick={() => setActiveTab('achievements')}
          />
          <TabButton
            icon={<Award className="w-4 h-4" />}
            label="Títulos"
            active={activeTab === 'titles'}
            onClick={() => setActiveTab('titles')}
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-6 mt-6 pb-6">
        {activeTab === 'attributes' && attributes && (
          <div className="space-y-4">
            <AttributeBar label="FOR (Força)" value={attributes.strength} color="from-red-500 to-orange-500" />
            <AttributeBar label="CON (Constituição)" value={attributes.constitution} color="from-blue-500 to-cyan-500" />
            <AttributeBar label="VIT (Vitalidade)" value={attributes.vitality} color="from-green-500 to-emerald-500" />
            <AttributeBar label="DES (Destreza)" value={attributes.dexterity} color="from-purple-500 to-pink-500" />
            <AttributeBar label="FOCO" value={attributes.focus} color="from-yellow-500 to-amber-500" />
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="space-y-3">
            {skills.length === 0 ? (
              <p className="text-center text-gray-500 py-8">Nenhuma habilidade desbloqueada ainda</p>
            ) : (
              skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))
            )}
          </div>
        )}

        {activeTab === 'achievements' && (
          <div className="grid grid-cols-2 gap-3">
            {achievements.map((achievement) => (
              <AchievementCard key={achievement.id} achievement={achievement} />
            ))}
          </div>
        )}

        {activeTab === 'titles' && (
          <div className="space-y-3">
            {titles.map((title) => (
              <TitleCard
                key={title.id}
                title={title}
                onActivate={handleActivateTitle}
              />
            ))}
          </div>
        )}
      </div>

      <BottomNav active="profile" />
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-3 text-center">
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs text-emerald-100">{label}</div>
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all text-sm ${
        active
          ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md"
          : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function AttributeBar({ label, value, color }: { label: string; value: number; color: string }) {
  const maxValue = 200;
  const percentage = Math.min((value / maxValue) * 100, 100);

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-gray-900">{label}</span>
        <span className="text-2xl font-bold text-gray-900">{value}</span>
      </div>
      <div className="bg-gray-200 rounded-full h-4 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: any }) {
  const difficultyColors = {
    basico: "bg-green-100 text-green-700",
    intermediario: "bg-blue-100 text-blue-700",
    avancado: "bg-purple-100 text-purple-700",
    calistenia: "bg-orange-100 text-orange-700",
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold text-gray-900">{skill.name}</h3>
          <p className="text-sm text-gray-600">{skill.description}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${difficultyColors[skill.difficulty as keyof typeof difficultyColors] || 'bg-gray-100'}`}>
          {skill.difficulty}
        </span>
      </div>
      <div className="flex gap-4 text-sm text-gray-600 mt-3">
        <span>Total: {skill.total_reps} reps</span>
        <span>Melhor: {skill.best_reps} reps</span>
      </div>
    </div>
  );
}

function AchievementCard({ achievement }: { achievement: any }) {
  const rarityColors = {
    Comum: "from-gray-400 to-gray-500",
    Raro: "from-blue-400 to-blue-600",
    Épico: "from-purple-400 to-purple-600",
    Lendário: "from-yellow-400 to-orange-500",
  };

  const unlocked = achievement.unlocked === 1;

  return (
    <div className={`rounded-2xl p-4 shadow-lg text-center ${
      unlocked
        ? `bg-gradient-to-br ${rarityColors[achievement.rarity as keyof typeof rarityColors] || 'from-gray-400 to-gray-500'} text-white`
        : "bg-gray-200 text-gray-400"
    }`}>
      <div className="text-3xl mb-2">{unlocked ? "🏆" : "🔒"}</div>
      <h3 className="font-bold text-sm mb-1">{achievement.name}</h3>
      <p className="text-xs opacity-90">{achievement.description}</p>
      {unlocked && achievement.unlocked_at && (
        <p className="text-xs opacity-75 mt-2">
          {new Date(achievement.unlocked_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function TitleCard({ title, onActivate }: { title: any; onActivate: (id: number) => void }) {
  const rarityColors = {
    Comum: "border-gray-400",
    Raro: "border-blue-500",
    Épico: "border-purple-500",
    Lendário: "border-yellow-500",
  };

  const unlocked = title.unlocked === 1;
  const active = title.is_active === 1;

  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border-2 ${
      unlocked ? rarityColors[title.rarity as keyof typeof rarityColors] || 'border-gray-400' : 'border-gray-200'
    } ${active ? 'ring-2 ring-emerald-500' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className={`font-bold ${unlocked ? 'text-gray-900' : 'text-gray-400'}`}>
            {unlocked ? title.name : '🔒 Bloqueado'}
          </h3>
          <p className="text-xs text-gray-500">{title.rarity}</p>
        </div>
        {unlocked && !active && (
          <button
            onClick={() => onActivate(title.id)}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors"
          >
            Ativar
          </button>
        )}
        {active && (
          <span className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium">
            Ativo
          </span>
        )}
      </div>
    </div>
  );
}
