import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  Badge,
  CheckCircle2,
  Crown,
  ListFilter,
  Lock,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/react-app/auth/context";
import AppPageShell from "@/react-app/components/AppPageShell";
import PageLoader from "@/react-app/components/PageLoader";
import {
  ApiRequestError,
  api,
  clearJsonCache,
  fetchAndCacheJson,
  readCachedJson,
} from "@/react-app/utils/api";
import { getAchievementShowcaseStyle } from "@/react-app/utils/achievementShowcase";
import type { TitleWithUnlock, UserProfile, UserProgression } from "@/shared/types";
import { repairKnownMojibakeString } from "@/shared/textEncoding";

type TitleFilter = "ALL" | "COMUM" | "INCOMUM" | "RARO" | "MITICO" | "SECRETO";
type NormalizedRarity = Exclude<TitleFilter, "ALL">;
const SECONDARY_PROFILE_CACHE_TTL_MS = 5 * 60_000;

const RARITY_CONFIG: Record<NormalizedRarity, { color: string; label: string }> = {
  COMUM: { color: "#94a3b8", label: "Comum" },
  INCOMUM: { color: "#22c55e", label: "Incomum" },
  RARO: { color: "#0070dd", label: "Raro" },
  MITICO: { color: "#a335ee", label: "Mítico" },
  SECRETO: { color: "#ff8000", label: "Secreto" },
};

function sanitizeTitlesForDisplay(titles: TitleWithUnlock[]): TitleWithUnlock[] {
  // Corrige textos conhecidos antes da exibicao no frontend.
  return titles.map((title) => ({
    ...title,
    name: repairKnownMojibakeString(title.name),
    rarity: repairKnownMojibakeString(title.rarity),
    description: typeof title.description === "string" ? repairKnownMojibakeString(title.description) : title.description,
    reference: typeof title.reference === "string" ? repairKnownMojibakeString(title.reference) : title.reference,
    unlock_condition: typeof title.unlock_condition === "string" ? repairKnownMojibakeString(title.unlock_condition) : title.unlock_condition,
  }));
}

function normalizeRarity(value: string | null | undefined) {
  const normalized = repairKnownMojibakeString(String(value ?? ""))
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();

  if (normalized === "COMUM" || normalized === "INCOMUM" || normalized === "RARO" || normalized === "MITICO" || normalized === "SECRETO") {
    return normalized;
  }

  return "COMUM";
}

function formatRarityLabel(value: string | null | undefined) {
  return RARITY_CONFIG[normalizeRarity(value)].label;
}

function formatUnlockCondition(title: TitleWithUnlock) {
  // Traduz o unlock_condition tecnico em texto amigavel para a galeria.
  const condition = title.unlock_condition?.trim();
  if (!condition) return title.description ?? "Disponível ao cumprir os requisitos do título.";

  const [type, rawValue, extraValue] = condition.split(":");
  const primaryValue = Number(rawValue);

  if (type === "level" && Number.isFinite(primaryValue)) {
    return `Alcance o nível ${primaryValue}.`;
  }

  if (type === "missions" && Number.isFinite(primaryValue)) {
    return `Complete ${primaryValue} missões.`;
  }

  if (type === "streak" && Number.isFinite(primaryValue)) {
    return `Mantenha ${primaryValue} dias de sequência.`;
  }

  if (type === "weekly" && Number.isFinite(primaryValue)) {
    return `Conclua ${primaryValue} missões semanais.`;
  }

  if (type === "skills" && Number.isFinite(primaryValue)) {
    return `Desbloqueie ${primaryValue} habilidades.`;
  }

  if (type === "failures" && Number.isFinite(primaryValue)) {
    return `Persista após ${primaryValue} falhas.`;
  }

  if (type === "strength" && Number.isFinite(primaryValue)) {
    return `Alcance ${primaryValue} pontos de força.`;
  }

  if (type === "skill" && rawValue && extraValue) {
    return `Evolua ${rawValue} até o estágio ${extraValue}.`;
  }

  return condition;
}

export default function Titles() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [titles, setTitles] = useState<TitleWithUnlock[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<TitleFilter>("ALL");
  const [equipPendingId, setEquipPendingId] = useState<number | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadData = useCallback(async () => {
    setStatus(null);

    const cachedTitles = readCachedJson<TitleWithUnlock[]>("/api/titles");
    const cachedProfile = readCachedJson<UserProfile>("/api/profile", SECONDARY_PROFILE_CACHE_TTL_MS);
    const cachedProgression = readCachedJson<UserProgression>("/api/progression", SECONDARY_PROFILE_CACHE_TTL_MS);

    if (cachedTitles) {
      setTitles(Array.isArray(cachedTitles.data) ? sanitizeTitlesForDisplay(cachedTitles.data) : []);
    }
    if (cachedProfile) setProfile(cachedProfile.data);
    if (cachedProgression) setProgression(cachedProgression.data);

    const hasCache = Boolean(cachedTitles && cachedProfile && cachedProgression);
    if (hasCache) setLoading(false);

    try {
      const shouldFetch = (entry: { stale: boolean } | null): boolean => !entry || entry.stale;
      const primaryTasks: Array<() => Promise<void>> = [];
      const secondaryTasks: Array<() => Promise<void>> = [];

      if (shouldFetch(cachedTitles)) {
        primaryTasks.push(() =>
          fetchAndCacheJson<TitleWithUnlock[]>("/api/titles").then((payload) => {
            setTitles(Array.isArray(payload) ? sanitizeTitlesForDisplay(payload) : []);
          }),
        );
      }

      if (!cachedProfile) {
        secondaryTasks.push(() =>
          fetchAndCacheJson<UserProfile>("/api/profile").then((payload) => {
            setProfile(payload);
          }),
        );
      }

      if (!cachedProgression) {
        secondaryTasks.push(() =>
          fetchAndCacheJson<UserProgression>("/api/progression").then((payload) => {
            setProgression(payload);
          }),
        );
      }

      if (primaryTasks.length > 0) {
        await Promise.all(primaryTasks.map((task) => task()));
      }

      setLoading(false);

      if (secondaryTasks.length > 0) {
        void Promise.allSettled(secondaryTasks.map((task) => task()));
      }
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app", { replace: true });
        return;
      }

      if (!hasCache) {
        setStatus({ type: "error", message: "Não foi possível carregar os títulos agora." });
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!user) {
      navigate("/app", { replace: true });
      return;
    }

    void loadData();
  }, [loadData, navigate, user]);

  const activeTitle = useMemo(
    () => titles.find((title) => title.is_active === 1 || title.is_equipped === 1) ?? null,
    [titles],
  );
  const unlockedCount = useMemo(() => titles.filter((title) => title.unlocked === 1).length, [titles]);
  const filteredTitles = useMemo(() => {
    const visibleTitles = titles.filter((title) => {
      if (activeFilter === "ALL") return true;
      return normalizeRarity(title.rarity) === activeFilter;
    });

    return [...visibleTitles].sort((left, right) => {
      const leftUnlocked = left.unlocked === 1 ? 1 : 0;
      const rightUnlocked = right.unlocked === 1 ? 1 : 0;
      if (rightUnlocked !== leftUnlocked) return rightUnlocked - leftUnlocked;

      const leftRarity = normalizeRarity(left.rarity);
      const rightRarity = normalizeRarity(right.rarity);
      if (leftRarity !== rightRarity && activeFilter === "ALL") {
        const rarityOrder: NormalizedRarity[] = ["SECRETO", "MITICO", "RARO", "INCOMUM", "COMUM"];
        return rarityOrder.indexOf(leftRarity) - rarityOrder.indexOf(rightRarity);
      }

      const leftActive = left.is_active === 1 || left.is_equipped === 1 ? 1 : 0;
      const rightActive = right.is_active === 1 || right.is_equipped === 1 ? 1 : 0;
      if (rightActive !== leftActive) return rightActive - leftActive;

      return left.name.localeCompare(right.name, "pt-BR");
    });
  }, [activeFilter, titles]);
  const visibleLockedCount = useMemo(
    () => filteredTitles.filter((title) => title.unlocked !== 1).length,
    [filteredTitles],
  );
  const visibleUnlockedCount = useMemo(
    () => filteredTitles.filter((title) => title.unlocked === 1).length,
    [filteredTitles],
  );

  const equipTitle = useCallback(async (title: TitleWithUnlock) => {
    // Marca o titulo como ativo na conta do usuario.
    setEquipPendingId(title.id);
    setStatus(null);

    try {
      const response = await api(`/api/titles/${title.id}/activate`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Não foi possível equipar o título agora.");
      }

      clearJsonCache("/api/titles");
      const refreshedTitles = await fetchAndCacheJson<TitleWithUnlock[]>("/api/titles");
      setTitles(Array.isArray(refreshedTitles) ? sanitizeTitlesForDisplay(refreshedTitles) : []);
      setStatus({ type: "success", message: "Título equipado com sucesso." });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível equipar o título agora.",
      });
    } finally {
      setEquipPendingId(null);
    }
  }, []);

  if (loading) {
    return (
      <AppPageShell bottomNavActive="profile" className="fl-theme-page">
        <PageLoader />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      bottomNavActive="profile"
      className="fl-theme-page"
      profile={profile ?? undefined}
      progression={progression ?? undefined}
    >
      <main className="mx-auto w-full max-w-[72rem] px-4 pb-[98px] pt-4 sm:px-6 md:px-8 md:pt-8">
        <div className="space-y-8 sm:space-y-10">
          {/* Volta, contadores e status geral da colecao. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="fl-theme-surface-soft inline-flex w-fit items-center gap-2 rounded-2xl px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] fl-theme-text-muted transition-opacity hover:opacity-85"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span>Voltar</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{
                  borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
                  color: "var(--app-primary-color)",
                  backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)",
                }}
              >
                <Badge className="h-3.5 w-3.5 shrink-0" />
                {unlockedCount} desbloqueados
              </span>
              <span className="fl-theme-surface-soft rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] fl-theme-text-muted">
                {titles.length} títulos
              </span>
            </div>
          </div>

          {/* Hero da colecao e resumo dos titulos. */}
          <section className="relative overflow-hidden rounded-[2rem] border p-6 sm:p-8 md:p-10" style={{
            borderColor: "color-mix(in srgb, var(--app-primary-color) 16%, var(--fl-border-soft))",
            backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 94%, transparent)",
          }}>
            <div className="pointer-events-none absolute -right-20 top-0 h-52 w-52 rounded-full" style={{
              background: "radial-gradient(circle, color-mix(in srgb, var(--app-primary-color) 14%, transparent) 0%, transparent 72%)",
            }} />
            <div className="pointer-events-none absolute -left-12 bottom-0 h-44 w-44 rounded-full" style={{
              background: "radial-gradient(circle, color-mix(in srgb, var(--app-secondary-color) 10%, transparent) 0%, transparent 72%)",
            }} />

            <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em]" style={{
                  color: "var(--app-primary-color)",
                  backgroundColor: "color-mix(in srgb, var(--app-primary-color) 12%, transparent)",
                }}>
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  Hall de Títulos
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight sm:text-4xl md:text-5xl" style={{ color: "var(--fl-color-text)" }}>
                    Títulos e Epítetos
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed sm:text-base" style={{ color: "var(--fl-color-text-muted)" }}>
                    Escolha como seu nome aparece no perfil e destaque as conquistas que melhor representam sua jornada.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:w-auto">
                <div className="fl-theme-surface-soft rounded-[1.5rem] px-4 py-4 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] fl-theme-text-muted">Ativo</p>
                  <p className="mt-2 text-sm font-black sm:text-base" style={{ color: "var(--fl-color-text)" }}>
                    {activeTitle ? "1 título" : "Nenhum"}
                  </p>
                </div>
                <div className="fl-theme-surface-soft rounded-[1.5rem] px-4 py-4 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] fl-theme-text-muted">Coleção</p>
                  <p className="mt-2 text-sm font-black sm:text-base" style={{ color: "var(--fl-color-text)" }}>
                    {unlockedCount}/{titles.length}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Bloco do titulo atualmente equipado. */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
              <h2 className="text-lg font-black uppercase tracking-[0.16em] sm:text-xl" style={{ color: "var(--fl-color-text)" }}>
                Título Equipado
              </h2>
            </div>

            {activeTitle ? (
              <ActiveTitleCard title={activeTitle} />
            ) : (
              <div className="fl-theme-surface-soft rounded-[2rem] border border-dashed px-6 py-10 text-center" style={{ borderColor: "var(--fl-border-soft)" }}>
                <p className="text-sm font-black uppercase tracking-[0.16em]" style={{ color: "var(--fl-color-text)" }}>
                  Nenhum título equipado
                </p>
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em]" style={{ color: "var(--fl-color-text-muted)" }}>
                  Equipe um título desbloqueado na galeria abaixo.
                </p>
              </div>
            )}
          </section>

          {/* Filtros, status e galeria completa de titulos. */}
          <section className="space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-black uppercase tracking-[0.16em] sm:text-xl" style={{ color: "var(--fl-color-text)" }}>
                  Galeria de Títulos
                </h2>
                <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--fl-color-text-muted)" }}>
                  Filtre por raridade e equipe o que melhor representa sua build atual.
                </p>
              </div>

              <div className="flex w-full flex-wrap gap-2 lg:w-auto">
                <button
                  type="button"
                  onClick={() => setActiveFilter("ALL")}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[11px] font-bold transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: activeFilter === "ALL" ? "var(--app-primary-color)" : "var(--fl-surface-muted)",
                    color: activeFilter === "ALL" ? "var(--fl-nav-item-active-text)" : "var(--fl-color-text-muted)",
                    boxShadow: activeFilter === "ALL"
                      ? "0 10px 24px color-mix(in srgb, var(--app-primary-color) 22%, transparent)"
                      : undefined,
                  }}
                >
                  <ListFilter className="h-4 w-4 shrink-0" />
                  Todos
                </button>
                {(Object.keys(RARITY_CONFIG) as NormalizedRarity[]).map((rarity) => {
                  const isActive = activeFilter === rarity;

                  return (
                    <button
                      key={rarity}
                      type="button"
                      onClick={() => setActiveFilter(rarity)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[11px] font-medium transition-colors whitespace-nowrap"
                      style={{
                        backgroundColor: isActive
                          ? `color-mix(in srgb, ${RARITY_CONFIG[rarity].color} 18%, var(--fl-surface-muted))`
                          : "var(--fl-surface-muted)",
                        color: isActive ? "var(--fl-color-text)" : "var(--fl-color-text-muted)",
                        border: isActive
                          ? `1px solid color-mix(in srgb, ${RARITY_CONFIG[rarity].color} 42%, transparent)`
                          : "1px solid transparent",
                        boxShadow: isActive
                          ? `0 10px 24px color-mix(in srgb, ${RARITY_CONFIG[rarity].color} 16%, transparent)`
                          : undefined,
                      }}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RARITY_CONFIG[rarity].color }} />
                      {RARITY_CONFIG[rarity].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{
                  borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                  color: "var(--app-primary-color)",
                  backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)",
                }}
              >
                {visibleUnlockedCount} desbloqueados
              </span>
              <span className="fl-theme-surface-soft rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] fl-theme-text-muted">
                {visibleLockedCount} bloqueados
              </span>
            </div>

            {status ? (
              <div
                className="rounded-2xl border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em]"
                style={{
                  borderColor: status.type === "success"
                    ? "color-mix(in srgb, var(--app-primary-color) 28%, transparent)"
                    : "color-mix(in srgb, #ef4444 28%, transparent)",
                  backgroundColor: status.type === "success"
                    ? "color-mix(in srgb, var(--app-primary-color) 10%, transparent)"
                    : "color-mix(in srgb, #ef4444 10%, transparent)",
                  color: status.type === "success" ? "var(--app-primary-color)" : "#f87171",
                }}
              >
                {status.message}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filteredTitles.map((title) => (
                <TitleCard
                  key={title.id}
                  title={title}
                  equipPending={equipPendingId === title.id}
                  onEquip={() => { void equipTitle(title); }}
                />
              ))}
            </div>
          </section>
        </div>
      </main>
    </AppPageShell>
  );
}

function ActiveTitleCard({ title }: { title: TitleWithUnlock }) {
  const tone = getAchievementShowcaseStyle(title.rarity);

  return (
    // Destaque do titulo atualmente visivel no perfil.
    <div className="relative overflow-hidden rounded-[2rem] border p-6 sm:p-8" style={{
      borderColor: tone.borderColor,
      backgroundColor: tone.backgroundColor,
      boxShadow: tone.badgeShadow,
    }}>
      <div className="pointer-events-none absolute -right-10 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full" style={{
        background: `radial-gradient(circle, color-mix(in srgb, ${tone.accent} 18%, transparent) 0%, transparent 72%)`,
      }} />

      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border"
            style={{
              borderColor: tone.borderColor,
              backgroundColor: tone.iconBackground,
              color: tone.accent,
            }}
          >
            <Crown className="h-8 w-8" />
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="truncate text-2xl font-black tracking-tight" style={{ color: tone.textColor }}>
                {title.name}
              </h3>
              <span
                className="rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{
                  borderColor: tone.borderColor,
                  color: tone.textColor,
                  backgroundColor: tone.iconBackground,
                }}
              >
                {formatRarityLabel(title.rarity)}
              </span>
            </div>
            <p className="max-w-2xl text-sm font-medium leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
              {title.description ?? "Título ativo no seu perfil neste momento."}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 lg:items-end">
          <span className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: tone.textColor }}>
            Ativo atualmente
          </span>
          <div
            className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em]"
            style={{
              borderColor: tone.borderColor,
              backgroundColor: tone.iconBackground,
              color: tone.textColor,
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Equipado
          </div>
        </div>
      </div>
    </div>
  );
}

function TitleCard({
  title,
  equipPending,
  onEquip,
}: {
  title: TitleWithUnlock;
  equipPending: boolean;
  onEquip: () => void;
}) {
  const unlocked = title.unlocked === 1;
  const isActive = title.is_active === 1 || title.is_equipped === 1;
  const tone = getAchievementShowcaseStyle(title.rarity);

  return (
    // Card individual com estado bloqueado, desbloqueado ou equipado.
    <article
      className={`relative flex h-full flex-col overflow-hidden rounded-[2rem] border p-5 sm:p-6 ${unlocked ? "transition-transform duration-300 hover:-translate-y-1" : "opacity-80 grayscale-[0.18]"}`}
      style={{
        borderColor: unlocked ? tone.borderColor : "var(--fl-border-soft)",
        backgroundColor: unlocked
          ? "color-mix(in srgb, var(--fl-surface-strong) 96%, transparent)"
          : "color-mix(in srgb, var(--fl-surface-muted) 76%, transparent)",
        boxShadow: isActive ? tone.badgeShadow : undefined,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-80" style={{
        background: unlocked
          ? `radial-gradient(circle at top right, color-mix(in srgb, ${tone.accent} 12%, transparent) 0%, transparent 58%)`
          : "none",
      }} />

      <div className="relative z-10 flex h-full flex-col">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border"
            style={{
              borderColor: unlocked ? tone.borderColor : "var(--fl-border-soft)",
              backgroundColor: unlocked ? tone.iconBackground : "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)",
              color: unlocked ? tone.accent : "var(--fl-color-text-soft)",
            }}
          >
            {unlocked ? <Badge className="h-7 w-7" /> : <Lock className="h-6 w-6" />}
          </div>

          {isActive ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em]"
              style={{
                borderColor: tone.borderColor,
                color: tone.textColor,
                backgroundColor: tone.iconBackground,
              }}
            >
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              Equipado
            </span>
          ) : unlocked ? (
            <div
              className="flex size-7 items-center justify-center rounded-full"
              style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)" }}
            >
              <CheckCircle2 className="h-4 w-4" style={{ color: "var(--app-primary-color)" }} />
            </div>
          ) : (
            <span
              className="rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em]"
              style={{
                borderColor: "var(--fl-border-soft)",
                color: "var(--fl-color-text-soft)",
                backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 82%, transparent)",
              }}
            >
              Bloqueado
            </span>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <div className="space-y-2">
            <h3 className="text-xl font-black tracking-tight" style={{ color: unlocked ? "var(--fl-color-text)" : "var(--fl-color-text-soft)" }}>
              {title.name}
            </h3>
            <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
              {title.description ?? "Título desbloqueável conforme sua progressão."}
            </p>
          </div>

          <div className="rounded-2xl border px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em]" style={{
            borderColor: "var(--fl-border-soft)",
            color: unlocked ? "var(--fl-color-text-muted)" : "var(--fl-color-text)",
            backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)",
          }}>
            {unlocked ? `Referência: ${title.reference ?? "Perfil"}` : formatUnlockCondition(title)}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--fl-border-soft)" }}>
          <span
            className="rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-widest"
            style={{
              color: unlocked ? tone.textColor : "var(--fl-color-text-soft)",
              backgroundColor: unlocked ? tone.iconBackground : "color-mix(in srgb, var(--fl-surface-muted) 74%, transparent)",
            }}
          >
            {formatRarityLabel(title.rarity)}
          </span>

          {unlocked ? (
            <button
              type="button"
              onClick={onEquip}
              disabled={equipPending || isActive}
              className="rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] transition-all disabled:opacity-60"
              style={{
                backgroundColor: isActive ? tone.iconBackground : tone.accent,
                color: isActive ? tone.textColor : "var(--fl-nav-item-active-text)",
                border: `1px solid ${tone.borderColor}`,
              }}
            >
              {isActive ? "Equipado" : equipPending ? "Equipando..." : "Equipar"}
            </button>
          ) : (
            <div
              className="rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em]"
              style={{
                borderColor: "var(--fl-border-soft)",
                color: "var(--fl-color-text-soft)",
                backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 68%, transparent)",
              }}
            >
              Ver requisitos
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
