ï»¿import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import BottomNav from "@/react-app/components/BottomNav";
import PageLoader from "@/react-app/components/PageLoader";
import LoadingBall from "@/react-app/components/LoadingBall";
import { LogOut, Trophy, Award, Dumbbell, Target, Settings } from "lucide-react";
import type {
  UserProfile,
  UserAttributes,
  UserProgression,
  SkillWithProgress,
  AchievementWithUnlock,
  TitleWithUnlock,
} from "@/shared/types";
import { api } from "@/react-app/utils/api";
import { applyProfileTheme } from "@/react-app/utils/theme";

const FONT_OPTIONS = [
  { label: "Rajdhani", value: "rajdhani", family: "Rajdhani, sans-serif" },
  { label: "Orbitron", value: "orbitron", family: "Orbitron, sans-serif" },
  { label: "Exo 2", value: "exo2", family: "Exo 2, sans-serif" },
  { label: "Bebas Neue", value: "bebas-neue", family: "Bebas Neue, sans-serif" },
  { label: "Teko", value: "teko", family: "Teko, sans-serif" },
  { label: "Russo One", value: "russo-one", family: "Russo One, sans-serif" },
  { label: "Audiowide", value: "audiowide", family: "Audiowide, sans-serif" },
  { label: "Press Start 2P", value: "press-start-2p", family: '"Press Start 2P", cursive' },
  { label: "Cinzel", value: "cinzel", family: "Cinzel, serif" },
  { label: "Bangers", value: "bangers", family: "Bangers, cursive" },
] as const;

const DEFAULT_PRIMARY_COLOR = "#10b981";
const DEFAULT_SECONDARY_COLOR = "#14b8a6";

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [attributes, setAttributes] = useState<UserAttributes | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [skills, setSkills] = useState<SkillWithProgress[]>([]);
  const [achievements, setAchievements] = useState<AchievementWithUnlock[]>([]);
  const [titles, setTitles] = useState<TitleWithUnlock[]>([]);
  const [activeTab, setActiveTab] = useState<"attributes" | "skills" | "achievements" | "titles">("attributes");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [customizationSaving, setCustomizationSaving] = useState(false);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY_COLOR);
  const [customFont, setCustomFont] = useState<string>("rajdhani");

  const primaryColorInputRef = useRef<HTMLInputElement>(null);
  const secondaryColorInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    const updateViewport = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [profileRes, attrsRes, progRes, skillsRes, achievementsRes, titlesRes] = await Promise.all([
        api("/api/profile"),
        api("/api/attributes"),
        api("/api/progression"),
        api("/api/skills"),
        api("/api/achievements"),
        api("/api/titles"),
      ]);

      if (profileRes.status === 401 || profileRes.status === 403) {
        navigate("/app");
        return;
      }

      if (!profileRes.ok || !attrsRes.ok || !progRes.ok || !skillsRes.ok || !achievementsRes.ok || !titlesRes.ok) {
        throw new Error("Falha ao carregar perfil.");
      }

      const profileData = (await profileRes.json()) as UserProfile;
      setProfile(profileData);
      setBgPreview(profileData?.custom_background_type === "image" ? profileData?.custom_background_value ?? null : null);
      setPrimaryColor(profileData?.custom_primary_color ?? DEFAULT_PRIMARY_COLOR);
      setSecondaryColor(profileData?.custom_secondary_color ?? DEFAULT_SECONDARY_COLOR);
      setCustomFont(profileData?.custom_font ?? "rajdhani");
      applyProfileTheme(profileData);

      setAttributes((await attrsRes.json()) as UserAttributes);
      setProgression((await progRes.json()) as UserProgression);
      setSkills((await skillsRes.json()) as SkillWithProgress[]);
      setAchievements((await achievementsRes.json()) as AchievementWithUnlock[]);
      setTitles((await titlesRes.json()) as TitleWithUnlock[]);
    } catch {
      setError("NÃ£o foi possÃ­vel carregar o perfil agora.");
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

  const handleLogout = () => {
    logout();
    navigate("/app", { replace: true });
    api("/api/logout", { credentials: "include" }).catch(() => undefined);
  };

  const handleActivateTitle = async (titleId: number) => {
    try {
      await api(`/api/titles/${titleId}/activate`, { method: "POST" });
      await loadData();
    } catch {
      setError("NÃ£o foi possÃ­vel ativar o tÃ­tulo agora.");
    }
  };

  const applyThemePreview = (changes: {
    custom_primary_color?: string | null | undefined;
    custom_secondary_color?: string | null | undefined;
    custom_font?: string | null | undefined;
    custom_background_type?: string | null | undefined;
    custom_background_value?: string | null | undefined;
  }) => {
    applyProfileTheme({
      custom_primary_color: changes.custom_primary_color ?? profile?.custom_primary_color ?? primaryColor,
      custom_secondary_color: changes.custom_secondary_color ?? profile?.custom_secondary_color ?? secondaryColor,
      custom_font: changes.custom_font ?? profile?.custom_font ?? customFont,
      custom_background_type: changes.custom_background_type ?? profile?.custom_background_type ?? "color",
      custom_background_value: changes.custom_background_value ?? profile?.custom_background_value ?? "#f8fafc",
    });
  };

  const saveCustomization = async (payload: Record<string, unknown>) => {
    try {
      setCustomizationSaving(true);
      const response = await api("/api/profile/customization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Falha ao salvar personalizaÃ§Ã£o.");
      }

      const responseData = (await response.json()) as { profile?: UserProfile | undefined };
      if (responseData.profile) {
        setProfile(responseData.profile);
        applyProfileTheme(responseData.profile);
      }
    } catch {
      setError("NÃ£o foi possÃ­vel salvar personalizaÃ§Ã£o agora.");
    } finally {
      setCustomizationSaving(false);
    }
  };

  const setSkillFocus = async (focus: "calistenia" | "yoga") => {
    try {
      await api("/api/profile/skill-focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_skill_focus: focus }),
      });
      setProfile((currentProfile) => currentProfile ? { ...currentProfile, active_skill_focus: focus } : currentProfile);
    } catch {
      setError("NÃ£o foi possÃ­vel alterar o foco agora.");
    }
  };

  const applyPrimaryColor = async (nextColor: string) => {
    setPrimaryColor(nextColor);
    applyThemePreview({ custom_primary_color: nextColor });
    await saveCustomization({ custom_primary_color: nextColor });
  };

  const applySecondaryColor = async (nextColor: string) => {
    setSecondaryColor(nextColor);
    applyThemePreview({ custom_secondary_color: nextColor });
    await saveCustomization({ custom_secondary_color: nextColor });
  };

  const applyFont = async (font: string) => {
    setCustomFont(font);
    applyThemePreview({ custom_font: font });
    await saveCustomization({ custom_font: font });
  };

  const onPickBackgroundImage: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const value = String(reader.result || "");
      if (!value.includes(",")) return;
      setBgPreview(value);
      applyThemePreview({ custom_background_type: "image", custom_background_value: value });
      await saveCustomization({ custom_background_type: "image", custom_background_value: value });
    };
    reader.readAsDataURL(file);
  };

  const applySolidBackground = async () => {
    applyThemePreview({ custom_background_type: "color", custom_background_value: "#0f172a" });
    await saveCustomization({ custom_background_type: "color", custom_background_value: "#0f172a" });
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
        <BottomNav active="profile" />
      </div>
    );
  }

  const activeTitle = titles.find((title) => title.is_active === 1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      <div className="text-white px-6 pt-8 pb-8 rounded-b-3xl shadow-xl" style={{ background: "linear-gradient(90deg, var(--app-primary-color), var(--app-secondary-color))" }}>
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h1 className="text-3xl font-bold fl-profile-title">{profile?.full_name}</h1>
            <p className="text-emerald-100">@{profile?.username}</p>
            {activeTitle && (
              <div className="inline-block mt-2 px-4 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-sm font-medium">
                {activeTitle.name}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Abrir configuraÃ§Ãµes"
            >
              <Settings className="w-6 h-6" />
            </button>
            <button
              onClick={handleLogout}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Sair"
            >
              <LogOut className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatBox label="NÃ­vel" value={progression?.level || 1} />
          <StatBox label="XP Total" value={(progression?.level || 1) * 100 + (progression?.xp || 0)} />
          <StatBox label="Pontos" value={progression?.points || 0} />
        </div>
      </div>

      <div className="px-6 mt-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-1 shadow-lg flex gap-1">
          <TabButton icon={<Target className="w-4 h-4" />} label="Atributos" active={activeTab === "attributes"} onClick={() => setActiveTab("attributes")} />
          <TabButton icon={<Dumbbell className="w-4 h-4" />} label="Habilidades" active={activeTab === "skills"} onClick={() => setActiveTab("skills")} />
          <TabButton icon={<Trophy className="w-4 h-4" />} label="Conquistas" active={activeTab === "achievements"} onClick={() => setActiveTab("achievements")} />
          <TabButton icon={<Award className="w-4 h-4" />} label="TÃ­tulos" active={activeTab === "titles"} onClick={() => setActiveTab("titles")} />
        </div>
      </div>

      <div className="px-6 mt-6 pb-6">
        {activeTab === "attributes" && attributes && (
          <div className="space-y-4">
            <AttributeBar label="FOR (ForÃ§a)" value={attributes.strength} color="from-red-500 to-orange-500" />
            <AttributeBar label="CON (ConstituiÃ§Ã£o)" value={attributes.constitution} color="from-blue-500 to-cyan-500" />
            <AttributeBar label="VIT (Vitalidade)" value={attributes.vitality} color="from-green-500 to-emerald-500" />
            <AttributeBar label="DES (Destreza)" value={attributes.dexterity} color="from-purple-500 to-pink-500" />
            <AttributeBar label="FOCO" value={attributes.focus} color="from-yellow-500 to-amber-500" />
          </div>
        )}

        {activeTab === "skills" && (
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

        {activeTab === "achievements" && (
          <div className="grid grid-cols-2 gap-3">
            {achievements.map((achievement) => (
              <AchievementCard key={achievement.id} achievement={achievement} />
            ))}
          </div>
        )}

        {activeTab === "titles" && (
          <div className="space-y-3">
            {titles.map((title) => (
              <TitleCard key={title.id} title={title} onActivate={handleActivateTitle} />
            ))}
          </div>
        )}
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">ConfiguraÃ§Ãµes</h2>
              <button onClick={() => setSettingsOpen(false)} className="fl-btn-secondary rounded-lg px-3 py-1">Fechar</button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900 mb-3">InformaÃ§Ãµes da conta</h3>
                <p className="text-sm text-gray-700">Nome: {profile?.full_name ?? "-"}</p>
                <p className="text-sm text-gray-700">Email: {user?.email ?? "-"}</p>
                <p className="text-sm text-gray-700">Username: @{profile?.username ?? "-"}</p>
              </div>

              <div className="rounded-2xl border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Foco atual</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { void setSkillFocus("calistenia"); }} className={`rounded-xl py-2 ${profile?.active_skill_focus === "calistenia" ? "fl-btn-primary" : "fl-btn-secondary"}`}>Foco Calistenia</button>
                  <button onClick={() => { void setSkillFocus("yoga"); }} className={`rounded-xl py-2 ${profile?.active_skill_focus === "yoga" ? "fl-btn-primary" : "fl-btn-secondary"}`}>Foco Yoga</button>
                </div>
              </div>

              {isMobile ? (
                <div className="rounded-2xl border border-gray-200 p-4 space-y-4">
                  <h3 className="font-semibold text-gray-900">PersonalizaÃ§Ã£o (mobile)</h3>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => primaryColorInputRef.current?.click()}
                      className="h-12 rounded-lg border-2 border-white/20 shadow-inner"
                      style={{ backgroundColor: primaryColor }}
                      type="button"
                      aria-label="Selecionar cor primÃ¡ria"
                    />
                    <button
                      onClick={() => secondaryColorInputRef.current?.click()}
                      className="h-12 rounded-lg border-2 border-white/20 shadow-inner"
                      style={{ backgroundColor: secondaryColor }}
                      type="button"
                      aria-label="Selecionar cor secundÃ¡ria"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Cor primÃ¡ria</span>
                    <span>Cor secundÃ¡ria</span>
                  </div>
                  <input
                    ref={primaryColorInputRef}
                    type="color"
                    value={primaryColor}
                    onChange={(event) => { void applyPrimaryColor(event.target.value); }}
                    className="sr-only"
                  />
                  <input
                    ref={secondaryColorInputRef}
                    type="color"
                    value={secondaryColor}
                    onChange={(event) => { void applySecondaryColor(event.target.value); }}
                    className="sr-only"
                  />

                  <label className="block text-sm font-medium text-gray-700">Fonte do tÃ­tulo</label>
                  <select
                    value={customFont}
                    onChange={(event) => { void applyFont(event.target.value); }}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                    style={{ fontFamily: FONT_OPTIONS.find((font) => font.value === customFont)?.family ?? "inherit" }}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value} style={{ fontFamily: font.family }}>
                        {font.label}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { void applySolidBackground(); }} className="fl-btn-secondary rounded-xl py-2 w-full">Fundo sÃ³lido</button>
                    <label className="fl-btn-secondary rounded-xl py-2 text-center cursor-pointer block">
                      Escolher foto
                      <input type="file" accept="image/*" className="hidden" onChange={onPickBackgroundImage} />
                    </label>
                  </div>

                  {bgPreview && <img src={bgPreview} alt="PrÃ©via do fundo" className="w-full h-28 object-cover rounded-xl border border-gray-200" />}

                  {customizationSaving && (
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <LoadingBall size="sm" />
                      Salvando personalizaÃ§Ã£o...
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">
                  PersonalizaÃ§Ã£o visual disponÃ­vel apenas no mobile (largura atÃ© 768px).
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

function SkillCard({ skill }: { skill: SkillWithProgress }) {
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
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${difficultyColors[skill.difficulty as keyof typeof difficultyColors] || "bg-gray-100"}`}>
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

function AchievementCard({ achievement }: { achievement: AchievementWithUnlock }) {
  const rarityColors = {
    Comum: "from-gray-400 to-gray-500",
    Raro: "from-blue-400 to-blue-600",
    Ãpico: "from-purple-400 to-purple-600",
    LendÃ¡rio: "from-yellow-400 to-orange-500",
  };

  const unlocked = achievement.unlocked === 1;

  return (
    <div className={`rounded-2xl p-4 shadow-lg text-center ${
      unlocked
        ? `bg-gradient-to-br ${rarityColors[achievement.rarity as keyof typeof rarityColors] || "from-gray-400 to-gray-500"} text-white`
        : "bg-gray-200 text-gray-400"
    }`}>
      <div className="text-3xl mb-2">{unlocked ? "ð" : "ð"}</div>
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

function TitleCard({ title, onActivate }: { title: TitleWithUnlock; onActivate: (id: number) => void }) {
  const rarityColors = {
    Comum: "border-gray-400",
    Raro: "border-blue-500",
    Ãpico: "border-purple-500",
    LendÃ¡rio: "border-yellow-500",
  };

  const unlocked = title.unlocked === 1;
  const active = title.is_active === 1;

  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border-2 ${
      unlocked ? rarityColors[title.rarity as keyof typeof rarityColors] || "border-gray-400" : "border-gray-200"
    } ${active ? "ring-2 ring-emerald-500" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className={`font-bold ${unlocked ? "text-gray-900" : "text-gray-400"}`}>
            {unlocked ? title.name : "ð Bloqueado"}
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


