import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { 
  Settings, 
  LogOut, 
  Target, 
  Award, 
  Badge,
  Trophy, 
  Dumbbell, 
  Users, 
  Shield,
  Zap,
  Flame,
  Lock,
  Activity,
  Moon,
  Sun,
  X
} from "lucide-react";
import { useAuth } from "@/react-app/contexts/auth";
import { useTheme } from "@/react-app/contexts/theme";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import PageLoader from "@/react-app/components/PageLoader";
import { Avatar } from "@/react-app/components/ui/avatar";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import { TrainingRankDisplay, useTrainingRank } from "@/react-app/components/TrainingRankDisplay";

import type {
  AchievementWithUnlock,
  SkillWithProgress,
  TitleWithUnlock,
  UserAttributes,
  UserProfile,
  UserProgression,
} from "@/shared/types";
import { ApiRequestError, api, clearJsonCache, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import { getAchievementShowcaseStyle, resolveShowcasedAchievement, sanitizeAchievementsForDisplay } from "@/react-app/utils/achievementShowcase";
import { applyProfileTheme } from "@/react-app/utils/theme";

const FEEDBACK_TYPES = ["Sugestao", "Bug", "Elogio", "Outro"] as const;
type FeedbackType = (typeof FEEDBACK_TYPES)[number];

function isFeedbackType(value: string): value is FeedbackType {
  return FEEDBACK_TYPES.includes(value as FeedbackType);
}

const ATTRIBUTE_META = [
  { key: "strength", label: "FOR", sigla: "STR", icon: Shield, fill: "linear-gradient(90deg, color-mix(in srgb, var(--app-primary-color) 78%, transparent), var(--app-primary-color))" },
  { key: "constitution", label: "CON", sigla: "CON", icon: Zap, fill: "linear-gradient(90deg, color-mix(in srgb, var(--app-secondary-color) 70%, #38bdf8), #38bdf8)" },
  { key: "vitality", label: "VIT", sigla: "VIT", icon: Flame, fill: "linear-gradient(90deg, color-mix(in srgb, var(--app-primary-color) 58%, #22c55e), #22c55e)" },
  { key: "dexterity", label: "DES", sigla: "DEX", icon: Target, fill: "linear-gradient(90deg, #8b5cf6, #ec4899)" },
  { key: "focus", label: "FOCO", sigla: "FOC", icon: Award, fill: "linear-gradient(90deg, #facc15, #f59e0b)" },
] as const;

export default function Profile() {
  const { user, logout } = useAuth();
  const { themeMode, toggleThemeMode } = useTheme();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [attributes, setAttributes] = useState<UserAttributes | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [skills, setSkills] = useState<SkillWithProgress[]>([]);
  const [achievements, setAchievements] = useState<AchievementWithUnlock[]>([]);
  const [titles, setTitles] = useState<TitleWithUnlock[]>([]);
  const [benchmarks, setBenchmarks] = useState<any[]>([]);
  const [tab, setTab] = useState<"attributes" | "skills">("attributes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("Sugestao");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Função para converter benchmarks da API para o formato esperado pelo sistema de rank
  const getBenchmarkResults = useCallback(() => {
    if (!benchmarks || benchmarks.length === 0) return undefined;
    
    // Pega o benchmark mais recente
    const latest = benchmarks[0];
    
    // Calcula skillStageScore baseado nos skills
    const skillStageScore = skills.reduce((score, skill) => {
      // Adiciona pontos baseados no progresso do skill
      if (skill.total_reps >= 100) score += 2;
      else if (skill.total_reps >= 50) score += 1;
      else if (skill.total_reps >= 10) score += 0.5;
      return score;
    }, 0);
    
    const result: {
      pushUpMaxReps?: number;
      squatMaxReps?: number;
      plankMaxSeconds?: number;
      sitUpMaxReps?: number;
      skillStageScore?: number;
    } = {};
    
    if (latest.pushups_max) result.pushUpMaxReps = Number(latest.pushups_max);
    if (latest.squats_max) result.squatMaxReps = Number(latest.squats_max);
    if (latest.plank_seconds) result.plankMaxSeconds = Number(latest.plank_seconds);
    if (latest.situps_max) result.sitUpMaxReps = Number(latest.situps_max);
    if (skillStageScore > 0) result.skillStageScore = skillStageScore;
    
    return result;
  }, [benchmarks, skills]);

  // NOVO: Hook para calcular rank de treinamento (read-only, seguro)
  const { snapshot: trainingRank, isLoading: rankLoading, error: rankError } = useTrainingRank(
    progression,
    skills.map(skill => ({
      id: skill.id,
      user_id: user?.id || '',
      created_at: '',
      updated_at: '',
      skill_id: skill.id,
      total_reps: skill.total_reps,
      total_time: 0,
      best_reps: skill.best_reps,
      unlocked_at: ''
    })),
    getBenchmarkResults()
  );


  const syncProfileThemeState = useCallback((nextProfile: UserProfile) => {
    setProfile(nextProfile);
    applyProfileTheme(nextProfile);
  }, []);

  const loadData = useCallback(async () => {
    setError(null);
    const cachedProfile = readCachedJson<UserProfile>("/api/profile");
    const cachedAttributes = readCachedJson<UserAttributes>("/api/attributes");
    const cachedProgression = readCachedJson<UserProgression>("/api/progression");
    const cachedSkills = readCachedJson<SkillWithProgress[]>("/api/skills");
    const cachedAchievements = readCachedJson<AchievementWithUnlock[]>("/api/achievements");
    const cachedTitles = readCachedJson<TitleWithUnlock[]>("/api/titles");

    if (cachedProfile) syncProfileThemeState(cachedProfile.data);
    if (cachedAttributes) setAttributes(cachedAttributes.data);
    if (cachedProgression) setProgression(cachedProgression.data);
    if (cachedSkills) setSkills(Array.isArray(cachedSkills.data) ? cachedSkills.data : []);
    if (cachedAchievements) {
      setAchievements(
        Array.isArray(cachedAchievements.data)
          ? sanitizeAchievementsForDisplay(cachedAchievements.data)
          : [],
      );
    }
    if (cachedTitles) setTitles(Array.isArray(cachedTitles.data) ? cachedTitles.data : []);

    const hasCache = Boolean(cachedProfile && cachedAttributes && cachedProgression);
    if (hasCache) setLoading(false);

    try {
      const [p, a, pr, s, ach, t, b] = await Promise.all([
        fetchAndCacheJson<UserProfile>("/api/profile"),
        fetchAndCacheJson<UserAttributes>("/api/attributes"),
        fetchAndCacheJson<UserProgression>("/api/progression"),
        fetchAndCacheJson<SkillWithProgress[]>("/api/skills"),
        fetchAndCacheJson<AchievementWithUnlock[]>("/api/achievements"),
        fetchAndCacheJson<TitleWithUnlock[]>("/api/titles"),
        fetchAndCacheJson<any[]>("/api/benchmarks").catch(() => ({ data: [] })) // Fallback para benchmarks
      ]);

      syncProfileThemeState(p);
      setAttributes(a);
      setProgression(pr);
      setSkills(Array.isArray(s) ? s : []);
      setAchievements(Array.isArray(ach) ? sanitizeAchievementsForDisplay(ach) : []);
      setTitles(Array.isArray(t) ? t : []);
      setBenchmarks(Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app", { replace: true });
        return;
      }
      if (!hasCache) setError("Não foi possível carregar o perfil agora.");
    } finally {
      setLoading(false);
    }
  }, [navigate, syncProfileThemeState]);

  useEffect(() => {
    if (!user) {
      navigate("/app", { replace: true });
      return;
    }
    void loadData();
  }, [user, navigate, loadData]);

  const activeTitle = useMemo(() => titles.find((item) => item.is_active === 1), [titles]);
  const showcasedAchievement = useMemo(
    () => resolveShowcasedAchievement(profile?.showcased_achievements ?? user?.showcased_achievements ?? null, achievements),
    [achievements, profile?.showcased_achievements, user?.showcased_achievements],
  );
  const showcasedAchievementTone = useMemo(() => {
    if (!showcasedAchievement) return null;
    return getAchievementShowcaseStyle(showcasedAchievement.rarity);
  }, [showcasedAchievement]);

  const combatPower = useMemo(() => {
    if (!attributes) return 0;
    return (attributes.strength + attributes.constitution + attributes.vitality + attributes.dexterity + attributes.focus) * 10;
  }, [attributes]);

  const levelProgress = useMemo(() => {
    if (!progression) return 0;
    const currentXp = progression.xp || 0;
    const nextLevelXp = Math.max(100, (progression.level || 1) * 100);
    return Math.min((currentXp / nextLevelXp) * 100, 100);
  }, [progression]);

  const radarPoints = useMemo(() => {
    if (!attributes) return "";
    const size = 100;
    const center = size / 2;
    const values = [
      attributes.strength,
      attributes.constitution,
      attributes.vitality,
      attributes.dexterity,
      attributes.focus
    ];
    
    return values.map((val, i) => {
      const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const r = (Math.min(val, 100) / 100) * (size / 2);
      const x = center + r * Math.cos(angle);
      const y = center + r * Math.sin(angle);
      return `${x},${y}`;
    }).join(" ");
  }, [attributes]);

  if (loading && !profile) {
    return (
      <AppPageShell bottomNavActive="profile" className="fl-theme-page">
        <PageLoader />
      </AppPageShell>
    );
  }

  const handleLogout = async () => {
    try {
      await api("/api/logout");
    } finally {
      logout();
      clearJsonCache();
      navigate("/app", { replace: true });
    }
  };

  const updateFocus = async (focus: "calistenia" | "yoga") => {
    try {
      await api("/api/profile/skill-focus", {
        method: "POST",
        body: JSON.stringify({ active_skill_focus: focus }),
      });
      setProfile((current) => (current ? { ...current, active_skill_focus: focus } : current));
    } catch {
      setError("Não foi possível alterar o foco agora.");
    }
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
        body: JSON.stringify({ type: feedbackType, message: feedbackMessage.trim() }),
      });
      if (!response.ok) throw new Error("Falha ao enviar feedback.");
      setFeedbackMessage("");
      setFeedbackStatus({ type: "success", message: "Feedback enviado! Obrigado." });
    } catch (submitError) {
      setFeedbackStatus({
        type: "error",
        message: submitError instanceof Error ? submitError.message : "Não foi possível enviar feedback agora.",
      });
    } finally {
      setFeedbackSending(false);
    }
  };


  return (
    <AppPageShell bottomNavActive="profile" className="fl-theme-page">
      <main className="custom-scrollbar flex flex-1 flex-col gap-5 sm:gap-8 overflow-y-auto p-4 pb-[98px] sm:p-6 lg:flex-row lg:gap-12 lg:p-10 min-w-0">
        {error ? (
          <div className="lg:hidden rounded-3xl border px-5 py-4 text-[11px] font-bold uppercase tracking-widest" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
            {error}
          </div>
        ) : null}
        
        {/* Sidebar Identity Column */}
        <aside className="w-full lg:w-[360px] flex flex-col gap-6 shrink-0">
          
          {/* Identity Card */}
          <section className="fl-theme-surface rounded-3xl p-8 flex flex-col items-center text-center relative overflow-hidden group">
            {error ? (
              <div className="mb-6 w-full rounded-2xl border px-4 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
                {error}
              </div>
            ) : null}
            <div className="absolute top-0 left-0 w-full h-1 bg-primary/20 group-hover:bg-primary transition-colors" style={{ backgroundColor: 'var(--app-primary-color-20)' }}></div>
            
            <div className="relative mb-6 sm:mb-8">
              <div className="size-32 sm:size-40 rounded-full border-4 border-primary p-1 shadow-[0_0_30px_rgba(var(--app-primary-color-rgb),0.2)] animate-pulse-slow" style={{ borderColor: 'var(--app-primary-color)' }}>
                <Avatar name={profile?.username || "Guerreiro"} className="w-full h-full text-3xl sm:text-4xl" />
              </div>
              <div className="absolute bottom-1 right-1 flex size-10 sm:size-12 items-center justify-center rounded-full border-4 text-base font-bold shadow-xl" style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)', borderColor: 'var(--fl-surface-strong)' }}>
                {progression?.level || 1}
              </div>
            </div>

            <div className="mb-8">
              <h1 className="mb-2 text-2xl font-bold uppercase tracking-tight leading-tight" style={{ color: "var(--fl-color-text)" }}>{profile?.full_name}</h1>
              <p className="text-primary font-bold text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--app-primary-color)' }}>
                {activeTitle?.name || "RECRUTA FITLOOT"}
              </p>
              {showcasedAchievement && showcasedAchievementTone && (
                <div className="mt-2 min-w-0">
                  <span
                    className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] sm:text-xs font-bold"
                    style={{
                      borderColor: showcasedAchievementTone.borderColor,
                      color: showcasedAchievementTone.textColor,
                      backgroundColor: showcasedAchievementTone.backgroundColor,
                      boxShadow: showcasedAchievementTone.badgeShadow,
                    }}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: showcasedAchievementTone.iconBackground,
                        color: showcasedAchievementTone.accent,
                      }}
                    >
                      <Award className="h-3 w-3" />
                    </span>
                    <span className="truncate">{showcasedAchievement.name}</span>
                  </span>
                </div>
              )}
            </div>

            <div className="flex w-full flex-wrap gap-2 border-t pt-5 sm:gap-3 sm:pt-8 min-w-0" style={{ borderColor: "var(--fl-border-soft)" }}>
              <button 
                onClick={() => navigate(ROUTE_PATHS.achievements)}
                className="fl-theme-input flex min-w-[7.5rem] flex-1 items-center justify-center gap-1.5 rounded-2xl px-2 py-3 fl-theme-text-muted transition-opacity group hover:opacity-85 sm:min-w-0 sm:gap-2 sm:py-4"
              >
                <Trophy className="size-3.5 shrink-0 transition-colors sm:size-4" style={{ color: 'var(--app-primary-color)' }} />
                <span className="text-[8px] font-bold uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-widest truncate">Conquistas</span>
              </button>
              <button 
                onClick={() => navigate(ROUTE_PATHS.titles)}
                className="fl-theme-input flex min-w-[7.5rem] flex-1 items-center justify-center gap-1.5 rounded-2xl px-2 py-3 fl-theme-text-muted transition-opacity group hover:opacity-85 sm:min-w-0 sm:gap-2 sm:py-4"
              >
                <Badge className="size-3.5 shrink-0 transition-colors sm:size-4" style={{ color: 'var(--app-primary-color)' }} />
                <span className="text-[8px] font-bold uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-widest truncate">Títulos</span>
              </button>
              <button 
                onClick={() => navigate(ROUTE_PATHS.friends)}
                className="fl-theme-input flex min-w-[7.5rem] flex-1 items-center justify-center gap-1.5 rounded-2xl px-2 py-3 fl-theme-text-muted transition-opacity group hover:opacity-85 sm:min-w-0 sm:gap-2 sm:py-4"
              >
                <Users className="size-3.5 shrink-0 transition-colors sm:size-4" style={{ color: 'var(--app-primary-color)' }} />
                <span className="text-[8px] font-bold uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-widest truncate">Amigos</span>
              </button>
            </div>
          </section>

          {/* NOVO: Training Rank Card */}
          <section className="fl-theme-surface rounded-3xl p-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--fl-color-text-muted)" }}>Rank de Treinamento</h3>
              <TrainingRankDisplay 
                snapshot={trainingRank} 
                isLoading={rankLoading}
                error={rankError}
                compact={true}
              />
            </div>
            <TrainingRankDisplay 
              snapshot={trainingRank} 
              isLoading={rankLoading}
              error={rankError}
              showDetails={true}
            />
          </section>

          {/* XP Progress Card */}
          <section className="fl-theme-surface rounded-3xl p-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--fl-color-text-muted)" }}>Experiência (XP)</h3>
              <span className="text-[10px] font-bold text-primary" style={{ color: 'var(--app-primary-color)' }}>{progression?.xp || 0} / {Math.max(100, (progression?.level || 1) * 100)}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full border" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)" }}>
              <div 
                className="h-full bg-primary relative shadow-[0_0_15px_rgba(var(--app-primary-color-rgb),0.4)] transition-all duration-1000" 
                style={{ width: `${levelProgress}%`, backgroundColor: 'var(--app-primary-color)' }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
              </div>
            </div>
          </section>

          {/* Quick Actions */}
          <div className="flex flex-col gap-3">
             <button 
                onClick={() => setSettingsOpen(true)}
                className="fl-theme-surface flex items-center justify-center gap-3 rounded-2xl py-4 text-[10px] font-bold fl-theme-text-muted uppercase tracking-widest transition-opacity hover:opacity-85"
              >
                <Settings className="size-4" /> Configurações
             </button>

             <button 
                onClick={handleLogout}
                className="flex items-center justify-center gap-3 bg-red-500/5 border border-red-500/10 rounded-2xl py-4 text-[10px] font-bold text-red-400/60 uppercase tracking-widest hover:text-red-400 hover:bg-red-500/10 transition-all"
             >
                <LogOut className="size-4" /> Encerrar Sessão
             </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <section className="flex-1 flex flex-col gap-8">
          
          {/* Tab Navigation */}
          <nav className="flex items-center gap-6 border-b sm:gap-8" style={{ borderColor: "var(--fl-border-soft)" }}>
            <button 
              onClick={() => setTab("attributes")}
              className="relative pb-4 text-xs font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-85"
              style={{ color: tab === 'attributes' ? 'var(--app-primary-color)' : 'var(--fl-color-text-muted)' }}
            >
              Atributos
              {tab === 'attributes' && <div className="absolute bottom-[-1px] left-0 w-full h-0.5 bg-primary shadow-[0_0_10px_rgba(var(--app-primary-color-rgb),0.5)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
            <button 
              onClick={() => setTab("skills")}
              className="relative pb-4 text-xs font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-85"
              style={{ color: tab === 'skills' ? 'var(--app-primary-color)' : 'var(--fl-color-text-muted)' }}
            >
              Habilidades
              {tab === 'skills' && <div className="absolute bottom-[-1px] left-0 w-full h-0.5 bg-primary shadow-[0_0_10px_rgba(var(--app-primary-color-rgb),0.5)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
          </nav>

          {/* Conditional Rendering Area */}
          <div className="flex-1 min-h-0">
            {tab === 'attributes' ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
                
                {/* Core Stats List */}
                <div className="flex flex-col gap-6">
                  <header className="flex items-center gap-3 mb-2">
                    <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary" style={{ color: 'var(--app-primary-color)' }}>
                      <Activity className="size-4" />
                    </div>

                    <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: "var(--fl-color-text)" }}>Atributos Principais</h3>
                  </header>

                  <div className="space-y-8">
                    {ATTRIBUTE_META.map((attr) => {
                      const value = attributes ? Number(attributes[attr.key as keyof UserAttributes]) || 0 : 0;
                      return (
                        <div key={attr.key} className="group">
                          <div className="mb-3 flex items-center justify-between" style={{ color: "var(--fl-color-text)" }}>
                            <div className="flex items-center gap-3">
                              <attr.icon className="size-4 text-primary group-hover:scale-110 transition-transform" style={{ color: 'var(--app-primary-color)' }} />
                              <span className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-widest transition-opacity group-hover:opacity-80">{attr.label} ({attr.sigla})</span>
                            </div>
                            <span className="text-sm font-black tracking-tighter">{value}</span>
                          </div>
                          <div className="h-3.5 w-full overflow-hidden rounded-full border p-0.5" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 74%, transparent)" }}>
                            <div 
                              className="h-full rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(var(--app-primary-color-rgb),0.2)]" 
                              style={{ width: `${Math.min(value, 100)}%`, background: attr.fill }}
                            ></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Radar Chart Visualizer */}
                <div className="fl-theme-surface-muted flex flex-col items-center justify-center rounded-3xl p-10 backdrop-blur-sm relative overflow-hidden group">
                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(var(--app-primary-color-rgb),0.05)_0%,transparent_70%)]"></div>
                   
                   <div className="relative size-60 sm:size-72">
                      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl overflow-visible">
                        {/* Grids */}
                        {[20, 40, 60, 80, 100].map(r => (
                          <polygon 
                            key={r}
                            points={ATTRIBUTE_META.map((_, i) => {
                              const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
                              return `${50 + (r/2) * Math.cos(angle)},${50 + (r/2) * Math.sin(angle)}`;
                            }).join(" ")}
                            fill="none"
                            stroke="var(--fl-border-soft)"
                            strokeWidth="0.5"
                          />
                        ))}
                        
                        {/* Axis */}
                        {ATTRIBUTE_META.map((_, i) => {
                           const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
                           return <line key={i} x1="50" y1="50" x2={50 + 50 * Math.cos(angle)} y2={50 + 50 * Math.sin(angle)} stroke="var(--fl-border-soft)" strokeWidth="0.5" />
                        })}

                        {/* Data Polygon */}
                        <polygon 
                          points={radarPoints}
                          fill="rgba(var(--app-primary-color-rgb), 0.15)"
                          stroke="var(--app-primary-color)"
                          strokeWidth="1.5"
                          className="transition-all duration-1000"
                        />
                        
                        {/* Labels */}
                        {ATTRIBUTE_META.map((attr, i) => {
                           const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
                           const r = 62;
                           const x = 50 + r * Math.cos(angle);
                           const y = 50 + r * Math.sin(angle);
                           return (
                             <text 
                              key={i} 
                              x={x} 
                              y={y} 
                              textAnchor="middle" 
                              dominantBaseline="middle" 
                              className="text-[4px] font-black fill-slate-500 uppercase tracking-widest"
                             >
                               {attr.sigla}
                             </text>
                           )
                        })}
                      </svg>
                   </div>

                   <div className="mt-12 text-center relative z-10">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "var(--fl-color-text-muted)" }}>Poder de Combate</p>
                      <h4 className="text-4xl font-black tracking-tighter shadow-primary-glow" style={{ color: "var(--fl-color-text)" }}>{combatPower.toLocaleString()}</h4>
                   </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                <header className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary" style={{ color: 'var(--app-primary-color)' }}>
                    <Dumbbell className="size-4" />
                  </div>
                  <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: "var(--fl-color-text)" }}>Árvore de Habilidades</h3>
                </header>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
                  {skills.length === 0 ? (
                    <div className="fl-theme-surface col-span-full rounded-3xl border border-dashed py-12 text-center" style={{ borderColor: "var(--fl-border-soft)" }}>
                      <p className="text-xs font-bold text-slate-600 uppercase tracking-widest">Nenhuma skill dominada ainda.</p>
                    </div>
                  ) : skills.map((skill) => {
                    const isUnlocked = skill.total_reps > 0;
                    return (
                      <div 
                        key={skill.id}
                        className={`group relative flex flex-col items-center gap-4 rounded-3xl border p-5 transition-all duration-500 ${isUnlocked ? 'hover:scale-105 shadow-lg shadow-primary/5' : 'grayscale opacity-50'}`}
                        style={{
                          borderColor: isUnlocked
                            ? "color-mix(in srgb, var(--app-primary-color) 22%, var(--fl-border-soft))"
                            : "var(--fl-border-soft)",
                          backgroundColor: isUnlocked
                            ? "color-mix(in srgb, var(--app-primary-color) 8%, var(--fl-surface-strong))"
                            : "color-mix(in srgb, var(--fl-surface-muted) 78%, transparent)",
                        }}
                      >

                         <div
                           className="size-14 rounded-2xl flex items-center justify-center transition-all duration-500"
                           style={{
                             backgroundColor: isUnlocked
                               ? "color-mix(in srgb, var(--app-primary-color) 18%, transparent)"
                               : "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)",
                             color: isUnlocked ? "var(--app-primary-color)" : "var(--fl-color-text-soft)",
                           }}
                         >
                            {isUnlocked ? <Zap className="size-7" /> : <Lock className="size-6" />}
                         </div>
                         <div className="text-center min-w-0 w-full">
                           <span className="block truncate text-[9px] font-black uppercase tracking-widest" style={{ color: isUnlocked ? 'var(--app-primary-color)' : 'var(--fl-color-text-muted)' }}>{skill.name}</span>
                         </div>
                         {isUnlocked && (
                           <div className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-black shadow-lg" style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}>
                              L{Math.floor(skill.total_reps / 50) + 1}
                           </div>
                         )}
                      </div>
                    )
                  })}

                </div>
              </div>
            )}
          </div>
          
        </section>

      </main>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fl-z-modal fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-fadeIn">
          <div className="fl-theme-surface w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-2xl animate-scaleIn max-h-[90vh] flex flex-col">
            <header className="flex items-center justify-between border-b p-8 shrink-0" style={{ borderColor: "var(--fl-border-soft)" }}>
              <h2 className="text-xl font-bold tracking-tight uppercase tracking-widest" style={{ color: "var(--fl-color-text)" }}>Configurações</h2>
              <button 
                onClick={() => setSettingsOpen(false)}
                className="fl-theme-surface-soft size-10 flex items-center justify-center rounded-xl fl-theme-text-muted transition-opacity hover:opacity-80"
              >
                <X className="size-5" />
              </button>
            </header>

            <div className="p-8 overflow-y-auto custom-scrollbar flex-1 space-y-8">
              {/* Account Info */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-primary uppercase tracking-[0.3em]" style={{ color: 'var(--app-primary-color)' }}>Sua Conta</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="fl-theme-input rounded-2xl p-4">
                    <p className="mb-1 text-[9px] font-bold uppercase" style={{ color: "var(--fl-color-text-muted)" }}>Nome Real</p>
                    <p className="text-sm font-bold uppercase" style={{ color: "var(--fl-color-text)" }}>{profile?.full_name}</p>
                  </div>
                  <div className="fl-theme-input rounded-2xl p-4">
                    <p className="mb-1 text-[9px] font-bold uppercase" style={{ color: "var(--fl-color-text-muted)" }}>Username</p>
                    <p className="text-sm font-bold uppercase" style={{ color: "var(--fl-color-text)" }}>@{profile?.username}</p>
                  </div>
                </div>
              </section>

              {/* Training Focus */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-primary uppercase tracking-[0.3em]" style={{ color: 'var(--app-primary-color)' }}>Foco de Treinamento</h3>
                <div className="grid grid-cols-2 gap-4">
                  {(['calistenia', 'yoga'] as const).map(focus => (
                    <button 
                      key={focus}
                      onClick={() => updateFocus(focus)}
                      className={`py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${profile?.active_skill_focus === focus ? 'bg-primary' : 'fl-theme-input fl-theme-text-muted hover:opacity-80'}`}
                      style={{ backgroundColor: profile?.active_skill_focus === focus ? 'var(--app-primary-color)' : '', color: profile?.active_skill_focus === focus ? 'var(--fl-nav-item-active-text)' : undefined }}
                    >
                      {focus === 'calistenia' ? 'Foco Calistenia' : 'Foco Yoga'}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-primary uppercase tracking-[0.3em]" style={{ color: 'var(--app-primary-color)' }}>Aparência</h3>
                <div className="fl-theme-input rounded-[1.75rem] p-5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--fl-color-text)" }}>
                      {themeMode === "dark" ? "Tema Escuro" : "Tema Claro"}
                    </p>
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--fl-color-text-muted)" }}>
                      Aplicação imediata em todo o app
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleThemeMode}
                    role="switch"
                    aria-checked={themeMode === "dark"}
                    aria-label={themeMode === "dark" ? "Tema Escuro" : "Tema Claro"}
                    className="relative flex h-12 w-24 shrink-0 items-center rounded-full border px-1 transition-all"
                    style={{
                      backgroundColor: themeMode === "dark"
                        ? "color-mix(in srgb, var(--app-primary-color) 18%, transparent)"
                        : "color-mix(in srgb, var(--fl-surface-muted) 96%, transparent)",
                      borderColor: themeMode === "dark"
                        ? "color-mix(in srgb, var(--app-primary-color) 30%, transparent)"
                        : "var(--fl-border-soft)",
                    }}
                  >
                    <span
                      className="absolute top-1 flex size-10 items-center justify-center rounded-full shadow-lg transition-all"
                      style={{
                        left: themeMode === "dark" ? "calc(100% - 2.75rem)" : "0.25rem",
                        backgroundColor: "var(--app-primary-color)",
                        color: "var(--fl-nav-item-active-text)",
                      }}
                    >
                      {themeMode === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
                    </span>
                  </button>
                </div>
              </section>

              {/* Feedback Section */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-primary uppercase tracking-[0.3em]" style={{ color: 'var(--app-primary-color)' }}>Feedback do Atleta</h3>
                <div className="space-y-3">
                  <select 
                    value={feedbackType} 
                    onChange={(e) => {
                      if (isFeedbackType(e.target.value)) {
                        setFeedbackType(e.target.value);
                      }
                    }}
                    className="fl-theme-input w-full rounded-2xl px-6 py-4 text-xs font-bold uppercase tracking-widest outline-none transition-all"
                    style={{ color: "var(--fl-color-text)" }}
                  >
                    <option value="Sugestao">Sugestão</option>
                    <option value="Bug">Reportar Bug</option>
                    <option value="Elogio">Elogio</option>
                    <option value="Outro">Outro</option>
                  </select>
                  <textarea 
                    value={feedbackMessage}
                    onChange={(e) => setFeedbackMessage(e.target.value)}
                    placeholder="Sugestões de novas skills ou melhorias..."
                    className="fl-theme-input min-h-[120px] w-full rounded-2xl px-6 py-4 text-xs font-bold uppercase tracking-widest outline-none transition-all"
                    style={{ color: "var(--fl-color-text)" }}
                  />
                  {feedbackStatus && (
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${feedbackStatus.type === 'success' ? 'text-primary' : 'text-red-400'}`} style={{ color: feedbackStatus.type === 'success' ? 'var(--app-primary-color)' : '' }}>
                      {feedbackStatus.message}
                    </p>
                  )}
                  <button 
                    onClick={sendFeedback}
                    disabled={feedbackSending}
                    className="fl-theme-input w-full rounded-2xl py-4 text-[10px] font-bold fl-theme-text-muted uppercase tracking-[0.2em] transition-opacity hover:opacity-85 disabled:opacity-50"
                  >
                    {feedbackSending ? <LoadingBall size="sm" /> : 'Enviar Relatório de Combate'}
                  </button>
                </div>
              </section>
            </div>

            <footer className="p-8 border-t shrink-0" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 58%, transparent)" }}>
               <button 
                onClick={() => setSettingsOpen(false)}
                className="w-full rounded-2xl bg-primary py-5 text-xs font-black uppercase tracking-[0.3em] shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
               >
                 Confirmar Alterações
               </button>
            </footer>
          </div>
        </div>
      )}
    </AppPageShell>
  );
}
