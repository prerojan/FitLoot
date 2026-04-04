/**
 * Modal de execucao para missoes de caminhada e corrida.
 * Mantem o visual alinhado ao app e usa localizacao como fonte da distancia da sessao.
 */

import { memo, useMemo, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Flame,
  Footprints,
  MapPinned,
  Pause,
  Play,
  Route,
  X,
} from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import useWalkingMission from "@/react-app/hooks/useWalkingMission";
import DistanceMissionRoutePreview from "@/react-app/components/mission-card/DistanceMissionRoutePreview";
import {
  formatDistanceMissionAmount,
  resolveDistanceMissionActivityLabel,
} from "@/react-app/services/distanceMissionRoute";
import { formatStepsSourceLabel } from "@/react-app/services/native/stepsService";
import type { Mission } from "@/shared/types";

type WalkingMissionExecutionProps = {
  mission: Mission & { skill_name?: string | undefined };
  onComplete: (id: number, value: number, verified: boolean) => Promise<void> | void;
  onClose: () => void;
};

function buildStatusLabel(isCompleted: boolean, isRunning: boolean, isPaused: boolean): string {
  if (isCompleted) return "Concluida";
  if (isPaused) return "Pausada";
  if (isRunning) return "Em andamento";
  return "Pronta";
}

function renderMetricCard(
  icon: ReactNode,
  label: string,
  value: string,
  helper: string,
) {
  return (
    <div
      className="rounded-[24px] border p-4"
      style={{
        background: "color-mix(in srgb, var(--fl-surface-muted) 72%, transparent)",
        borderColor: "var(--fl-border-soft)",
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: "color-mix(in srgb, var(--app-primary-color) 16%, transparent)" }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--app-primary-color)" }}>
            {label}
          </p>
          <p className="text-lg font-bold leading-tight" style={{ color: "var(--fl-color-text)" }}>
            {value}
          </p>
        </div>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
        {helper}
      </p>
    </div>
  );
}

const WalkingMissionExecution = ({ mission, onComplete, onClose }: WalkingMissionExecutionProps) => {
  const {
    state,
    progress,
    formattedTime,
    startExecution,
    togglePause,
    completeMission,
    cancelExecution,
    isDistanceMission,
    healthData,
    canStart,
    canPause,
    canResume,
    canComplete,
  } = useWalkingMission({
    mission,
    onComplete: async (id, value, verified) => {
      await onComplete(id, value, verified);
    },
  });

  const activityLabel = useMemo(
    () => (isDistanceMission ? resolveDistanceMissionActivityLabel(mission) : "Caminhada"),
    [isDistanceMission, mission],
  );
  const statusLabel = buildStatusLabel(state.isCompleted, state.isRunning, state.isPaused);
  const distanceLabel = formatDistanceMissionAmount(state.currentDistance);
  const targetDistanceLabel = formatDistanceMissionAmount(state.targetDistance);
  const sourceLabel = formatStepsSourceLabel(healthData?.source);
  const locationLabel =
    state.locationPrecision === "approximate"
      ? "Localizacao aproximada"
      : state.locationPrecision === "precise"
        ? "Localizacao precisa"
        : "Localizacao indisponivel";

  const handleClose = () => {
    cancelExecution();
    onClose();
  };

  const handlePrimaryComplete = () => {
    void completeMission(isDistanceMission ? state.currentDistance : state.currentSteps);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <Card
        className="w-full max-w-5xl overflow-hidden rounded-[34px] border-0 p-0 shadow-2xl"
        style={{
          background: "transparent",
          boxShadow: "0 32px 90px rgba(0, 0, 0, 0.38)",
        }}
      >
        <div
          className="overflow-hidden rounded-[34px] border"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 96%, transparent), color-mix(in srgb, var(--fl-surface-muted) 94%, transparent))",
            borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
          }}
        >
          <header
            className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6"
            style={{ borderColor: "var(--fl-border-soft)" }}
          >
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: "var(--app-primary-color)" }}>
                Missao monitorada
              </p>
              <h2 className="truncate text-xl font-black sm:text-2xl" style={{ color: "var(--fl-color-text)" }}>
                {mission.title}
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--fl-color-text-muted)" }}>
                {isDistanceMission
                  ? `${activityLabel} guiada por rota sugerida`
                  : "Monitoramento ao vivo da sua sessao"}
              </p>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-opacity hover:opacity-90"
              style={{
                borderColor: "var(--fl-border-soft)",
                background: "color-mix(in srgb, var(--fl-surface-muted) 84%, transparent)",
                color: "var(--fl-color-text)",
              }}
              aria-label="Fechar execucao"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="space-y-5 p-5 sm:space-y-6 sm:p-6">
            {state.error ? (
              <div
                className="rounded-[22px] border px-4 py-3 text-sm font-medium"
                style={{
                  background: "color-mix(in srgb, #ef4444 12%, transparent)",
                  borderColor: "color-mix(in srgb, #ef4444 28%, transparent)",
                  color: "#991b1b",
                }}
              >
                {state.error}
              </div>
            ) : null}

            {isDistanceMission ? (
              <DistanceMissionRoutePreview
                mission={mission}
                variant="execution"
                loadStrategy="eager"
                showStats={false}
              >
                <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
                  <div className="max-w-[70%] rounded-[24px] border border-white/14 bg-black/34 px-4 py-3 text-white backdrop-blur-md">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/70">{activityLabel}</p>
                    <p className="mt-1 text-lg font-black leading-tight">{targetDistanceLabel}</p>
                    <p className="mt-1 text-xs text-white/78">Meta da sessao com acompanhamento por localizacao.</p>
                  </div>
                  <Badge className="border-0 bg-black/42 px-3 py-2 text-xs font-semibold text-white backdrop-blur-md">
                    {statusLabel}
                  </Badge>
                </div>

                <div className="absolute inset-x-4 bottom-4 rounded-[28px] border border-white/14 bg-black/40 p-4 text-white backdrop-blur-md">
                  <div className="mb-3 flex items-center justify-between gap-4 text-xs font-semibold text-white/78">
                    <span>Progresso da missao</span>
                    <span>{progress.toFixed(1)}%</span>
                  </div>
                  <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-white/16">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progress}%`,
                        background: "linear-gradient(90deg, var(--app-primary-color), color-mix(in srgb, var(--app-primary-color) 45%, white))",
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/62">Tempo</p>
                      <p className="mt-1 text-sm font-bold">{formattedTime}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/62">Distancia</p>
                      <p className="mt-1 text-sm font-bold">{distanceLabel}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/62">Passos</p>
                      <p className="mt-1 text-sm font-bold">{state.currentSteps.toLocaleString("pt-BR")}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/62">Calorias</p>
                      <p className="mt-1 text-sm font-bold">{state.currentCalories.toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                </div>
              </DistanceMissionRoutePreview>
            ) : (
              <div
                className="rounded-[30px] border p-6"
                style={{
                  background:
                    "radial-gradient(circle at top, color-mix(in srgb, var(--app-primary-color) 14%, transparent), transparent 44%), color-mix(in srgb, var(--fl-surface-muted) 72%, transparent)",
                  borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                }}
              >
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: "var(--app-primary-color)" }}>
                      Progresso monitorado
                    </p>
                    <p className="text-lg font-black" style={{ color: "var(--fl-color-text)" }}>
                      {state.currentSteps.toLocaleString("pt-BR")} / {state.targetSteps.toLocaleString("pt-BR")} passos
                    </p>
                  </div>
                  <Badge className="border-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)", color: "var(--app-primary-color)" }}>
                    {statusLabel}
                  </Badge>
                </div>
                <div className="h-3 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${progress}%`,
                      background: "linear-gradient(90deg, var(--app-primary-color), color-mix(in srgb, var(--app-primary-color) 45%, white))",
                    }}
                  />
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {renderMetricCard(
                <Clock3 className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />,
                "Tempo",
                formattedTime,
                "Cronometro da sessao atual, pausando junto com o monitoramento.",
              )}
              {renderMetricCard(
                <Route className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />,
                "Distancia",
                `${distanceLabel} / ${targetDistanceLabel}`,
                isDistanceMission
                  ? "A distancia desta missao e acumulada pela rota da sessao, sem reaproveitar deslocamentos anteriores."
                  : "Referencia de deslocamento disponivel enquanto os passos sao monitorados.",
              )}
              {renderMetricCard(
                <Footprints className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />,
                "Passos",
                state.currentSteps.toLocaleString("pt-BR"),
                "Passos vindos das metricas consolidadas do dispositivo durante a execucao.",
              )}
              {renderMetricCard(
                <Flame className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />,
                "Calorias",
                state.currentCalories.toLocaleString("pt-BR"),
                "Estimativa energetica acompanhando a mesma sessao monitorada.",
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
              <div
                className="rounded-[24px] border p-4"
                style={{
                  background: "color-mix(in srgb, var(--fl-surface-muted) 72%, transparent)",
                  borderColor: "var(--fl-border-soft)",
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <MapPinned className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                  <h3 className="text-sm font-bold uppercase tracking-[0.2em]" style={{ color: "var(--app-primary-color)" }}>
                    Sessao
                  </h3>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p style={{ color: "var(--fl-color-text-muted)" }}>Status</p>
                    <p className="mt-1 font-semibold" style={{ color: "var(--fl-color-text)" }}>{statusLabel}</p>
                  </div>
                  <div>
                    <p style={{ color: "var(--fl-color-text-muted)" }}>Fonte</p>
                    <p className="mt-1 font-semibold" style={{ color: "var(--fl-color-text)" }}>{sourceLabel}</p>
                  </div>
                  <div>
                    <p style={{ color: "var(--fl-color-text-muted)" }}>Precisao</p>
                    <p className="mt-1 font-semibold" style={{ color: "var(--fl-color-text)" }}>{locationLabel}</p>
                  </div>
                </div>
                {healthData?.lastUpdated ? (
                  <p className="mt-4 text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
                    Ultima atualizacao das metricas: {new Date(healthData.lastUpdated).toLocaleTimeString("pt-BR")}
                  </p>
                ) : null}
              </div>

              <div
                className="rounded-[24px] border p-4"
                style={{
                  background: "color-mix(in srgb, var(--fl-surface-muted) 72%, transparent)",
                  borderColor: "var(--fl-border-soft)",
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Activity className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                  <h3 className="text-sm font-bold uppercase tracking-[0.2em]" style={{ color: "var(--app-primary-color)" }}>
                    Meta da missao
                  </h3>
                </div>
                <p className="text-2xl font-black leading-tight" style={{ color: "var(--fl-color-text)" }}>
                  {isDistanceMission ? targetDistanceLabel : `${state.targetSteps.toLocaleString("pt-BR")} passos`}
                </p>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
                  {isDistanceMission
                    ? "A rota sugerida serve como guia visual; a conclusao depende da distancia realmente acumulada durante a sessao."
                    : "A conclusao acontece quando a meta de passos monitorados for alcancada."}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              {canStart ? (
                <Button
                  onClick={() => { void startExecution(); }}
                  className="flex-1 py-6 text-base font-bold"
                  variant="primary"
                >
                  <Play className="mr-2 h-5 w-5" />
                  {isDistanceMission ? `Iniciar ${activityLabel.toLowerCase()}` : "Iniciar caminhada"}
                </Button>
              ) : null}

              {!canStart && (canPause || canResume) ? (
                <Button
                  onClick={togglePause}
                  variant="outline"
                  className="flex-1 py-6 text-base font-bold"
                >
                  {canResume ? (
                    <>
                      <Play className="mr-2 h-5 w-5" />
                      Retomar
                    </>
                  ) : (
                    <>
                      <Pause className="mr-2 h-5 w-5" />
                      Pausar
                    </>
                  )}
                </Button>
              ) : null}

              {!state.isCompleted ? (
                <Button
                  onClick={handlePrimaryComplete}
                  disabled={!canComplete}
                  className="flex-1 py-6 text-base font-bold"
                  variant="outline"
                >
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                  Registrar conclusao
                </Button>
              ) : (
                <Button onClick={onClose} className="flex-1 py-6 text-base font-bold" variant="primary">
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                  Missao concluida
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default memo(WalkingMissionExecution);
