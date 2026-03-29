import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, Wand2, XCircle } from "lucide-react";
import LoadingBall from "@/react-app/components/LoadingBall";
import type { Mission } from "@/shared/types";
import { api, clearJsonCache } from "@/react-app/utils/api";

type AIMissionGeneratorProps = {
  onMissionsGenerated?: () => void;
};

type MissionGenerationResponse = {
  success?: boolean | undefined;
  generated?: boolean | undefined;
  code?: string | undefined;
  error?: string | undefined;
};

type NoticeState = {
  tone: "success" | "info";
  message: string;
};

function isRegularActiveMission(mission: Mission): boolean {
  // Considera apenas missoes regulares ainda ativas para detectar geracao nova.
  const status = mission.status ?? (mission.is_completed === 1 ? "completed" : "pending");
  const isAiSpecial = Number(mission.is_ai_special ?? 0) === 1 || mission.mission_origin === "ai";

  return !isAiSpecial && mission.is_completed !== 1 && status !== "failed" && status !== "expired";
}

export default function AIMissionGenerator({ onMissionsGenerated }: AIMissionGeneratorProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const baselineMissionIdsRef = useRef<Set<number>>(new Set());
  const refreshTriggeredRef = useRef(false);

  // Dispara a atualizacao do dashboard apenas uma vez por ciclo de geracao.
  const triggerDashboardRefresh = useCallback(() => {
    if (refreshTriggeredRef.current) return;
    refreshTriggeredRef.current = true;
    clearJsonCache("/api/missions");
    onMissionsGenerated?.();
  }, [onMissionsGenerated]);

  // Le o conjunto atual de missoes para comparar antes e depois da geracao.
  const readCurrentRegularMissionIds = useCallback(async (): Promise<Set<number>> => {
    try {
      const response = await api("/api/missions", { timeoutMs: 10_000 });
      if (!response.ok) return new Set<number>();

      const payload = (await response.json()) as Mission[];
      return new Set(
        (Array.isArray(payload) ? payload : [])
          .filter(isRegularActiveMission)
          .map((mission) => Number(mission.id))
          .filter((missionId) => Number.isInteger(missionId) && missionId > 0),
      );
    } catch {
      return new Set<number>();
    }
  }, []);

  // Faz polling temporario enquanto o backend conclui a nova rodada de missoes.
  useEffect(() => {
    if (!loading) return;

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const response = await api("/api/missions", { timeoutMs: 10_000 });
          if (!response.ok) return;

          const payload = (await response.json()) as Mission[];
          const currentMissionIds = new Set(
            (Array.isArray(payload) ? payload : [])
              .filter(isRegularActiveMission)
              .map((mission) => Number(mission.id))
              .filter((missionId) => Number.isInteger(missionId) && missionId > 0),
          );

          const hasNewMission = Array.from(currentMissionIds).some(
            (missionId) => !baselineMissionIdsRef.current.has(missionId),
          );

          if (hasNewMission) {
            triggerDashboardRefresh();
          }
        } catch {
          // Polling is best-effort while the backend is generating missions.
        }
      })();
    }, 2_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading, triggerDashboardRefresh]);

  // Limpa automaticamente o aviso visual depois da confirmacao.
  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 4_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  // Aciona a geracao e converte o retorno em feedback simples para o usuario.
  const generateMissions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setNotice(null);
      refreshTriggeredRef.current = false;
      baselineMissionIdsRef.current = await readCurrentRegularMissionIds();

      const response = await api("/api/missions/generate", {
        method: "POST",
        timeoutMs: 30_000,
      });

      const payload = (await response.json().catch(() => null)) as MissionGenerationResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Não foi possível gerar missões agora.");
      }

      triggerDashboardRefresh();
      setNotice({
        tone: payload?.generated === false ? "info" : "success",
        message: payload?.generated === false
          ? "Você já possui missões ativas neste ciclo."
          : "Missões geradas e adicionadas ao dashboard.",
      });
    } catch (generationError) {
      console.error("[AIMissionGenerator]", generationError);
      setError(
        generationError instanceof Error && generationError.message.trim().length > 0
          ? generationError.message
          : "Não foi possível gerar missões. Tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  }, [readCurrentRegularMissionIds, triggerDashboardRefresh]);

  return (
    <div
      className="fl-theme-surface rounded-[1.5rem] border p-4 sm:rounded-[2rem] sm:p-5"
      style={{
        background:
          "radial-gradient(circle at top right, color-mix(in srgb, var(--app-primary-color) 18%, transparent), transparent 42%), linear-gradient(135deg, color-mix(in srgb, var(--fl-surface-gradient-top) 96%, transparent), color-mix(in srgb, var(--fl-surface-gradient-bottom) 100%, transparent))",
        borderColor: "color-mix(in srgb, var(--app-primary-color) 16%, var(--fl-border-soft))",
        boxShadow: "var(--fl-shadow-glass)",
      }}
    >
      {/* Contexto e proposta do gerador de missao baseado em IA. */}
      <div className="mb-3 flex items-start gap-3">
        <div
          className="rounded-2xl border p-2"
          style={{
            background: "color-mix(in srgb, var(--app-primary-color) 12%, transparent)",
            borderColor: "color-mix(in srgb, var(--app-primary-color) 22%, transparent)",
          }}
        >
          <Wand2 className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
        </div>
        <div className="flex-1" style={{ color: "var(--fl-color-text)" }}>
          <h3 className="mb-1 font-bold">Gerador de Missões IA</h3>
          <p className="text-sm" style={{ color: "var(--fl-color-text-muted)" }}>
            Gera um ciclo completo de missões personalizadas com base no seu perfil, histórico e progresso recente.
          </p>
        </div>
      </div>

      {/* Retorno positivo ou informativo apos a tentativa de geracao. */}
      {notice ? (
        <div
          className="mb-3 rounded-xl border px-3 py-2 text-sm"
          style={
            notice.tone === "success"
              ? {
                borderColor: "color-mix(in srgb, #10b981 26%, transparent)",
                background: "color-mix(in srgb, #10b981 10%, var(--fl-surface-strong))",
                color: "#047857",
              }
              : {
                borderColor: "color-mix(in srgb, #0ea5e9 26%, transparent)",
                background: "color-mix(in srgb, #0ea5e9 10%, var(--fl-surface-strong))",
                color: "#0369a1",
              }
          }
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>{notice.message}</span>
          </div>
        </div>
      ) : null}

      {/* Retorno de erro quando a geracao nao pode ser concluida. */}
      {error ? (
        <div
          className="mb-3 rounded-xl border px-3 py-2 text-sm"
          style={{
            borderColor: "color-mix(in srgb, #ef4444 26%, transparent)",
            background: "color-mix(in srgb, #ef4444 10%, var(--fl-surface-strong))",
            color: "#b91c1c",
          }}
        >
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {/* Acao principal de disparo com feedback inline de carregamento. */}
      <button
        onClick={() => { void generateMissions(); }}
        disabled={loading}
        className="w-full rounded-xl px-4 py-3 font-medium shadow-lg transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: "var(--app-primary-color)",
          color: "var(--fl-nav-item-active-text)",
          boxShadow: "0 0 20px color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <LoadingBall size="sm" />
            <span>Gerando e sincronizando missões...</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Wand2 className="h-4 w-4" />
            <span>Gerar Missões Personalizadas</span>
          </div>
        )}
      </button>

      {/* Resumo operacional do que esse gerador entrega ao usuario. */}
      <p className="mt-2 text-center text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
        Gera até 8 diárias, 5 semanais e 5 mensais, com polling automático do dashboard a cada 2 segundos.
      </p>
    </div>
  );
}
