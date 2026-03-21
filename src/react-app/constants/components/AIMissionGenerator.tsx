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

  const triggerDashboardRefresh = useCallback(() => {
    if (refreshTriggeredRef.current) return;
    refreshTriggeredRef.current = true;
    clearJsonCache("/api/missions");
    clearJsonCache("/api/missions?refresh=1");
    onMissionsGenerated?.();
  }, [onMissionsGenerated]);

  const readCurrentRegularMissionIds = useCallback(async (): Promise<Set<number>> => {
    try {
      const response = await api("/api/missions?refresh=1", { timeoutMs: 10_000 });
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

  useEffect(() => {
    if (!loading) return;

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const response = await api("/api/missions?refresh=1", { timeoutMs: 10_000 });
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

  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 4_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

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
    <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-4 shadow-lg">
      <div className="flex items-start gap-3 mb-3">
        <div className="bg-white/20 backdrop-blur-sm p-2 rounded-lg">
          <Wand2 className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 text-white">
          <h3 className="font-bold mb-1">Gerador de Missões IA</h3>
          <p className="text-sm text-white/90">
            Gera um ciclo completo de missões personalizadas com base no seu perfil, histórico e progresso recente.
          </p>
        </div>
      </div>

      {notice ? (
        <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${
          notice.tone === "success"
            ? "border-emerald-200 bg-white/95 text-emerald-700"
            : "border-sky-200 bg-white/95 text-sky-700"
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>{notice.message}</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-xl border border-red-200 bg-white/95 px-3 py-2 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <button
        onClick={() => { void generateMissions(); }}
        disabled={loading}
        className="w-full px-4 py-3 bg-white text-purple-600 rounded-xl font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <LoadingBall size="sm" />
            <span>Gerando e sincronizando missões...</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Wand2 className="w-4 h-4" />
            <span>Gerar Missões Personalizadas</span>
          </div>
        )}
      </button>

      <p className="text-xs text-white/75 text-center mt-2">
        Gera até 5 diárias, 5 semanais e 5 mensais, com polling automático do dashboard a cada 2 segundos.
      </p>
    </div>
  );
}
