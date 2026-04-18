import { Shield, TrendingUp, Target, Activity, AlertTriangle } from "lucide-react";
import type { TrainingRankSnapshot } from "@/shared/types";
import { getNextTrainingRankMeta, getTrainingRankMeta } from "@/shared/trainingLevels";

interface TrainingRankDisplayProps {
  snapshot: TrainingRankSnapshot | null;
  isLoading?: boolean;
  error?: string | null;
  showDetails?: boolean;
  compact?: boolean;
}

function hasMeaningfulTrainingEvidence(snapshot: TrainingRankSnapshot): boolean {
  return (
    snapshot.hasBenchmarkData ||
    snapshot.hasSkillData ||
    snapshot.globalScore > 0 ||
    snapshot.factors.volumeScore > 0 ||
    snapshot.factors.consistencyScore > 0 ||
    snapshot.factors.skillMasteryScore > 0 ||
    snapshot.factors.momentumScore > 0
  );
}

const rankTierConfig = {
  bronze: {
    accent: "#b87333",
    surface: "color-mix(in srgb, #b87333 12%, var(--fl-surface-strong) 88%)",
    border: "color-mix(in srgb, #b87333 24%, var(--fl-border-soft))",
    accentSoft: "color-mix(in srgb, #b87333 16%, transparent)",
  },
  ferro: {
    accent: "#94a3b8",
    surface: "color-mix(in srgb, #94a3b8 12%, var(--fl-surface-strong) 88%)",
    border: "color-mix(in srgb, #94a3b8 24%, var(--fl-border-soft))",
    accentSoft: "color-mix(in srgb, #94a3b8 16%, transparent)",
  },
  ouro: {
    accent: "#eab308",
    surface: "color-mix(in srgb, #eab308 12%, var(--fl-surface-strong) 88%)",
    border: "color-mix(in srgb, #eab308 24%, var(--fl-border-soft))",
    accentSoft: "color-mix(in srgb, #eab308 16%, transparent)",
  },
  diamante: {
    accent: "#22d3ee",
    surface: "color-mix(in srgb, #22d3ee 12%, var(--fl-surface-strong) 88%)",
    border: "color-mix(in srgb, #22d3ee 24%, var(--fl-border-soft))",
    accentSoft: "color-mix(in srgb, #22d3ee 16%, transparent)",
  },
  elite: {
    accent: "var(--app-primary-color)",
    surface: "color-mix(in srgb, var(--app-primary-color) 14%, var(--fl-surface-strong) 86%)",
    border: "color-mix(in srgb, var(--app-primary-color) 24%, var(--fl-border-soft))",
    accentSoft: "color-mix(in srgb, var(--app-primary-color) 16%, transparent)",
  },
} as const;

export function TrainingRankDisplay({
  snapshot,
  isLoading = false,
  error = null,
  showDetails = false,
  compact = false,
}: TrainingRankDisplayProps) {
  // Renderiza o rank em formato compacto ou expandido a partir do snapshot atual.
  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div
          className="mb-2 h-12 rounded-lg"
          style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 80%, transparent)" }}
        ></div>
        {!compact ? (
          <div
            className="h-4 w-3/4 rounded"
            style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 72%, transparent)" }}
          ></div>
        ) : null}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          borderColor: "color-mix(in srgb, #ef4444 24%, var(--fl-border-soft))",
          backgroundColor: "color-mix(in srgb, #ef4444 8%, var(--fl-surface-strong))",
          color: "#ef4444",
        }}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">Erro ao carregar rank</span>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          borderColor: "var(--fl-border-soft)",
          backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 72%, transparent)",
          color: "var(--fl-color-text-muted)",
        }}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span className="text-sm">Rank nao disponivel</span>
        </div>
      </div>
    );
  }

  const rankMeta = getTrainingRankMeta(snapshot.globalRank);
  const nextRankMeta = getNextTrainingRankMeta(snapshot.globalRank);
  const config = rankTierConfig[rankMeta.tier];
  const shouldShowFallbackWarning =
    snapshot.fallbackUsed && !hasMeaningfulTrainingEvidence(snapshot);
  const fallbackMessage = "Continue treinando para desbloquear ranking completo";
  const rankBandSpan = Math.max(1, rankMeta.maxScore - rankMeta.minScore);
  const rankBandProgress = Math.max(
    0,
    Math.min(100, ((snapshot.globalScore - rankMeta.minScore) / rankBandSpan) * 100),
  );
  const scoreToNextRank = nextRankMeta
    ? Math.max(0, nextRankMeta.minScore - snapshot.globalScore)
    : 0;

  if (compact) {
    return (
      <div
        className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border px-3 py-1"
        style={{
          backgroundColor: config.surface,
          borderColor: config.border,
          color: config.accent,
        }}
      >
        <img
          src={rankMeta.iconPath}
          alt={rankMeta.label}
          className="h-5 w-5 object-contain"
          loading="lazy"
          decoding="async"
        />
        <span className="text-xs font-medium">{rankMeta.label}</span>
        {shouldShowFallbackWarning ? (
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 opacity-60" />
            <span className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
              Rank parcial
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        backgroundColor: config.surface,
        borderColor: config.border,
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={rankMeta.iconPath}
            alt={rankMeta.label}
            className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14"
            loading="lazy"
            decoding="async"
          />
          <div>
            <h3 className="font-semibold" style={{ color: config.accent }}>
              {rankMeta.label}
            </h3>
            <p className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
              {rankMeta.description}
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold" style={{ color: config.accent }}>
            {snapshot.globalScore}
          </div>
          <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
            rating
          </div>
        </div>
      </div>

      <div className="mb-3">
        <div
          className="h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 78%, transparent)" }}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${rankBandProgress}%`,
              background: `linear-gradient(90deg, ${config.accent}, color-mix(in srgb, ${config.accent} 60%, white))`,
            }}
          />
        </div>
        <div className="mt-2 text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
          {nextRankMeta
            ? `Faltam ${scoreToNextRank} pontos para ${nextRankMeta.label}`
            : "Patente maxima atingida"}
        </div>
      </div>

      {/* Avisa quando o rank foi estimado com dados incompletos. */}
      {shouldShowFallbackWarning ? (
        <div
          className="mb-3 rounded border p-2"
          style={{
            backgroundColor: "color-mix(in srgb, #f59e0b 10%, var(--fl-surface-strong))",
            borderColor: "color-mix(in srgb, #f59e0b 22%, var(--fl-border-soft))",
            color: "#d97706",
          }}
        >
          <div className="flex items-center gap-2 text-xs">
            <AlertTriangle className="h-3 w-3" />
            <span>{fallbackMessage}</span>
          </div>
        </div>
      ) : null}

      {/* Detalha os fatores usados no calculo do rank atual. */}
      {showDetails ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fl-color-text)" }}>
            Fatores de Avaliacao
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: "var(--app-primary-color)" }} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Volume
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.volumeScore}/260
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" style={{ color: "var(--app-secondary-color)" }} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Consistencia
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.consistencyScore}/240
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" style={{ color: config.accent }} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Benchmarks
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.benchmarkScore}/420
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Shield
                className="h-4 w-4"
                style={{ color: "color-mix(in srgb, var(--app-primary-color) 78%, #f59e0b)" }}
              />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Skills
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.skillMasteryScore}/220
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: config.accent }} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Momento
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.momentumScore}/160
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--fl-border-soft)" }}>
        <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
          Atualizado: {new Date(snapshot.lastCalculatedAt).toLocaleDateString("pt-BR")}
        </div>
      </div>
    </div>
  );
}
