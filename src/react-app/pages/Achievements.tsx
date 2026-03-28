import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/react-app/auth/context";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  Trophy,
  Lock,
  ListFilter,
  Search,
  Star,
  Flame,
  Zap,
  CheckCircle2,
  X,
  Award,
  Crown,
} from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
import PageLoader from "@/react-app/components/PageLoader";
import { api, clearJsonCache, fetchAndCacheJson } from "@/react-app/utils/api";
import type { AchievementWithUnlock, UserProfile, UserProgression } from "@/shared/types";
import { getAchievementShowcaseStyle, resolveShowcasedAchievement, sanitizeAchievementsForDisplay } from "@/react-app/utils/achievementShowcase";

type RarityFilter = "ALL" | "COMUM" | "INCOMUM" | "RARO" | "MITICO" | "SECRETO";
type NormalizedRarity = Exclude<RarityFilter, "ALL">;

const RARITY_CONFIG: Record<NormalizedRarity, { color: string; label: string }> = {
  COMUM: { color: "#94a3b8", label: "Comum" },
  INCOMUM: { color: "#22c55e", label: "Incomum" },
  RARO: { color: "#0070dd", label: "Raro" },
  MITICO: { color: "#a335ee", label: "Mítico" },
  SECRETO: { color: "#ff8000", label: "Secreto" },
};

function normalizeRarity(value: string | null | undefined): NormalizedRarity {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();

  if (normalized === "COMUM" || normalized === "INCOMUM" || normalized === "RARO" || normalized === "MITICO" || normalized === "SECRETO") {
    return normalized;
  }

  return "COMUM";
}

export default function Achievements() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [achievements, setAchievements] = useState<AchievementWithUnlock[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRarity, setActiveRarity] = useState<RarityFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementWithUnlock | null>(null);
  const [honorSaving, setHonorSaving] = useState(false);
  const [honorStatus, setHonorStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [nextAchievements, nextProfile, nextProgression] = await Promise.all([
        fetchAndCacheJson<AchievementWithUnlock[]>("/api/achievements"),
        fetchAndCacheJson<UserProfile>("/api/profile"),
        fetchAndCacheJson<UserProgression>("/api/progression"),
      ]);

      setAchievements(Array.isArray(nextAchievements) ? sanitizeAchievementsForDisplay(nextAchievements) : []);
      setProfile(nextProfile);
      setProgression(nextProgression);
    } catch (loadError) {
      console.error("Error loading achievements:", loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }

    void loadData();
  }, [loadData, navigate, user]);

  const filteredAchievements = useMemo(() => {
    return achievements.filter((achievement) => {
      const rarity = normalizeRarity(achievement.rarity);
      const matchesRarity = activeRarity === "ALL" || rarity === activeRarity;
      const matchesSearch =
        achievement.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (achievement.description || "").toLowerCase().includes(searchQuery.toLowerCase());

      return matchesRarity && matchesSearch;
    });
  }, [achievements, activeRarity, searchQuery]);
  const filteredUnlockedAchievements = useMemo(
    () => filteredAchievements.filter((achievement) => achievement.unlocked === 1),
    [filteredAchievements],
  );
  const filteredLockedAchievements = useMemo(
    () => filteredAchievements.filter((achievement) => achievement.unlocked !== 1),
    [filteredAchievements],
  );
  const showcasedAchievement = useMemo(
    () => resolveShowcasedAchievement(profile?.showcased_achievements ?? user?.showcased_achievements ?? null, achievements),
    [achievements, profile?.showcased_achievements, user?.showcased_achievements],
  );
  const showcasedAchievementTone = useMemo(() => {
    if (!showcasedAchievement) return null;
    return getAchievementShowcaseStyle(showcasedAchievement.rarity);
  }, [showcasedAchievement]);

  const unlockedCount = achievements.filter((achievement) => achievement.unlocked === 1).length;
  const progressPercent = achievements.length > 0 ? (unlockedCount / achievements.length) * 100 : 0;
  const hasFilteredResults = filteredUnlockedAchievements.length > 0 || filteredLockedAchievements.length > 0;

  const honorAchievement = useCallback(async (achievement: AchievementWithUnlock) => {
    setHonorSaving(true);
    setHonorStatus(null);

    try {
      const response = await api("/api/profile/customization", {
        method: "POST",
        body: JSON.stringify({
          showcased_achievements: [{ id: achievement.id, name: achievement.name }],
        }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string | undefined; profile?: UserProfile | undefined } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Não foi possível honrar a conquista agora.");
      }

      clearJsonCache("/api/profile");

      if (payload?.profile) {
        setProfile(payload.profile);
      }

      setHonorStatus({ type: "success", message: "Conquista honrada equipada." });
    } catch (error) {
      setHonorStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível honrar a conquista agora.",
      });
    } finally {
      setHonorSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <AppPageShell bottomNavActive="missions" className="fl-theme-page">
        <PageLoader />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell bottomNavActive="missions" className="fl-theme-page" profile={profile ?? undefined} progression={progression ?? undefined}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 pb-4 sm:p-6 md:p-8 min-w-0">
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="fl-theme-surface-soft inline-flex w-fit items-center gap-2 rounded-2xl px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] fl-theme-text-muted transition-opacity hover:opacity-85"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span>Voltar</span>
            </button>

            {showcasedAchievement && showcasedAchievementTone ? (
              <div
                className="inline-flex max-w-full items-center gap-2 self-start rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] sm:self-auto"
                style={{
                  borderColor: showcasedAchievementTone.borderColor,
                  color: showcasedAchievementTone.textColor,
                  backgroundColor: showcasedAchievementTone.backgroundColor,
                  boxShadow: showcasedAchievementTone.badgeShadow,
                }}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: showcasedAchievementTone.iconBackground,
                    color: showcasedAchievementTone.accent,
                  }}
                >
                  <Award className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">Honrada: {showcasedAchievement.name}</span>
              </div>
            ) : null}
          </div>

          <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_400px]">
            <div>
              <header className="mb-6 sm:mb-8 min-w-0">
                <h1 className="mb-1 sm:mb-2 text-2xl sm:text-4xl font-black uppercase tracking-[0.1em] sm:tracking-[0.2em] md:text-5xl truncate">Hall of Fame</h1>
                <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.3em] truncate" style={{ color: "var(--app-primary-color)" }}>
                  Seu legado imortalizado em conquistas épicas.
                </p>
              </header>

              <div className="flex flex-wrap gap-3 sm:gap-4 min-w-0">
                <StatsCard icon={Trophy} label="Concluídas" value={`${unlockedCount} / ${achievements.length}`} />
                <StatsCard icon={Flame} label="Rank Atual" value="ELITE IV" />
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2.5rem] border p-8" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 5%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
              <div
                className="pointer-events-none absolute -right-16 top-0 h-40 w-40 rounded-full"
                style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--app-primary-color) 16%, transparent) 0%, transparent 72%)" }}
              />
              <div
                className="pointer-events-none absolute -left-8 bottom-0 h-32 w-32 rounded-full"
                style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--app-secondary-color) 10%, transparent) 0%, transparent 72%)" }}
              />
              <div className="relative z-10 flex h-full flex-col justify-between">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-[0.3em]">Dominação Total</h3>
                  <span className="text-xl font-black" style={{ color: "var(--app-primary-color)" }}>{Math.round(progressPercent)}%</span>
                </div>
                <div className="mb-6 h-4 overflow-hidden rounded-full border" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 72%, transparent)" }}>
                  <div className="h-full transition-all duration-1000" style={{ width: `${progressPercent}%`, backgroundColor: "var(--app-primary-color)" }} />
                </div>
                <p className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-widest leading-loose">
                  Desbloqueie mais conquistas para chegar ao rank máximo.
                </p>
              </div>
              <Crown className="absolute -bottom-6 -right-6 size-32 rotate-12" style={{ color: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }} />
            </div>
          </div>

          <div className="mb-10 flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex w-full flex-wrap gap-2 md:w-auto">
              <button
                type="button"
                onClick={() => setActiveRarity("ALL")}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[11px] font-bold transition-all hover:scale-[1.02]"
                style={{
                  backgroundColor: activeRarity === "ALL" ? "var(--app-primary-color)" : "var(--fl-surface-muted)",
                  color: activeRarity === "ALL" ? "var(--fl-nav-item-active-text)" : "var(--fl-color-text-muted)",
                  boxShadow: activeRarity === "ALL"
                    ? "0 10px 24px color-mix(in srgb, var(--app-primary-color) 22%, transparent)"
                    : undefined,
                }}
              >
                <ListFilter className="h-4 w-4 shrink-0" />
                Todos
              </button>
              {(Object.keys(RARITY_CONFIG) as NormalizedRarity[]).map((rarity) => (
                <button
                  key={rarity}
                  type="button"
                  onClick={() => setActiveRarity(rarity)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[11px] font-medium transition-colors whitespace-nowrap"
                  style={{
                    backgroundColor: activeRarity === rarity
                      ? `color-mix(in srgb, ${RARITY_CONFIG[rarity].color} 18%, var(--fl-surface-muted))`
                      : "var(--fl-surface-muted)",
                    color: activeRarity === rarity ? "var(--fl-color-text)" : "var(--fl-color-text-muted)",
                    border: activeRarity === rarity
                      ? `1px solid color-mix(in srgb, ${RARITY_CONFIG[rarity].color} 42%, transparent)`
                      : "1px solid transparent",
                    boxShadow: activeRarity === rarity
                      ? `0 10px 24px color-mix(in srgb, ${RARITY_CONFIG[rarity].color} 16%, transparent)`
                      : undefined,
                  }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RARITY_CONFIG[rarity].color }} />
                  {RARITY_CONFIG[rarity].label}
                </button>
              ))}
            </div>

            <div className="group relative w-full md:w-80">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 fl-theme-text-muted" />
              <input
                type="text"
                placeholder="Filtrar conquistas..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="fl-theme-input w-full rounded-2xl py-3 pl-11 pr-4 text-[11px] font-bold uppercase tracking-widest focus:outline-none"
              />
            </div>
          </div>

          {hasFilteredResults ? (
            <div className="space-y-10">
              <AchievementSection
                title="Desbloqueadas"
                description="Escolha aqui a conquista que vai aparecer como honrada no seu perfil e dashboard."
                items={filteredUnlockedAchievements}
                showcasedAchievementId={showcasedAchievement?.id ?? null}
                onSelect={(achievement) => {
                  setHonorStatus(null);
                  setSelectedAchievement(achievement);
                }}
              />

              <AchievementSection
                title="Bloqueadas"
                description="Conquistas ainda não liberadas."
                items={filteredLockedAchievements}
                showcasedAchievementId={showcasedAchievement?.id ?? null}
                onSelect={(achievement) => {
                  setHonorStatus(null);
                  setSelectedAchievement(achievement);
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Star className="mb-6 h-16 w-16 fl-theme-text-soft" />
              <p className="fl-theme-text-muted text-[11px] font-bold uppercase tracking-[0.2em]">
                Nenhuma conquista encontrada neste filtro.
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedAchievement ? (
        <div className="fl-z-modal fixed inset-0 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md" onClick={() => setSelectedAchievement(null)}>
          <div className="relative w-full max-w-lg overflow-hidden rounded-[3rem] border p-8 shadow-[0_0_100px_rgba(0,0,0,0.8)]" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 98%, transparent)" }} onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelectedAchievement(null)}
              className="fl-theme-surface-soft absolute right-6 top-6 rounded-full p-2 fl-theme-text-muted transition-opacity hover:opacity-80"
            >
              <X className="h-6 w-6" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className={`mb-8 flex size-32 items-center justify-center rounded-[2.5rem] border-2 p-8 ${selectedAchievement.unlocked !== 1 ? "grayscale" : ""}`} style={{ borderColor: selectedAchievement.unlocked === 1 ? RARITY_CONFIG[normalizeRarity(selectedAchievement.rarity)].color : "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 84%, transparent)" }}>
                <Award className="size-full" style={{ color: selectedAchievement.unlocked === 1 ? RARITY_CONFIG[normalizeRarity(selectedAchievement.rarity)].color : "var(--fl-color-text-soft)" }} />
              </div>

              <span className="mb-3 text-[10px] font-black uppercase tracking-[0.4em]" style={{ color: selectedAchievement.unlocked === 1 ? RARITY_CONFIG[normalizeRarity(selectedAchievement.rarity)].color : "var(--fl-color-text-soft)" }}>
                Conquista {RARITY_CONFIG[normalizeRarity(selectedAchievement.rarity)].label}
              </span>

              <h2 className="mb-4 text-3xl font-black uppercase tracking-tight">{selectedAchievement.name}</h2>
              <p className="fl-theme-text-muted mb-8 px-6 text-sm font-medium leading-relaxed">
                {selectedAchievement.description || ""}
              </p>

              <div className="mb-8 grid w-full grid-cols-2 gap-4">
                <div className="rounded-2xl border p-4" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)" }}>
                  <span className="fl-theme-text-muted mb-1 block text-[9px] font-bold uppercase tracking-widest">Recompensa</span>
                  <div className="flex items-center justify-center gap-2">
                    <Zap className="h-4 w-4" style={{ color: "var(--app-primary-color)" }} />
                    <span className="text-xl font-black">+50 XP</span>
                  </div>
                </div>
                <div className="rounded-2xl border p-4" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)" }}>
                  <span className="fl-theme-text-muted mb-1 block text-[9px] font-bold uppercase tracking-widest">Status</span>
                  <span className="text-sm font-black uppercase tracking-widest" style={{ color: selectedAchievement.unlocked === 1 ? "var(--app-primary-color)" : "var(--fl-color-text-muted)" }}>
                    {selectedAchievement.unlocked === 1 ? "Conquistado" : "Bloqueado"}
                  </span>
                </div>
              </div>

              {selectedAchievement.unlocked === 1 ? (
                <>
                  {honorStatus ? (
                    <p className={`mb-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] ${honorStatus.type === "success" ? "" : "text-red-400"}`} style={honorStatus.type === "success" ? { color: "var(--app-primary-color)" } : undefined}>
                      {honorStatus.message}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => { void honorAchievement(selectedAchievement); }}
                    disabled={honorSaving || showcasedAchievement?.id === selectedAchievement.id}
                    className="w-full rounded-2xl py-5 text-[12px] font-black uppercase tracking-[0.3em] transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
                    style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
                  >
                    {showcasedAchievement?.id === selectedAchievement.id
                      ? "Conquista Honrada"
                      : honorSaving
                        ? "Honrando..."
                        : "Honrar Conquista"}
                  </button>
                </>
              ) : (
                <div className="w-full rounded-2xl border py-5 text-[10px] font-black uppercase tracking-[0.2em]" style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}>
                  Continue treinando para desbloquear
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AppPageShell>
  );
}

function StatsCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
}) {
  return (
    <div className="fl-theme-surface min-w-[140px] sm:min-w-[200px] flex-1 rounded-2xl p-4 sm:p-5 min-w-0">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex size-10 sm:size-12 items-center justify-center rounded-xl" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" style={{ color: "var(--app-primary-color)" }} />
        </div>
        <div className="min-w-0">
          <span className="fl-theme-text-muted mb-0.5 sm:mb-1 block text-[8px] sm:text-[10px] font-bold uppercase tracking-widest truncate">{label}</span>
          <span className="text-lg sm:text-2xl font-black truncate">{value}</span>
        </div>
      </div>
    </div>
  );
}

function AchievementSection({
  title,
  description,
  items,
  showcasedAchievementId,
  onSelect,
}: {
  title: string;
  description: string;
  items: AchievementWithUnlock[];
  showcasedAchievementId: number | null;
  onSelect: (achievement: AchievementWithUnlock) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.2em]">{title}</h2>
          <p className="fl-theme-text-muted mt-2 text-[10px] font-bold uppercase tracking-[0.16em]">
            {description}
          </p>
        </div>
        <span className="self-start rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] sm:self-auto" style={{ color: "var(--app-primary-color)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
          {items.length} {items.length === 1 ? "conquista" : "conquistas"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((achievement) => {
          const rarity = normalizeRarity(achievement.rarity);
          const rarityStyle = RARITY_CONFIG[rarity];
          const isLocked = achievement.unlocked !== 1;
          const isShowcased = showcasedAchievementId === achievement.id;

          return (
            <button
              key={achievement.id}
              type="button"
              onClick={() => onSelect(achievement)}
              className={`group relative flex h-full flex-col overflow-hidden rounded-[2rem] border p-6 text-left transition-all duration-300 ${isLocked ? "opacity-50 grayscale" : "hover:-translate-y-1"}`}
              style={{
                borderColor: isShowcased
                  ? "var(--app-primary-color)"
                  : isLocked
                    ? "var(--fl-border-soft)"
                    : "color-mix(in srgb, var(--app-primary-color) 16%, var(--fl-border-soft))",
                backgroundColor: isLocked
                  ? "color-mix(in srgb, var(--fl-surface-muted) 76%, transparent)"
                  : "color-mix(in srgb, var(--fl-surface-strong) 96%, transparent)",
                boxShadow: isShowcased
                  ? "0 0 0 1px color-mix(in srgb, var(--app-primary-color) 24%, transparent), 0 18px 40px color-mix(in srgb, var(--app-primary-color) 12%, transparent)"
                  : undefined,
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-90"
                style={{
                  background: isLocked
                    ? "none"
                    : `radial-gradient(circle at top right, color-mix(in srgb, ${rarityStyle.color} 14%, transparent) 0%, transparent 56%)`,
                }}
              />

              <div className="mb-6 flex items-start justify-between gap-3">
                <div className="flex size-14 items-center justify-center rounded-2xl border p-3" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 80%, transparent)" }}>
                  {isLocked ? <Lock className="h-6 w-6 fl-theme-text-muted" /> : <Award className="h-8 w-8" style={{ color: rarityStyle.color }} />}
                </div>
                {isShowcased ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em]"
                    style={{
                      borderColor: `color-mix(in srgb, ${rarityStyle.color} 42%, transparent)`,
                      color: rarityStyle.color,
                      backgroundColor: `color-mix(in srgb, ${rarityStyle.color} 16%, var(--fl-surface-muted))`,
                    }}
                  >
                    <Award className="h-3 w-3 shrink-0" />
                    Honrada
                  </span>
                ) : !isLocked ? (
                  <div className="flex size-6 items-center justify-center rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                    <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--app-primary-color)" }} />
                  </div>
                ) : null}
              </div>

              <div className="mb-4 flex-1">
                <h4 className="mb-2 text-sm font-black uppercase tracking-tight">{achievement.name}</h4>
                <p className="fl-theme-text-muted line-clamp-2 text-[10px] font-bold uppercase tracking-wider">
                  {achievement.description || ""}
                </p>
              </div>

              <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: "var(--fl-border-soft)" }}>
                <span className="rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: rarityStyle.color, backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 74%, transparent)" }}>
                  {rarityStyle.label}
                </span>
                <div className="flex items-center gap-1">
                  <Zap className="h-3 w-3 animate-pulse" style={{ color: "var(--app-primary-color)" }} />
                  <span className="text-xs font-black">+50 XP</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
