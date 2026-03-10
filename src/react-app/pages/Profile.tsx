import { useCallback, useEffect, useRef, useState, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import BottomNav from "@/react-app/components/BottomNav";
import ProfileFriendsPanel from "@/react-app/components/ProfileFriendsPanel";
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
import { ApiRequestError, api, clearJsonCache, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
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
const SHOWCASED_ACHIEVEMENT_LIMIT = 3;
const RARITY_FILTER_OPTIONS = ["Todos", "Comum", "Incomum", "Raro", "Mítico", "Secreto"] as const;
type RarityFilterOption = typeof RARITY_FILTER_OPTIONS[number];
type DetailModalState =
  | { type: "achievement"; value: AchievementWithUnlock }
  | { type: "title"; value: TitleWithUnlock }
  | null;

const RARITY_COLOR_MAP = {
  Comum: "#D1D5DB",
  Incomum: "#22C55E",
  Raro: "#3B82F6",
  "Mítico": "#EF4444",
  Secreto: "#F59E0B",
} as const;

function normalizeRarity(value: string | null | undefined): keyof typeof RARITY_COLOR_MAP {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("incomum")) return "Incomum";
  if (normalized.includes("comum")) return "Comum";
  if (normalized.includes("raro")) return "Raro";
  if (normalized.includes("mitico")) return "Mítico";
  if (normalized.includes("secreto")) return "Secreto";
  return "Comum";
}

function raritySortWeight(value: string | null | undefined): number {
  const rarity = normalizeRarity(value);
  if (rarity === "Mítico") return 4;
  if (rarity === "Raro") return 3;
  if (rarity === "Incomum") return 2;
  if (rarity === "Comum") return 1;
  return 0;
}

function resolveRarityColor(value: { rarity?: string | null | undefined; color?: string | null | undefined }): string {
  if (typeof value.color === "string" && value.color.trim().length > 0) {
    return value.color;
  }
  return RARITY_COLOR_MAP[normalizeRarity(value.rarity)];
}

function parseShowcasedAchievementIds(rawValue: string | null | undefined): number[] {
  if (!rawValue || rawValue.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid = parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    return Array.from(new Set(valid));
  } catch {
    return [];
  }
}

function formatUnlockDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

const CONDITION_LABELS: Record<string, string> = {
  missions_completed: "Missões completas",
  streak: "Sequência de dias",
  chat_messages: "Mensagens no FitBot",
  ranking: "Posição no ranking",
  strength: "Força",
  skills: "Habilidades desbloqueadas",
  weekly: "Desafios semanais",
  failures: "Falhas registradas",
};

function formatConditionLabel(rawValue: string): string {
  const normalized = rawValue.trim().toLowerCase();
  return CONDITION_LABELS[normalized] ?? rawValue.replace(/_/g, " ");
}

function formatUnlockCondition(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.includes(":")) {
    const [kind, ...parts] = trimmed.split(":").map((part) => part.trim());
    if (kind === "level" && parts[0]) return `Alcance o nível ${parts[0]}.`;
    if (kind === "skill" && parts[0] && parts[1]) return `Complete ${parts[0]} até o estágio ${parts[1]}.`;
    if (kind === "missions" && parts[0]) return `Complete ${parts[0]} missões.`;
    if (kind === "streak" && parts[0]) return `Mantenha uma sequência de ${parts[0]} dias.`;
    if (kind === "weekly" && parts[0]) return `Conclua ${parts[0]} desafio(s) semanal(is).`;
    if (kind === "skills" && parts[0]) return `Desbloqueie ${parts[0]} habilidade(s).`;
    return trimmed.replace(/_/g, " ");
  }

  const comparatorMatch = trimmed.match(/^([a-z_]+)\s*(>=|<=|==)\s*(\d+)$/i);
  if (!comparatorMatch) {
    return trimmed.replace(/_/g, " ");
  }

  const metric = comparatorMatch[1] ?? "";
  const operator = comparatorMatch[2] ?? "==";
  const threshold = comparatorMatch[3] ?? "0";
  const metricLabel = formatConditionLabel(metric);
  if (operator === ">=") return `${metricLabel}: ${threshold}+`;
  if (operator === "<=") return `${metricLabel}: até ${threshold}`;
  return `${metricLabel}: ${threshold}`;
}

function isAchievementSecretLocked(achievement: AchievementWithUnlock): boolean {
  return Number(achievement.secret ?? 0) === 1 && achievement.unlocked !== 1;
}

function isTitleSecretLocked(title: TitleWithUnlock): boolean {
  return normalizeRarity(title.rarity) === "Secreto" && title.unlocked !== 1;
}

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [attributes, setAttributes] = useState<UserAttributes | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [skills, setSkills] = useState<SkillWithProgress[]>([]);
  const [achievements, setAchievements] = useState<AchievementWithUnlock[]>([]);
  const [titles, setTitles] = useState<TitleWithUnlock[]>([]);
  const [profileSection, setProfileSection] = useState<"profile" | "friends">("profile");
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
  const [feedbackType, setFeedbackType] = useState<"Sugestao" | "Bug" | "Elogio" | "Outro">("Sugestao");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [achievementFilter, setAchievementFilter] = useState<RarityFilterOption>("Todos");
  const [titleFilter, setTitleFilter] = useState<RarityFilterOption>("Todos");
  const [detailModal, setDetailModal] = useState<DetailModalState>(null);
  const [showcasePendingId, setShowcasePendingId] = useState<number | null>(null);
  const [titlePendingId, setTitlePendingId] = useState<number | null>(null);

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
    setError(null);

    const cacheProfile = readCachedJson<UserProfile>("/api/profile");
    const cacheAttributes = readCachedJson<UserAttributes>("/api/attributes");
    const cacheProgression = readCachedJson<UserProgression>("/api/progression");
    const cacheSkills = readCachedJson<SkillWithProgress[]>("/api/skills");
    const cacheAchievements = readCachedJson<AchievementWithUnlock[]>("/api/achievements");
    const cacheTitles = readCachedJson<TitleWithUnlock[]>("/api/titles");

    if (cacheProfile) {
      const profileData = cacheProfile.data;
      setProfile(profileData);
      setBgPreview(profileData?.custom_background_type === "image" ? profileData?.custom_background_value ?? null : null);
      setPrimaryColor(profileData?.custom_primary_color ?? DEFAULT_PRIMARY_COLOR);
      setSecondaryColor(profileData?.custom_secondary_color ?? DEFAULT_SECONDARY_COLOR);
      setCustomFont(profileData?.custom_font ?? "rajdhani");
      applyProfileTheme(profileData);
    }
    if (cacheAttributes) setAttributes(cacheAttributes.data);
    if (cacheProgression) setProgression(cacheProgression.data);
    if (cacheSkills) setSkills(Array.isArray(cacheSkills.data) ? cacheSkills.data : []);
    if (cacheAchievements) setAchievements(Array.isArray(cacheAchievements.data) ? cacheAchievements.data : []);
    if (cacheTitles) setTitles(Array.isArray(cacheTitles.data) ? cacheTitles.data : []);

    const hasAnyCache = Boolean(cacheProfile || cacheAttributes || cacheProgression || cacheSkills || cacheAchievements || cacheTitles);
    if (hasAnyCache) {
      setLoading(false);
    }

    const runSection = async <T,>(
      path: string,
      cacheState: { stale: boolean } | null,
      onSuccess: (value: T) => void,
    ) => {
      const shouldFetch = !cacheState || cacheState.stale;
      if (!shouldFetch) return;
      const payload = await fetchAndCacheJson<T>(path);
      onSuccess(payload);
    };

    try {
      await Promise.all([
        runSection<UserProfile>("/api/profile", cacheProfile, (profileData) => {
          setProfile(profileData);
          setBgPreview(profileData?.custom_background_type === "image" ? profileData?.custom_background_value ?? null : null);
          setPrimaryColor(profileData?.custom_primary_color ?? DEFAULT_PRIMARY_COLOR);
          setSecondaryColor(profileData?.custom_secondary_color ?? DEFAULT_SECONDARY_COLOR);
          setCustomFont(profileData?.custom_font ?? "rajdhani");
          applyProfileTheme(profileData);
        }),
        runSection<UserAttributes>("/api/attributes", cacheAttributes, (payload) => setAttributes(payload)),
        runSection<UserProgression>("/api/progression", cacheProgression, (payload) => setProgression(payload)),
        runSection<SkillWithProgress[]>("/api/skills", cacheSkills, (payload) => setSkills(Array.isArray(payload) ? payload : [])),
        runSection<AchievementWithUnlock[]>("/api/achievements", cacheAchievements, (payload) => setAchievements(Array.isArray(payload) ? payload : [])),
        runSection<TitleWithUnlock[]>("/api/titles", cacheTitles, (payload) => setTitles(Array.isArray(payload) ? payload : [])),
      ]);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app");
        return;
      }
      if (!hasAnyCache) {
        setError("Não foi possível carregar o perfil agora.");
      }
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
    clearJsonCache();
    navigate("/app", { replace: true });
    api("/api/logout", { credentials: "include" }).catch(() => undefined);
  };

  const handleActivateTitle = async (titleId: number) => {
    try {
      setTitlePendingId(titleId);
      await api(`/api/titles/${titleId}/activate`, { method: "POST" });
      clearJsonCache("/api/titles");
      await loadData();
    } catch {
      setError("Não foi possível equipar o título agora.");
    } finally {
      setTitlePendingId(null);
    }
  };

  const handleDeactivateTitle = async (titleId: number) => {
    try {
      setTitlePendingId(titleId);
      await api(`/api/titles/${titleId}/deactivate`, { method: "POST" });
      clearJsonCache("/api/titles");
      await loadData();
    } catch {
      setError("Não foi possível desequipar o título agora.");
    } finally {
      setTitlePendingId(null);
    }
  };

  const updateShowcasedAchievements = (ids: number[]) => {
    setProfile((currentProfile) => {
      if (!currentProfile) return currentProfile;
      return {
        ...currentProfile,
        showcased_achievements: JSON.stringify(ids),
      };
    });
    clearJsonCache("/api/profile");
  };

  const handleAddAchievementToShowcase = async (achievementId: number) => {
    try {
      setShowcasePendingId(achievementId);
      const response = await api("/api/profile/achievements/showcase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievement_id: achievementId }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        throw new Error(payload?.error ?? "Falha ao adicionar conquista no perfil.");
      }

      const payload = (await response.json()) as { showcased_achievements?: number[] | undefined };
      updateShowcasedAchievements(Array.isArray(payload.showcased_achievements) ? payload.showcased_achievements : []);
    } catch (showcaseError) {
      setError(showcaseError instanceof Error ? showcaseError.message : "Não foi possível destacar a conquista agora.");
    } finally {
      setShowcasePendingId(null);
    }
  };

  const handleRemoveAchievementFromShowcase = async (achievementId: number) => {
    try {
      setShowcasePendingId(achievementId);
      const response = await api(`/api/profile/achievements/showcase/${achievementId}`, { method: "DELETE" });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        throw new Error(payload?.error ?? "Falha ao remover conquista do perfil.");
      }

      const payload = (await response.json()) as { showcased_achievements?: number[] | undefined };
      updateShowcasedAchievements(Array.isArray(payload.showcased_achievements) ? payload.showcased_achievements : []);
    } catch (showcaseError) {
      setError(showcaseError instanceof Error ? showcaseError.message : "Não foi possível remover a conquista agora.");
    } finally {
      setShowcasePendingId(null);
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
        throw new Error("Falha ao salvar personalização.");
      }

      const responseData = (await response.json()) as { profile?: UserProfile | undefined };
      if (responseData.profile) {
        setProfile(responseData.profile);
        applyProfileTheme(responseData.profile);
      }
    } catch {
      setError("Não foi possível salvar personalização agora.");
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
      setError("Não foi possível alterar o foco agora.");
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

  const sendFeedback = async () => {
    if (feedbackMessage.trim().length < 5) {
      setFeedbackStatus({ type: "error", message: "Escreva pelo menos 5 caracteres." });
      return;
    }

    try {
      setFeedbackSending(true);
      setFeedbackStatus(null);
      const response = await api("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: feedbackType,
          message: feedbackMessage.trim(),
        }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        throw new Error(payload?.error ?? "Falha ao enviar feedback.");
      }

      setFeedbackMessage("");
      setFeedbackType("Sugestao");
      setFeedbackStatus({ type: "success", message: "Feedback enviado! Obrigado." });
    } catch (submitError) {
      setFeedbackStatus({
        type: "error",
        message: submitError instanceof Error ? submitError.message : "Nao foi possivel enviar feedback agora.",
      });
    } finally {
      setFeedbackSending(false);
    }
  };

  if (loading && !profile && !attributes && !progression) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
        <div className="px-6 py-10 space-y-4">
          <div className="fl-card p-6 flex items-center justify-center">
            <LoadingBall size="md" />
          </div>
          <div className="fl-card p-6 flex items-center justify-center">
            <LoadingBall size="sm" />
          </div>
        </div>
        <BottomNav active="profile" />
      </div>
    );
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

  const activeTitle = titles.find((title) => title.is_active === 1 && title.unlocked === 1);
  const showcasedAchievementIds = parseShowcasedAchievementIds(profile?.showcased_achievements);
  const showcasedAchievements = showcasedAchievementIds
    .map((achievementId) => achievements.find((achievement) => achievement.id === achievementId))
    .filter((achievement): achievement is AchievementWithUnlock => Boolean(achievement));

  const filteredAchievements = achievements.filter((achievement) => {
    if (achievementFilter === "Todos") return true;
    return normalizeRarity(achievement.rarity) === achievementFilter;
  });
  const unlockedAchievements = filteredAchievements
    .filter((achievement) => achievement.unlocked === 1)
    .sort((first, second) => {
      const firstTime = new Date(first.unlocked_at ?? 0).getTime();
      const secondTime = new Date(second.unlocked_at ?? 0).getTime();
      return secondTime - firstTime;
    });
  const blockedRegularAchievements = filteredAchievements
    .filter((achievement) => achievement.unlocked !== 1 && Number(achievement.secret ?? 0) !== 1)
    .sort((first, second) => {
      const rarityDiff = raritySortWeight(second.rarity) - raritySortWeight(first.rarity);
      if (rarityDiff !== 0) return rarityDiff;
      return first.name.localeCompare(second.name);
    });
  const blockedSecretAchievements = filteredAchievements
    .filter((achievement) => achievement.unlocked !== 1 && Number(achievement.secret ?? 0) === 1)
    .sort((first, second) => first.id - second.id);

  const filteredTitles = titles.filter((title) => {
    if (titleFilter === "Todos") return true;
    return normalizeRarity(title.rarity) === titleFilter;
  });
  const unlockedTitles = filteredTitles
    .filter((title) => title.unlocked === 1)
    .sort((first, second) => {
      const firstTime = new Date(first.unlocked_at ?? 0).getTime();
      const secondTime = new Date(second.unlocked_at ?? 0).getTime();
      return secondTime - firstTime;
    });
  const blockedRegularTitles = filteredTitles
    .filter((title) => title.unlocked !== 1 && normalizeRarity(title.rarity) !== "Secreto")
    .sort((first, second) => {
      const rarityDiff = raritySortWeight(second.rarity) - raritySortWeight(first.rarity);
      if (rarityDiff !== 0) return rarityDiff;
      return first.name.localeCompare(second.name);
    });
  const blockedSecretTitles = filteredTitles
    .filter((title) => title.unlocked !== 1 && normalizeRarity(title.rarity) === "Secreto")
    .sort((first, second) => first.id - second.id);

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
              aria-label="Abrir configurações"
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
          <StatBox label="Nível" value={progression?.level || 1} />
          <StatBox label="XP Total" value={(progression?.level || 1) * 100 + (progression?.xp || 0)} />
          <StatBox label="Pontos" value={progression?.points || 0} />
        </div>
      </div>

      <div className="px-6 mt-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-1 shadow-lg flex gap-1">
          <button
            onClick={() => setProfileSection("profile")}
            className={`flex-1 py-3 rounded-xl font-medium transition-all text-sm ${
              profileSection === "profile"
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Perfil
          </button>
          <button
            onClick={() => setProfileSection("friends")}
            className={`flex-1 py-3 rounded-xl font-medium transition-all text-sm ${
              profileSection === "friends"
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Amigos
          </button>
        </div>
      </div>

      {profileSection === "profile" ? (
        <>
          <div className="px-6 mt-6">
            <div className="fl-card p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-bold text-gray-900">Conquistas em Destaque</h2>
                <span className="text-xs text-gray-500">{showcasedAchievements.length}/{SHOWCASED_ACHIEVEMENT_LIMIT}</span>
              </div>
              {showcasedAchievements.length === 0 ? (
                <p className="text-xs text-gray-500">
                  Selecione até {SHOWCASED_ACHIEVEMENT_LIMIT} conquistas desbloqueadas para destacar no perfil.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {showcasedAchievements.map((achievement) => {
                    const rarityColor = resolveRarityColor(achievement);
                    return (
                      <button
                        key={achievement.id}
                        onClick={() => setDetailModal({ type: "achievement", value: achievement })}
                        className="rounded-2xl border-2 bg-white/90 p-3 text-center shadow-md transition-transform hover:-translate-y-0.5"
                        style={{ borderColor: rarityColor }}
                      >
                        <div className="text-3xl mb-1" style={{ color: rarityColor }}>
                          {achievement.icon || "🏆"}
                        </div>
                        <p className="text-[11px] font-bold leading-tight text-gray-900 line-clamp-2">{achievement.name}</p>
                        <span className="inline-flex mt-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: rarityColor }}>
                          {normalizeRarity(achievement.rarity)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="px-6 mt-4">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-1 shadow-lg flex gap-1">
              <TabButton icon={<Target className="w-4 h-4" />} label="Atributos" active={activeTab === "attributes"} onClick={() => setActiveTab("attributes")} />
              <TabButton icon={<Dumbbell className="w-4 h-4" />} label="Habilidades" active={activeTab === "skills"} onClick={() => setActiveTab("skills")} />
              <TabButton icon={<Trophy className="w-4 h-4" />} label="Conquistas" active={activeTab === "achievements"} onClick={() => setActiveTab("achievements")} />
              <TabButton icon={<Award className="w-4 h-4" />} label="Títulos" active={activeTab === "titles"} onClick={() => setActiveTab("titles")} />
            </div>
          </div>

          <div className="px-6 mt-6 pb-6">
            {activeTab === "attributes" && attributes && (
              <div className="space-y-4">
                <AttributeBar label="FOR (Força)" value={attributes.strength} color="from-red-500 to-orange-500" />
                <AttributeBar label="CON (Constituição)" value={attributes.constitution} color="from-blue-500 to-cyan-500" />
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
              <div className="space-y-4">
                <RarityFilterBar selected={achievementFilter} onChange={setAchievementFilter} />

                <SectionHeader title="Desbloqueadas" subtitle={`${unlockedAchievements.length} desbloqueadas`} />
                {unlockedAchievements.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-3">Nenhuma conquista desbloqueada neste filtro.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {unlockedAchievements.map((achievement) => (
                      <AchievementCard
                        key={achievement.id}
                        achievement={achievement}
                        highlighted={showcasedAchievementIds.includes(achievement.id)}
                        onClick={() => setDetailModal({ type: "achievement", value: achievement })}
                      />
                    ))}
                  </div>
                )}

                <SectionHeader title="Bloqueadas" subtitle={`${blockedRegularAchievements.length} restantes`} />
                {blockedRegularAchievements.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-3">Nenhuma conquista bloqueada neste filtro.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {blockedRegularAchievements.map((achievement) => (
                      <AchievementCard
                        key={achievement.id}
                        achievement={achievement}
                        highlighted={false}
                        onClick={() => setDetailModal({ type: "achievement", value: achievement })}
                      />
                    ))}
                  </div>
                )}

                {(achievementFilter === "Todos" || achievementFilter === "Secreto") && (
                  <>
                    <SectionHeader title="Secretas" subtitle="? secretas" />
                    {blockedSecretAchievements.length === 0 ? (
                      <p className="text-center text-gray-500 text-sm py-3">Nenhuma conquista secreta disponível neste filtro.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {blockedSecretAchievements.map((achievement) => (
                          <AchievementCard
                            key={achievement.id}
                            achievement={achievement}
                            highlighted={false}
                            onClick={() => setDetailModal({ type: "achievement", value: achievement })}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === "titles" && (
              <div className="space-y-4">
                <RarityFilterBar selected={titleFilter} onChange={setTitleFilter} />

                <SectionHeader title="Desbloqueados" subtitle={`${unlockedTitles.length} desbloqueados`} />
                {unlockedTitles.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-3">Nenhum título desbloqueado neste filtro.</p>
                ) : (
                  <div className="space-y-3">
                    {unlockedTitles.map((title) => (
                      <TitleCard key={title.id} title={title} onClick={() => setDetailModal({ type: "title", value: title })} />
                    ))}
                  </div>
                )}

                <SectionHeader title="Bloqueados" subtitle={`${blockedRegularTitles.length} restantes`} />
                {blockedRegularTitles.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-3">Nenhum título bloqueado neste filtro.</p>
                ) : (
                  <div className="space-y-3">
                    {blockedRegularTitles.map((title) => (
                      <TitleCard key={title.id} title={title} onClick={() => setDetailModal({ type: "title", value: title })} />
                    ))}
                  </div>
                )}

                {(titleFilter === "Todos" || titleFilter === "Secreto") && blockedSecretTitles.length > 0 && (
                  <>
                    <SectionHeader title="Secretos" subtitle="? secretos" />
                    <div className="space-y-3">
                      {blockedSecretTitles.map((title) => (
                        <TitleCard key={title.id} title={title} onClick={() => setDetailModal({ type: "title", value: title })} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="px-6 mt-6 pb-6">
          <ProfileFriendsPanel />
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Configurações</h2>
              <button onClick={() => setSettingsOpen(false)} className="fl-btn-secondary rounded-lg px-3 py-1">Fechar</button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Informações da conta</h3>
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
                  <h3 className="font-semibold text-gray-900">Personalização (mobile)</h3>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => primaryColorInputRef.current?.click()}
                      className="h-12 rounded-lg border-2 border-white/20 shadow-inner"
                      style={{ backgroundColor: primaryColor }}
                      type="button"
                      aria-label="Selecionar cor primária"
                    />
                    <button
                      onClick={() => secondaryColorInputRef.current?.click()}
                      className="h-12 rounded-lg border-2 border-white/20 shadow-inner"
                      style={{ backgroundColor: secondaryColor }}
                      type="button"
                      aria-label="Selecionar cor secundária"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Cor primária</span>
                    <span>Cor secundária</span>
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

                  <label className="block text-sm font-medium text-gray-700">Fonte do título</label>
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
                    <button onClick={() => { void applySolidBackground(); }} className="fl-btn-secondary rounded-xl py-2 w-full">Fundo sólido</button>
                    <label className="fl-btn-secondary rounded-xl py-2 text-center cursor-pointer block">
                      Escolher foto
                      <input type="file" accept="image/*" className="hidden" onChange={onPickBackgroundImage} />
                    </label>
                  </div>

                  {bgPreview && (
                    <img
                      src={bgPreview}
                      alt="Prévia do fundo"
                      loading="lazy"
                      decoding="async"
                      className="w-full h-28 object-cover rounded-xl border border-gray-200"
                    />
                  )}

                  {customizationSaving && (
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <LoadingBall size="sm" />
                      Salvando personalização...
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">
                  Personalização visual disponível apenas no mobile (largura até 768px).
                </div>
              )}

              <div className="rounded-2xl border border-gray-200 p-4 space-y-3">
                <h3 className="font-semibold text-gray-900">Enviar Feedback</h3>
                <select
                  value={feedbackType}
                  onChange={(event) => setFeedbackType(event.target.value as "Sugestao" | "Bug" | "Elogio" | "Outro")}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="Sugestao">Sugestao</option>
                  <option value="Bug">Bug</option>
                  <option value="Elogio">Elogio</option>
                  <option value="Outro">Outro</option>
                </select>
                <textarea
                  value={feedbackMessage}
                  onChange={(event) => setFeedbackMessage(event.target.value)}
                  className="w-full min-h-[110px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm resize-y"
                  placeholder="Escreva seu feedback aqui..."
                />
                {feedbackStatus && (
                  <p
                    className={`text-sm ${
                      feedbackStatus.type === "success" ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {feedbackStatus.message}
                  </p>
                )}
                <button
                  onClick={() => { void sendFeedback(); }}
                  disabled={feedbackSending}
                  className="fl-btn-primary rounded-xl px-4 py-2 min-w-[120px] inline-flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {feedbackSending ? <LoadingBall size="sm" /> : null}
                  {feedbackSending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailModal && (
        <ProfileDetailModal
          detail={detailModal}
          showcasedAchievementIds={showcasedAchievementIds}
          showcasePendingId={showcasePendingId}
          titlePendingId={titlePendingId}
          onClose={() => setDetailModal(null)}
          onAddAchievement={handleAddAchievementToShowcase}
          onRemoveAchievement={handleRemoveAchievementFromShowcase}
          onEquipTitle={handleActivateTitle}
          onUnequipTitle={handleDeactivateTitle}
        />
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
  const unlocked = achievement.unlocked === 1;
  const isSecret = Number(achievement.secret ?? 0) === 1;
  const isSecretLocked = isSecret && !unlocked;

  const rarityColorByLabel = {
    Comum: "#D1D5DB",
    Incomum: "#22C55E",
    Raro: "#3B82F6",
    "Mítico": "#EF4444",
    Secreto: "#F59E0B",
  } as const;

  const normalizeRarity = (value: string | undefined) => {
    if (!value) return undefined;
    const normalized = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (normalized.includes("incomum")) return "Incomum" as const;
    if (normalized.includes("comum")) return "Comum" as const;
    if (normalized.includes("raro")) return "Raro" as const;
    if (normalized.includes("mitico")) return "Mítico" as const;
    if (normalized.includes("secreto")) return "Secreto" as const;
    return undefined;
  };

  const normalizedRarity = normalizeRarity(achievement.rarity);
  const rarityColor = unlocked
    ? (achievement.color || (normalizedRarity ? rarityColorByLabel[normalizedRarity] : undefined) || "#D1D5DB")
    : null;
  const displayName = isSecretLocked ? "?" : achievement.name;
  const displayDescription = isSecretLocked ? "?" : achievement.description;
  const cardClassName = unlocked
    ? "bg-white/90 text-gray-700 border-2"
    : "bg-gray-200 text-gray-500 border-2 border-gray-300 grayscale opacity-70";
  const icon = isSecretLocked ? "?" : unlocked ? "🏆" : "🔒";

  return (
    <div
      className={`rounded-2xl p-4 shadow-lg text-center ${cardClassName}`}
      style={unlocked && rarityColor ? { borderColor: rarityColor } : undefined}
    >
      <div className="text-3xl mb-2" style={unlocked && rarityColor ? { color: rarityColor } : undefined}>{icon}</div>
      <h3 className="font-bold text-sm mb-1" style={unlocked && rarityColor ? { color: rarityColor } : undefined}>
        {displayName}
      </h3>
      <p className="text-xs opacity-90">{displayDescription}</p>
      {unlocked && achievement.unlocked_at && (
        <p className="text-xs opacity-75 mt-2">
          {new Date(achievement.unlocked_at).toLocaleDateString()}
        </p>
      )}
    </button>
  );
}

function TitleCard({ title, onClick }: { title: TitleWithUnlock; onClick: () => void }) {
  const unlocked = title.unlocked === 1;
  const active = title.is_active === 1;
  const secretLocked = isTitleSecretLocked(title);
  const rarityColor = unlocked ? resolveRarityColor(title) : null;
  const displayName = secretLocked ? "???" : title.name;
  const displayDescription = secretLocked
    ? "Continue evoluindo para descobrir este título."
    : title.description ?? "Sem descrição";
  const badgeLabel = secretLocked ? "?" : normalizeRarity(title.rarity);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border-2 p-4 text-left shadow-lg transition-transform hover:-translate-y-0.5 ${
        unlocked
          ? "bg-white/90 text-gray-800"
          : "bg-gray-200 text-gray-500 border-gray-300 grayscale opacity-75"
      } ${active ? "ring-2 ring-emerald-400" : ""}`}
      style={unlocked && rarityColor ? { borderColor: rarityColor } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold leading-tight" style={unlocked && rarityColor ? { color: rarityColor } : undefined}>
          {displayName}
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            unlocked ? "text-white" : "bg-gray-300 text-gray-600"
          }`}
          style={unlocked && rarityColor ? { backgroundColor: rarityColor } : undefined}
        >
          {badgeLabel}
        </span>
      </div>
      <p className="mt-1 text-xs">{displayDescription}</p>
      {active && <p className="mt-2 text-[11px] font-semibold text-emerald-700">Equipado no perfil</p>}
    </button>
  );
}

function ProfileDetailModal({
  detail,
  showcasedAchievementIds,
  showcasePendingId,
  titlePendingId,
  onClose,
  onAddAchievement,
  onRemoveAchievement,
  onEquipTitle,
  onUnequipTitle,
}: {
  detail: Exclude<DetailModalState, null>;
  showcasedAchievementIds: number[];
  showcasePendingId: number | null;
  titlePendingId: number | null;
  onClose: () => void;
  onAddAchievement: (id: number) => Promise<void>;
  onRemoveAchievement: (id: number) => Promise<void>;
  onEquipTitle: (id: number) => Promise<void>;
  onUnequipTitle: (id: number) => Promise<void>;
}) {
  if (detail.type === "achievement") {
    const achievement = detail.value;
    const unlocked = achievement.unlocked === 1;
    const secretLocked = isAchievementSecretLocked(achievement);
    const rarityColor = unlocked ? resolveRarityColor(achievement) : "#9CA3AF";
    const rarityLabel = normalizeRarity(achievement.rarity);
    const unlockedAt = unlocked ? formatUnlockDateTime(achievement.unlocked_at) : null;
    const isShowcased = showcasedAchievementIds.includes(achievement.id);
    const showcaseLimitReached = showcasedAchievementIds.length >= SHOWCASED_ACHIEVEMENT_LIMIT && !isShowcased;
    const canManageShowcase = unlocked;
    const pending = showcasePendingId === achievement.id;
    const displayName = secretLocked ? "???" : achievement.name;
    const displayDescription = achievement.description ?? "Sem descri\u00e7\u00e3o.";
    const displayCondition = formatUnlockCondition(achievement.condition);
    const icon = secretLocked ? "?" : achievement.icon || "?";

    return (
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
        <button type="button" className="absolute inset-0" aria-label="Fechar modal" onClick={onClose} />
        <div className="relative z-10 w-full sm:max-w-xl bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">Detalhes da Conquista</h2>
            <button type="button" onClick={onClose} className="fl-btn-secondary rounded-lg px-3 py-1 text-sm">Fechar</button>
          </div>

          {unlocked ? (
            <>
              <div className="mt-5 flex items-start gap-4">
                <div
                  className="h-16 w-16 rounded-2xl border-2 flex items-center justify-center text-3xl bg-white"
                  style={{ borderColor: rarityColor, color: rarityColor }}
                >
                  {icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold leading-tight" style={{ color: rarityColor }}>
                    {displayName}
                  </h3>
                  <span
                    className="inline-flex mt-2 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: rarityColor }}
                  >
                    {rarityLabel}
                  </span>
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-gray-700">
                <p>{displayDescription}</p>
                <p>
                  <strong className="text-gray-900">Condi\u00e7\u00e3o:</strong>{" "}
                  {displayCondition ?? "Condi\u00e7\u00e3o n\u00e3o informada."}
                </p>
                {unlockedAt && (
                  <p>
                    <strong className="text-gray-900">Desbloqueada em:</strong> {unlockedAt}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="mt-5">
              <h3 className="text-xl font-bold leading-tight text-gray-900">{displayName}</h3>
            </div>
          )}

          {canManageShowcase && (
            <div className="mt-6">
              {isShowcased ? (
                <button
                  type="button"
                  onClick={() => { void onRemoveAchievement(achievement.id); }}
                  disabled={pending}
                  className="fl-btn-secondary rounded-xl px-4 py-2 disabled:opacity-60"
                >
                  {pending ? "Removendo..." : "Remover do Perfil"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { void onAddAchievement(achievement.id); }}
                  disabled={pending || showcaseLimitReached}
                  className="fl-btn-primary rounded-xl px-4 py-2 disabled:opacity-60"
                >
                  {pending ? "Adicionando..." : "Adicionar ao Perfil"}
                </button>
              )}
              {showcaseLimitReached && (
                <p className="mt-2 text-xs text-amber-700">
                  Limite de {SHOWCASED_ACHIEVEMENT_LIMIT} conquistas em destaque atingido.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const title = detail.value;
  const unlocked = title.unlocked === 1;
  const active = title.is_active === 1;
  const secretLocked = isTitleSecretLocked(title);
  const rarityColor = unlocked ? resolveRarityColor(title) : "#9CA3AF";
  const rarityLabel = secretLocked ? "?" : normalizeRarity(title.rarity);
  const unlockedAt = unlocked ? formatUnlockDateTime(title.unlocked_at) : null;
  const displayName = secretLocked ? "???" : title.name;
  const displayDescription = secretLocked
    ? "Continue evoluindo para descobrir este título."
    : title.description ?? "Sem descrição.";
  const displayCondition = secretLocked ? null : formatUnlockCondition(title.unlock_condition);
  const pending = titlePendingId === title.id;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <button type="button" className="absolute inset-0" aria-label="Fechar modal" onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-xl bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Detalhes do Título</h2>
          <button type="button" onClick={onClose} className="fl-btn-secondary rounded-lg px-3 py-1 text-sm">Fechar</button>
        </div>

        <div className="mt-5">
          <h3 className="text-2xl font-bold leading-tight" style={unlocked ? { color: rarityColor } : undefined}>
            {displayName}
          </h3>
          <span
            className={`inline-flex mt-2 rounded-full px-2.5 py-1 text-xs font-semibold ${
              unlocked ? "text-white" : "bg-gray-200 text-gray-600"
            }`}
            style={unlocked ? { backgroundColor: rarityColor } : undefined}
          >
            {rarityLabel}
          </span>
        </div>

        <div className="mt-5 space-y-3 text-sm text-gray-700">
          <p>{displayDescription}</p>
          {!secretLocked && (
            <p>
              <strong className="text-gray-900">Condição:</strong>{" "}
              {displayCondition ?? "Condição não informada."}
            </p>
          )}
          {unlockedAt && (
            <p>
              <strong className="text-gray-900">Desbloqueado em:</strong> {unlockedAt}
            </p>
          )}
        </div>

        {unlocked && (
          <div className="mt-6">
            {active ? (
              <button
                type="button"
                onClick={() => { void onUnequipTitle(title.id); }}
                disabled={pending}
                className="fl-btn-secondary rounded-xl px-4 py-2 disabled:opacity-60"
              >
                {pending ? "Desequipando..." : "Desequipar"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { void onEquipTitle(title.id); }}
                disabled={pending}
                className="fl-btn-primary rounded-xl px-4 py-2 disabled:opacity-60"
              >
                {pending ? "Equipando..." : "Equipar"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
