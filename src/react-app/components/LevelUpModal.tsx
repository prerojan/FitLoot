import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Award,
  Badge,
  Crown,
  Flame,
  Share2,
  Shield,
  Sparkles,
  Star,
  Target,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import LoadingBall from "@/react-app/components/LoadingBall";
import { useDailyMetrics } from "@/react-app/hooks/useDailyMetrics";
import { fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import type {
  SkillWithProgress,
  TitleWithUnlock,
  UserAttributes,
  UserProgression,
} from "@/shared/types";

interface LevelUpModalProps {
  level: number;
  onClose: () => void;
}

type LevelUpSkill = SkillWithProgress & {
  unlocked_at?: string | null | undefined;
  current_stage?: number | undefined;
  total_stages?: number | undefined;
  status?: string | null | undefined;
};

type LevelUpTitle = TitleWithUnlock & {
  unlocked_at?: string | null | undefined;
};

// Defines the themed presentation for each attribute bar shown in the modal.
const ATTRIBUTE_META = [
  {
    key: "strength",
    label: "Força",
    sigla: "FOR",
    icon: Shield,
    fill: "linear-gradient(90deg, color-mix(in srgb, var(--app-primary-color) 78%, transparent), var(--app-primary-color))",
  },
  {
    key: "constitution",
    label: "Constituição",
    sigla: "CON",
    icon: Zap,
    fill: "linear-gradient(90deg, color-mix(in srgb, var(--app-secondary-color) 70%, #38bdf8), #38bdf8)",
  },
  {
    key: "vitality",
    label: "Vitalidade",
    sigla: "VIT",
    icon: Flame,
    fill: "linear-gradient(90deg, color-mix(in srgb, var(--app-primary-color) 58%, #22c55e), #22c55e)",
  },
  {
    key: "dexterity",
    label: "Destreza",
    sigla: "DES",
    icon: Target,
    fill: "linear-gradient(90deg, #8b5cf6, #ec4899)",
  },
  {
    key: "focus",
    label: "Foco",
    sigla: "FOC",
    icon: Award,
    fill: "linear-gradient(90deg, #facc15, #f59e0b)",
  },
] as const;

const RECENT_UNLOCK_WINDOW_MS = 10 * 60 * 1000;

// Keeps the unlock spotlight focused on the immediate level-up window.
function isRecentUnlock(value: string | null | undefined): boolean {
  if (!value) return false;
  const unlockedAt = Date.parse(value);
  if (!Number.isFinite(unlockedAt)) return false;
  const delta = Date.now() - unlockedAt;
  return delta >= 0 && delta <= RECENT_UNLOCK_WINDOW_MS;
}

// Formats dashboard counters with the same locale used across the app.
function formatCompactNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
}

export default function LevelUpModal({ level, onClose }: LevelUpModalProps) {
  const [progression, setProgression] = useState<UserProgression | null>(
    () => readCachedJson<UserProgression>("/api/progression")?.data ?? null,
  );
  const [attributes, setAttributes] = useState<UserAttributes | null>(
    () => readCachedJson<UserAttributes>("/api/attributes")?.data ?? null,
  );
  const [skills, setSkills] = useState<LevelUpSkill[]>(
    () => readCachedJson<LevelUpSkill[]>("/api/skills")?.data ?? [],
  );
  const [titles, setTitles] = useState<LevelUpTitle[]>(
    () => readCachedJson<LevelUpTitle[]>("/api/titles")?.data ?? [],
  );
  const [loading, setLoading] = useState(true);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const { metrics } = useDailyMetrics({ syncRemote: true });

  // Refreshes the cached progression snapshot while preserving a fast first paint.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [nextProgression, nextAttributes, nextSkills, nextTitles] = await Promise.all([
          fetchAndCacheJson<UserProgression>("/api/progression"),
          fetchAndCacheJson<UserAttributes>("/api/attributes"),
          fetchAndCacheJson<LevelUpSkill[]>("/api/skills"),
          fetchAndCacheJson<LevelUpTitle[]>("/api/titles"),
        ]);

        if (cancelled) return;

        setProgression(nextProgression);
        setAttributes(nextAttributes);
        setSkills(Array.isArray(nextSkills) ? nextSkills : []);
        setTitles(Array.isArray(nextTitles) ? nextTitles : []);
      } catch {
        // Keeps the modal usable with cached data if one of the requests fails.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  // Surfaces the freshest unlocked skills so the modal reflects the actual level-up reward.
  const recentUnlockedSkills = useMemo(() => {
    return [...skills]
      .filter((skill) => isRecentUnlock(skill.unlocked_at))
      .sort((left, right) => Date.parse(String(right.unlocked_at ?? 0)) - Date.parse(String(left.unlocked_at ?? 0)))
      .slice(0, 2);
  }, [skills]);

  // Mirrors the same unlock-window rule for titles earned with the current level-up.
  const recentUnlockedTitles = useMemo(() => {
    return [...titles]
      .filter((title) => title.unlocked === 1 && isRecentUnlock(title.unlocked_at))
      .sort((left, right) => Date.parse(String(right.unlocked_at ?? 0)) - Date.parse(String(left.unlocked_at ?? 0)))
      .slice(0, 2);
  }, [titles]);

  // Builds the quick-glance counters shown in the first summary section.
  const summaryCards = useMemo(
    () => [
      {
        label: "Sequência Atual",
        value: `${progression?.current_streak ?? 0} dias`,
        accent: "var(--app-primary-color)",
      },
      {
        label: "Melhor Sequência",
        value: `${progression?.best_streak ?? 0} dias`,
        accent: "var(--fl-color-text)",
      },
      {
        label: "Calorias Hoje",
        value: `${formatCompactNumber(metrics?.caloriesBurned)} kcal`,
        accent: "var(--fl-color-text)",
      },
      {
        label: "Passos Hoje",
        value: formatCompactNumber(metrics?.steps),
        accent: "var(--fl-color-text)",
      },
    ],
    [metrics?.caloriesBurned, metrics?.steps, progression?.best_streak, progression?.current_streak],
  );

  // Merges the fixed reward with newly unlocked skills and titles for the unlock grid.
  const unlockedContent = useMemo(() => {
    return [
      {
        id: "reward-points",
        title: "+100 pontos extras",
        subtitle: "Recompensa fixa do level up",
        icon: Zap,
        accent: "var(--app-primary-color)",
      },
      ...recentUnlockedSkills.map((skill) => ({
        id: `skill-${skill.id}`,
        title: skill.name,
        subtitle:
          typeof skill.total_stages === "number" && typeof skill.current_stage === "number"
            ? `Habilidade liberada · estágio ${skill.current_stage}/${skill.total_stages}`
            : "Habilidade liberada",
        icon: Crown,
        accent: "var(--app-primary-color)",
      })),
      ...recentUnlockedTitles.map((title) => ({
        id: `title-${title.id}`,
        title: title.name,
        subtitle: `Título ${title.rarity?.trim() || "desbloqueado"}`,
        icon: Badge,
        accent: "var(--app-primary-color)",
      })),
    ].slice(0, 4);
  }, [recentUnlockedSkills, recentUnlockedTitles]);

  // Reuses a single share payload for both native sharing and clipboard fallback.
  const shareMessage = useMemo(() => {
    const parts = [`Acabei de alcançar o nível ${level} no FitLoot.`];

    if (typeof progression?.current_streak === "number" && progression.current_streak > 0) {
      parts.push(`Sequência atual: ${progression.current_streak} dias.`);
    }

    if (recentUnlockedSkills.length > 0) {
      parts.push(`Skills liberadas: ${recentUnlockedSkills.map((skill) => skill.name).join(", ")}.`);
    }

    if (recentUnlockedTitles.length > 0) {
      parts.push(`Títulos desbloqueados: ${recentUnlockedTitles.map((title) => title.name).join(", ")}.`);
    }

    return parts.join(" ");
  }, [level, progression?.current_streak, recentUnlockedSkills, recentUnlockedTitles]);

  // Chooses the best available sharing capability for the current device.
  const handleShare = async () => {
    setShareStatus(null);

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: `FitLoot • Nível ${level}`,
          text: shareMessage,
        });
        setShareStatus("Resultado compartilhado.");
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareMessage);
        setShareStatus("Resultado copiado para a área de transferência.");
        return;
      }

      setShareStatus("Compartilhamento não disponível neste dispositivo.");
    } catch {
      setShareStatus("Não foi possível compartilhar agora.");
    }
  };

  return (
    // Provides the full-screen celebration backdrop and dismiss-on-overlay behavior.
    <div
      className="fl-z-modal fixed inset-0 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fadeIn md:p-8"
      onClick={onClose}
    >
      {/* Houses the modal shell, decorative background layers, and scrollable sections. */}
      <div
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2.4rem] border animate-scaleIn"
        style={{
          borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, var(--fl-border-soft))",
          background:
            "radial-gradient(circle at top center, color-mix(in srgb, var(--app-primary-color) 12%, transparent), transparent 38%), linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-gradient-top) 94%, transparent), color-mix(in srgb, var(--fl-surface-gradient-bottom) 98%, transparent))",
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--app-primary-color) 12%, transparent), 0 38px 120px rgba(0,0,0,0.58)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Paints the ambient glow and floating particles behind the celebration content. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -left-16 top-8 h-40 w-40 rounded-full blur-[68px]"
            style={{ background: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)" }}
          />
          <div
            className="absolute -right-12 bottom-0 h-44 w-44 rounded-full blur-[76px]"
            style={{ background: "color-mix(in srgb, var(--app-secondary-color) 16%, transparent)" }}
          />
          <div
            className="absolute left-1/2 top-0 h-1 w-64 -translate-x-1/2 bg-gradient-to-r from-transparent via-[var(--app-primary-color)] to-transparent opacity-60"
          />
          {[
            "left-[18%] top-[18%]",
            "left-[74%] top-[28%]",
            "left-[26%] top-[58%]",
            "left-[82%] top-[62%]",
            "left-[52%] top-[24%]",
          ].map((position, index) => (
            <span
              key={position}
              className={`absolute ${position} h-2 w-2 rounded-full bg-[var(--app-primary-color)] opacity-70 ${index % 2 === 0 ? "animate-ping" : "animate-pulse"}`}
              style={{ animationDuration: `${2 + index * 0.4}s` }}
            />
          ))}
        </div>

        {/* Keeps the close action visible regardless of the current scroll position. */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-20 rounded-full p-2 transition-opacity hover:opacity-80"
          style={{ color: "var(--fl-color-text-muted)" }}
          aria-label="Fechar modal de level up"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Presents the level-up hero, reward headline, and contextual subtitle. */}
        <div className="relative z-10 px-6 pt-10 text-center sm:px-8 md:px-12">
          <span
            className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em]"
            style={{
              borderColor: "color-mix(in srgb, var(--app-primary-color) 22%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)",
              color: "var(--app-primary-color)",
            }}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            Novo nível alcançado
          </span>

          <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full border backdrop-blur-sm sm:h-28 sm:w-28">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full sm:h-24 sm:w-24"
              style={{
                background: "radial-gradient(circle, color-mix(in srgb, var(--app-primary-color) 18%, transparent), transparent 72%)",
                color: "var(--app-primary-color)",
                boxShadow: "0 0 40px color-mix(in srgb, var(--app-primary-color) 24%, transparent)",
              }}
            >
              <Trophy className="h-10 w-10 sm:h-12 sm:w-12" />
            </div>
          </div>

          <div className="mb-2 flex items-end justify-center gap-3">
            <Sparkles className="mb-3 h-5 w-5 shrink-0" style={{ color: "var(--app-primary-color)" }} />
            <h2
              className="text-5xl font-black tracking-[-0.08em] sm:text-7xl md:text-8xl"
              style={{
                fontFamily: "var(--fl-font-display)",
                color: "var(--fl-color-text)",
                textShadow: "0 0 24px color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
              }}
            >
              LEVEL {level}
            </h2>
            <Sparkles className="mb-3 h-5 w-5 shrink-0" style={{ color: "var(--app-primary-color)" }} />
          </div>

          <p className="text-base font-bold uppercase tracking-[0.18em] sm:text-lg" style={{ color: "var(--fl-color-text-muted)" }}>
            Jornada desbloqueada
          </p>

          <p className="mx-auto mt-4 max-w-2xl text-sm font-medium leading-relaxed sm:text-base" style={{ color: "var(--fl-color-text-muted)" }}>
            Você subiu de nível, recebeu +100 pontos e seu progresso foi atualizado com o que realmente liberou nesta nova faixa.
          </p>
        </div>

        {/* Groups the summary cards, attribute bars, and unlocked-content sections. */}
        <div className="relative z-10 mt-8 flex-1 overflow-y-auto px-6 pb-8 sm:px-8 md:px-12">
          <div className="space-y-8 pb-2">
            {/* Summarizes the streak and activity counters tied to the new level. */}
            <section>
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)", color: "var(--app-primary-color)" }}
                >
                  <Activity className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-[0.18em]" style={{ color: "var(--fl-color-text)" }}>
                  Resumo da evolução
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {summaryCards.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-[1.4rem] border p-4"
                    style={{
                      borderColor: "var(--fl-border-soft)",
                      background:
                        "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-soft-gradient-top) 94%, transparent), color-mix(in srgb, var(--fl-surface-soft-gradient-bottom) 100%, transparent))",
                    }}
                  >
                    <span className="block text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--fl-color-text-soft)" }}>
                      {card.label}
                    </span>
                    <span className="mt-2 block text-lg font-black tracking-tight sm:text-xl" style={{ color: card.accent }}>
                      {card.value}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Renders the persisted attribute totals using animated themed progress bars. */}
            <section>
              <div className="mb-5 flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)", color: "var(--app-primary-color)" }}
                >
                  <Star className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-[0.18em]" style={{ color: "var(--fl-color-text)" }}>
                  Evolução de atributos
                </h3>
              </div>

              {loading && !attributes ? (
                <div className="flex min-h-[160px] items-center justify-center rounded-[1.6rem] border" style={{ borderColor: "var(--fl-border-soft)" }}>
                  <LoadingBall size="md" />
                </div>
              ) : (
                <div className="space-y-5">
                  {ATTRIBUTE_META.map((attribute) => {
                    const value = attributes ? Number(attributes[attribute.key]) || 0 : 0;

                    return (
                      <div key={attribute.key} className="space-y-2">
                        <div className="flex items-end justify-between gap-4">
                          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--fl-color-text)" }}>
                            <attribute.icon className="h-4 w-4 shrink-0" style={{ color: "var(--app-primary-color)" }} />
                            {attribute.label}
                            <span style={{ color: "var(--fl-color-text-muted)" }}>({attribute.sigla})</span>
                          </span>
                          <span className="text-sm font-black" style={{ color: "var(--app-primary-color)" }}>
                            {value} pts
                          </span>
                        </div>
                        <div
                          className="h-3 w-full overflow-hidden rounded-full border p-0.5"
                          style={{
                            borderColor: "var(--fl-border-soft)",
                            backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 74%, transparent)",
                          }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${Math.min(value, 100)}%`,
                              background: attribute.fill,
                              boxShadow: "0 0 12px color-mix(in srgb, var(--app-primary-color) 24%, transparent)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Highlights the concrete skills, titles, and reward points unlocked now. */}
            <section>
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)", color: "var(--app-primary-color)" }}
                >
                  <Badge className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-[0.18em]" style={{ color: "var(--fl-color-text)" }}>
                  Conteúdo liberado
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {unlockedContent.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 rounded-[1.5rem] border p-4 transition-transform duration-200 hover:-translate-y-0.5"
                    style={{
                      borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                      background:
                        "radial-gradient(circle at top right, color-mix(in srgb, var(--app-primary-color) 8%, transparent), transparent 48%), linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-soft-gradient-top) 96%, transparent), color-mix(in srgb, var(--fl-surface-soft-gradient-bottom) 100%, transparent))",
                    }}
                  >
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--app-primary-color) 16%, transparent)",
                        color: item.accent,
                      }}
                    >
                      <item.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-black tracking-tight" style={{ color: "var(--fl-color-text)" }}>
                        {item.title}
                      </h4>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--fl-color-text-muted)" }}>
                        {item.subtitle}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Anchors the primary continue action and the optional share affordance. */}
        <div
          className="relative z-10 border-t px-6 py-5 sm:px-8 md:px-12"
          style={{
            borderColor: "var(--fl-border-soft)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-soft-gradient-top) 86%, transparent), color-mix(in srgb, var(--fl-surface-soft-gradient-bottom) 96%, transparent))",
          }}
        >
          {shareStatus ? (
            <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--app-primary-color)" }}>
              {shareStatus}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 md:flex-row">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full px-6 py-4 text-[11px] font-black uppercase tracking-[0.18em] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: "linear-gradient(135deg, var(--app-primary-color), color-mix(in srgb, var(--app-primary-color) 82%, white))",
                color: "var(--fl-nav-item-active-text)",
                boxShadow: "0 0 24px color-mix(in srgb, var(--app-primary-color) 26%, transparent)",
              }}
            >
              Continuar jornada
            </button>

            <button
              type="button"
              onClick={() => { void handleShare(); }}
              className="fl-theme-surface-soft inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-4 text-[11px] font-black uppercase tracking-[0.18em] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              Compartilhar resultado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
