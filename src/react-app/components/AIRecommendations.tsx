import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Lightbulb, Sparkles, Target, TrendingUp } from "lucide-react";
import { api } from "@/react-app/utils/api";
import LoadingBall from "@/react-app/components/LoadingBall";

type Recommendations = {
  next_skill_recommendation: {
    name: string;
    reason: string;
  };
  weak_attribute: {
    name: string;
    suggestion: string;
  };
  training_focus: {
    type: string;
    reason: string;
  };
  motivation_message: string;
};

type RecommendationApiPayload = {
  recommendations?: unknown;
  degraded?: boolean;
};

function msUntilNextLocalMidnight(): number {
  // Agenda a proxima atualizacao diaria respeitando a meia-noite local.
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  return Math.max(60_000, nextMidnight.getTime() - now.getTime());
}

function parseRecommendations(raw: unknown): Recommendations | null {
  // Normaliza o payload da IA para um formato estavel de renderizacao.
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  const nextSkill = (data.next_skill_recommendation ?? {}) as Record<string, unknown>;
  const weakAttribute = (data.weak_attribute ?? {}) as Record<string, unknown>;
  const trainingFocus = (data.training_focus ?? {}) as Record<string, unknown>;

  return {
    next_skill_recommendation: {
      name: typeof nextSkill.name === "string" && nextSkill.name.trim() ? nextSkill.name : "Sugestao indisponivel",
      reason:
        typeof nextSkill.reason === "string" && nextSkill.reason.trim()
          ? nextSkill.reason
          : "A IA nao retornou justificativa para a proxima skill.",
    },
    weak_attribute: {
      name:
        typeof weakAttribute.name === "string" && weakAttribute.name.trim()
          ? weakAttribute.name
          : "Atributo nao identificado",
      suggestion:
        typeof weakAttribute.suggestion === "string" && weakAttribute.suggestion.trim()
          ? weakAttribute.suggestion
          : "Sem sugestao detalhada no momento.",
    },
    training_focus: {
      type:
        typeof trainingFocus.type === "string" && trainingFocus.type.trim()
          ? trainingFocus.type
          : "Foco geral",
      reason:
        typeof trainingFocus.reason === "string" && trainingFocus.reason.trim()
          ? trainingFocus.reason
          : "Sem detalhes adicionais fornecidos.",
    },
    motivation_message:
      typeof data.motivation_message === "string" && data.motivation_message.trim()
        ? data.motivation_message
        : "Continue consistente: pequenos passos diarios geram grandes resultados.",
  };
}

function InsightCard({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  // Cartao-base das leituras geradas pela IA no painel.
  return (
    <article
      className="fl-theme-surface flex h-full min-w-0 rounded-[1.5rem] p-4 sm:rounded-[1.75rem] sm:p-5 md:p-6"
      style={{ boxShadow: "var(--fl-shadow-glass)" }}
    >
      <div className="flex min-w-0 items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)",
            color: "var(--app-primary-color)",
          }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--app-primary-color)" }}>
            {eyebrow}
          </p>
          <h3 className="mt-2 break-words text-base font-black leading-snug sm:text-[1.02rem]" style={{ color: "var(--fl-color-text)" }}>
            {title}
          </h3>
          <p className="mt-2 break-words text-sm leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
            {description}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function AIRecommendations() {
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  // Carrega a recomendacao atual e marca quando o backend entrou em modo degradado.
  const loadRecommendations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api("/api/ai/recommendations");
      if (!response.ok) {
        throw new Error("Falha ao carregar recomendacoes");
      }

      const data = (await response.json()) as RecommendationApiPayload;
      const parsed = parseRecommendations(data.recommendations);
      if (!parsed) {
        throw new Error("Payload de recomendacoes invalido");
      }

      setRecommendations(parsed);
      setDegraded(Boolean(data.degraded));
    } catch {
      setError("Nao foi possivel carregar as recomendacoes agora.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Resolve a carga inicial do painel assim que o componente entra em tela.
  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  // Reagenda a leitura para a proxima virada de dia local.
  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;

    const scheduleRefresh = () => {
      timeoutId = window.setTimeout(() => {
        void (async () => {
          await loadRecommendations();
          if (!cancelled) {
            scheduleRefresh();
          }
        })();
      }, msUntilNextLocalMidnight());
    };

    scheduleRefresh();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [loadRecommendations]);

  if (loading) {
    return (
      <div className="fl-theme-surface rounded-[1.5rem] p-4 sm:rounded-[2rem] sm:p-6">
        <div className="flex items-center justify-center gap-3" style={{ color: "var(--app-primary-color)" }}>
          <LoadingBall size="md" />
          <span className="text-sm font-bold uppercase tracking-[0.18em]">Analisando seu progresso</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fl-theme-surface rounded-[1.5rem] p-4 sm:rounded-[2rem] sm:p-5">
        <p className="text-sm text-center" style={{ color: "#dc2626" }}>{error}</p>
        <button
          type="button"
          onClick={() => { void loadRecommendations(); }}
          className="mt-4 w-full rounded-2xl py-3 text-sm font-black uppercase tracking-[0.18em]"
          style={{ background: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!recommendations) return null;

  return (
    <section className="space-y-3 sm:space-y-4">
      {/* Cabecalho do painel de recomendacoes e indicador de degradacao. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "color-mix(in srgb, var(--app-primary-color) 16%, transparent)",
              color: "var(--app-primary-color)",
            }}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--app-primary-color)" }}>
              Painel IA
            </p>
            <h2 className="fl-title-card">Recomendacoes personalizadas</h2>
          </div>
        </div>
        {degraded ? (
          <span
            className="w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
            style={{
              borderColor: "color-mix(in srgb, #f59e0b 30%, transparent)",
              background: "color-mix(in srgb, #f59e0b 12%, transparent)",
              color: "#b45309",
            }}
          >
            Modo seguro
          </span>
        ) : null}
      </div>

      {/* Mensagem principal sintetizada para leitura rapida. */}
      <div
        className="rounded-[1.5rem] p-4 sm:rounded-[2rem] sm:p-6 md:p-7"
        style={{
          background:
            "radial-gradient(circle at top right, color-mix(in srgb, var(--app-primary-color) 22%, transparent), transparent 44%), linear-gradient(135deg, color-mix(in srgb, var(--fl-surface-gradient-top) 96%, transparent), color-mix(in srgb, var(--fl-surface-gradient-bottom) 100%, transparent))",
          border: "1px solid color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
          boxShadow: "var(--fl-shadow-glass)",
        }}
      >
        <div className="flex min-w-0 items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "var(--app-primary-color)",
              color: "var(--fl-nav-item-active-text)",
            }}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--app-primary-color)" }}>
              Leitura rapida
            </p>
            <p className="mt-2 break-words text-sm leading-relaxed sm:text-[0.95rem]" style={{ color: "var(--fl-color-text)" }}>
              {recommendations.motivation_message}
            </p>
          </div>
        </div>
      </div>

      {/* Grade das tres recomendacoes acionaveis geradas pela IA. */}
      <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
        <InsightCard
          icon={<Target className="h-5 w-5" />}
          eyebrow="Proxima skill"
          title={recommendations.next_skill_recommendation.name}
          description={recommendations.next_skill_recommendation.reason}
        />
        <InsightCard
          icon={<TrendingUp className="h-5 w-5" />}
          eyebrow="Ponto de atencao"
          title={recommendations.weak_attribute.name}
          description={recommendations.weak_attribute.suggestion}
        />
        <InsightCard
          icon={<Lightbulb className="h-5 w-5" />}
          eyebrow="Foco sugerido"
          title={recommendations.training_focus.type}
          description={recommendations.training_focus.reason}
        />
      </div>
    </section>
  );
}
