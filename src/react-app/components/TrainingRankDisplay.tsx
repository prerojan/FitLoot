import { Shield, TrendingUp, Target, Activity, AlertTriangle } from "lucide-react";
import type { TrainingRankSnapshot } from "@/shared/types";

interface TrainingRankDisplayProps {
  snapshot: TrainingRankSnapshot | null;
  isLoading?: boolean;
  error?: string | null;
  showDetails?: boolean;
  compact?: boolean;
}

const rankConfig = {
  iniciante: {
    accent: "var(--fl-color-text-muted)",
    surface: "color-mix(in srgb, var(--fl-surface-muted) 82%, var(--fl-surface-strong) 18%)",
    border: "var(--fl-border-soft)",
    accentSoft: "color-mix(in srgb, var(--fl-color-text-muted) 18%, transparent)",
    label: "Iniciante",
    description: "Começando sua jornada fitness",
  },
  intermediario: {
    accent: "var(--app-secondary-color)",
    surface: "color-mix(in srgb, var(--app-secondary-color) 14%, var(--fl-surface-strong) 86%)",
    border: "color-mix(in srgb, var(--app-secondary-color) 24%, var(--fl-border-soft))",
    accentSoft: "color-mix(in srgb, var(--app-secondary-color) 16%, transparent)",
    label: "Intermediário",
    description: "Em pleno desenvolvimento",
  },
  avancado: {
    accent: "var(--app-primary-color)",
    surface: "color-mix(in srgb, var(--app-primary-color) 14%, var(--fl-surface-strong) 86%)",
    border: "color-mix(in srgb, var(--app-primary-color) 24%, var(--fl-border-soft))",
    accentSoft: "color-mix(in srgb, var(--app-primary-color) 16%, transparent)",
    label: "Avançado",
    description: "Atleta experiente",
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
          <AlertTriangle className="w-4 h-4" />
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
          <Activity className="w-4 h-4" />
          <span className="text-sm">Rank não disponível</span>
        </div>
      </div>
    );
  }

  const config = rankConfig[snapshot.globalRank];

  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1"
        style={{
          backgroundColor: config.surface,
          borderColor: config.border,
          color: config.accent,
        }}
      >
        <Shield className="w-3 h-3" />
        <span className="text-xs font-medium">{config.label}</span>
        {snapshot.fallbackUsed ? (
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 opacity-60" />
            <span className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
              Dados incompletos
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
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-full p-2" style={{ backgroundColor: config.accentSoft }}>
            <Shield className="w-5 h-5" style={{ color: config.accent }} />
          </div>
          <div>
            <h3 className="font-semibold" style={{ color: config.accent }}>
              {config.label}
            </h3>
            <p className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
              {config.description}
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold" style={{ color: config.accent }}>
            {snapshot.globalScore}
          </div>
          <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
            pontos
          </div>
        </div>
      </div>

      {/* Avisa quando o rank foi estimado com dados incompletos. */}
      {snapshot.fallbackUsed ? (
        <div
          className="mb-3 rounded border p-2"
          style={{
            backgroundColor: "color-mix(in srgb, #f59e0b 10%, var(--fl-surface-strong))",
            borderColor: "color-mix(in srgb, #f59e0b 22%, var(--fl-border-soft))",
            color: "#d97706",
          }}
        >
          <div className="flex items-center gap-2 text-xs">
            <AlertTriangle className="w-3 h-3" />
            <span>
              {snapshot.hasBenchmarkData && snapshot.hasSkillData
                ? "Rank calculado com dados estimados - complete benchmarks para maior precisão"
                : "Continue treinando para desbloquear ranking completo"}
            </span>
          </div>
        </div>
      ) : null}

      {/* Detalha os fatores usados no calculo do rank atual. */}
      {showDetails ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fl-color-text)" }}>
            Fatores de Avaliação
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: "var(--app-primary-color)" }} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Volume
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.volumeScore}/25
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: "var(--app-secondary-color)" }} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Consistência
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.consistencyScore}/25
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Target className="w-4 h-4" style={{ color: config.accent }} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Benchmarks
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.benchmarkScore}/30
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Shield
                className="w-4 h-4"
                style={{ color: "color-mix(in srgb, var(--app-primary-color) 78%, #f59e0b)" }}
              />
              <div className="flex-1">
                <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                  Skills
                </div>
                <div className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  {snapshot.factors.skillMasteryScore}/20
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
