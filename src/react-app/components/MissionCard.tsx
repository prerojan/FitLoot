import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Dumbbell,
  MapPinned,
  Play,
  Sparkles,
  Star,
  Trophy,
  X,
} from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import LoadingBall from "@/react-app/components/LoadingBall";
import { shouldShowMissionDuration } from "@/constants/missionMetrics";
import type { Mission } from "@/shared/types";
import { localizeMissionText, localizeMissionTextArray } from "@/shared/missionLocalization";
import { api } from "@/react-app/utils/api";
import { useAppChrome } from "@/react-app/contexts/appChrome";
import WalkingMissionExecution from "./WalkingMissionExecution";
import { MissionExecutionModal } from "./mission-card/MissionExecutionModal";
import {
  formatDifficultyLabel,
  formatGoal,
  formatProgressAmount,
  normalizeMetricType,
  resolveCircuitTasks,
  resolveMissionDisplayTitle,
  resolveMissionFocusLabels,
  resolveMissionGoalText,
  resolveMissionMediaStyle,
  resolveMissionMediaUrl,
  resolveMissionVideoUrl,
  resolveProgressCounterParts,
  resolveProgressTarget,
  summarizeAutoProgressLabel,
} from "./mission-card/helpers";

type MissionCardProps = {
  mission: Mission & { skill_name?: string | undefined };
  onComplete: (id: number, reps: number, verified: boolean) => Promise<void> | void;
  layout?: "default" | "compact";
};

function formatMissionCycleDate(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length < 10) return null;
  const [yearRaw, monthRaw, dayRaw] = value.trim().slice(0, 10).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const reference = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(reference);
}

function MissionCardComponent({ mission, onComplete, layout = "default" }: MissionCardProps) {
  const { setMissionDetailsOpen, setMissionExecutionOpen } = useAppChrome();
  const [showDetails, setShowDetails] = useState(false);
  const [showExecution, setShowExecution] = useState(false);
  const [showWalkingExecution, setShowWalkingExecution] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailedMission, setDetailedMission] = useState<Mission | null>(null);

  // Derives the mission state used by the compact card, details modal, and execution entrypoints.
  const metricType = useMemo(() => normalizeMetricType(mission), [mission]);
  const missionStatus = (mission as Mission & { status?: string | undefined }).status || (mission.is_completed === 1 ? "completed" : "pending");
  const isFailed = missionStatus === "failed" || missionStatus === "expired";
  const isCompleted = mission.is_completed === 1 || missionStatus === "completed";
  const isCircuitMission = metricType === "circuit_tasks";
  const isWeeklyMission = mission.type === "weekly";
  const isMonthlyMission = mission.type === "monthly";
  const isAutoProgressMission = isWeeklyMission || isMonthlyMission;
  const isAIMission = Number(mission.is_ai_special ?? 0) === 1 || mission.mission_origin === "ai";
  const isWalkingMission = metricType === "steps" || metricType === "distance_meters";
  const isTrackableWalkingMission = isWalkingMission && mission.type === "daily";
  const circuitTasks = useMemo(() => resolveCircuitTasks(mission), [mission]);
  const focusLabels = useMemo(() => resolveMissionFocusLabels(mission), [mission]);
  const hasTaskProgressMission = circuitTasks.length > 0;
  const autoProgressRequiredTotal = circuitTasks.reduce((total, task) => total + Math.max(1, task.required_count), 0);
  const autoProgressCurrentTotal = circuitTasks.reduce(
    (total, task) => total + Math.min(Math.max(0, task.current_count), Math.max(1, task.required_count)),
    0,
  );
  const circuitProgress = autoProgressRequiredTotal > 0 ? (autoProgressCurrentTotal / autoProgressRequiredTotal) * 100 : 0;
  const missionMediaUrl = resolveMissionMediaUrl(mission);
  const missionGoalText = resolveMissionGoalText(mission, metricType);
  const primaryLabel = hasTaskProgressMission
    ? summarizeAutoProgressLabel(circuitTasks)
    : isAutoProgressMission
      ? missionGoalText
      : focusLabels[0] ?? missionGoalText;
  const hasCircuitProgress = circuitTasks.some((task) => task.current_count > 0);
  const isInProgress = !isFailed && !isCompleted && (missionStatus === "in_progress" || hasCircuitProgress);
  const visualState = isFailed ? "failed" : isCompleted ? "completed" : isInProgress ? "in_progress" : "available";
  const stateLabel = visualState === "failed"
    ? "Falhou"
    : visualState === "completed"
      ? "Concluída"
      : visualState === "in_progress"
        ? "Em progresso"
        : "Disponível";
  const missionTypeLabel = mission.type === "daily" ? "Diária" : mission.type === "weekly" ? "Semanal" : "Mensal";
  const monthlyTarget = resolveProgressTarget(mission, metricType);
  const monthlyProgressValue = Number((mission as Mission & { progress_value?: number | undefined }).progress_value ?? 0);
  const monthlyCurrent = circuitTasks.length > 0
    ? (isCompleted ? autoProgressRequiredTotal : autoProgressCurrentTotal)
    : (isCompleted ? monthlyTarget : Math.max(0, Math.min(monthlyTarget, monthlyProgressValue)));
  const monthlyProgress = Math.min(100, Math.round((monthlyCurrent / monthlyTarget) * 100));
  const monthlyProgressParts = resolveProgressCounterParts(mission, metricType, monthlyCurrent, monthlyTarget);
  const autoProgressLabel = isWeeklyMission ? "Progresso semanal" : "Progresso mensal";
  const autoProgressCounter = `${monthlyProgressParts.current}/${monthlyProgressParts.target}${monthlyProgressParts.unitLabel ? ` ${monthlyProgressParts.unitLabel}` : ""}`;
  const hasInlineInstructions =
    (Array.isArray(mission.instructions) && mission.instructions.length > 0) ||
    (Array.isArray(mission.exercise_instructions_pt) && mission.exercise_instructions_pt.length > 0) ||
    (Array.isArray(mission.exercise_instructions_en) && mission.exercise_instructions_en.length > 0);
  const hasInlineMuscles = Array.isArray(mission.muscle_groups) && mission.muscle_groups.length > 0;
  const hasInlineDetails = hasInlineInstructions && hasInlineMuscles && Array.isArray(mission.safety_tips) && mission.safety_tips.length > 0;

  // Loads the rich mission payload only when inline data is incomplete.
  const loadMissionDetails = useCallback(async (options?: { silent?: boolean }) => {
    if (hasInlineDetails) return;
    if (detailsLoading || detailedMission) return;

    try {
      setDetailsLoading(true);
      if (!options?.silent) {
        setDetailsError(null);
      }
      const response = await api(`/api/missions/${mission.id}`);
      if (!response.ok) {
        throw new Error("Falha ao carregar detalhes da missão.");
      }
      const payload = (await response.json()) as Mission;
      setDetailedMission(payload);
    } catch {
      if (!options?.silent) {
        setDetailsError("Não foi possível carregar os detalhes completos desta missão agora.");
      }
    } finally {
      setDetailsLoading(false);
    }
  }, [detailedMission, detailsLoading, hasInlineDetails, mission.id]);

  const completeMission = async (value: number) => {
    setCompleting(true);
    try {
      await onComplete(mission.id, value, true);
      setShowDetails(false);
      setShowWalkingExecution(false);
    } finally {
      setCompleting(false);
    }
  };

  const openDetails = async () => {
    setShowDetails(true);
    setDetailsError(null);
    await loadMissionDetails();
  };

  // Mirrors modal visibility into the shared chrome context.
  useEffect(() => {
    setMissionDetailsOpen(showDetails);
    return () => { setMissionDetailsOpen(false); };
  }, [setMissionDetailsOpen, showDetails]);

  useEffect(() => {
    setMissionExecutionOpen(showExecution);
    return () => { setMissionExecutionOpen(false); };
  }, [setMissionExecutionOpen, showExecution]);

  // Recomputes the detail-modal state from the best mission payload currently available.
  const missionDetails = detailedMission ?? mission;
  const detailMetricType = normalizeMetricType(missionDetails);
  const detailCircuitTasks = resolveCircuitTasks(missionDetails);
  const detailIsWeeklyMission = missionDetails.type === "weekly";
  const detailIsMonthlyMission = missionDetails.type === "monthly";
  const detailIsAutoProgressMission = detailIsWeeklyMission || detailIsMonthlyMission;
  const detailIsCompleted = missionDetails.is_completed === 1 || ((missionDetails as Mission & { status?: string | undefined }).status ?? "") === "completed";
  const detailHasTaskProgressMission = detailCircuitTasks.length > 0;
  const detailAutoProgressRequiredTotal = detailCircuitTasks.reduce((total, task) => total + Math.max(1, task.required_count), 0);
  const detailAutoProgressCurrentTotal = detailCircuitTasks.reduce(
    (total, task) => total + Math.min(Math.max(0, task.current_count), Math.max(1, task.required_count)),
    0,
  );
  const detailCircuitProgress = detailAutoProgressRequiredTotal > 0
    ? (detailAutoProgressCurrentTotal / detailAutoProgressRequiredTotal) * 100
    : 0;
  const detailMonthlyTarget = resolveProgressTarget(missionDetails, detailMetricType);
  const detailMonthlyProgressValue = Number((missionDetails as Mission & { progress_value?: number | undefined }).progress_value ?? 0);
  const detailMonthlyCurrent = detailCircuitTasks.length > 0
    ? (detailIsCompleted ? detailAutoProgressRequiredTotal : detailAutoProgressCurrentTotal)
    : (detailIsCompleted ? detailMonthlyTarget : Math.max(0, Math.min(detailMonthlyTarget, detailMonthlyProgressValue)));
  const detailMonthlyProgress = Math.min(100, Math.round((detailMonthlyCurrent / detailMonthlyTarget) * 100));
  const detailMonthlyProgressParts = resolveProgressCounterParts(missionDetails, detailMetricType, detailMonthlyCurrent, detailMonthlyTarget);
  const detailAutoProgressLabel = detailIsWeeklyMission ? "Progresso semanal" : "Progresso mensal";
  const detailProgressSectionLabel = detailHasTaskProgressMission
    ? (detailIsWeeklyMission ? "Circuito semanal" : "Meta mensal")
    : (detailIsWeeklyMission ? "Meta semanal" : "Meta mensal");
  const detailFocusLabels = detailIsAutoProgressMission ? [] : resolveMissionFocusLabels(missionDetails);
  const detailMissionMediaUrl = resolveMissionMediaUrl(missionDetails);
  const missionVideoUrl = resolveMissionVideoUrl(mission);
  const detailMissionVideoUrl = resolveMissionVideoUrl(missionDetails);
  const detailTitle = resolveMissionDisplayTitle(missionDetails.title);
  const safetyTipsBase = Array.isArray(missionDetails.safety_tips) && missionDetails.safety_tips.length > 0
    ? localizeMissionTextArray(missionDetails.safety_tips)
    : ["Mantenha alinhamento postural e interrompa em caso de dor aguda."];
  const safetyTips = Array.from(new Set([
    ...safetyTipsBase,
    "Faça alongamentos leves antes de iniciar a missão para preparar músculos e articulações.",
    "Após concluir a missão, faça alongamentos leves para apoiar a recuperação muscular.",
  ]));
  const missionMediaStyle = resolveMissionMediaStyle(missionMediaUrl);
  const detailMissionMediaStyle = resolveMissionMediaStyle(detailMissionMediaUrl);
  const detailIsTrackableWalkingMission = (detailMetricType === "steps" || detailMetricType === "distance_meters") && missionDetails.type === "daily";
  const detailIsCircuitMission = detailMetricType === "circuit_tasks";
  const missionCycleDateLabel = useMemo(
    () => formatMissionCycleDate(missionDetails.cycle_date),
    [missionDetails.cycle_date],
  );
  const showMissionDuration = shouldShowMissionDuration(mission.type)
    && typeof mission.duration_estimate_minutes === "number"
    && mission.duration_estimate_minutes > 0;
  const showDetailDuration = shouldShowMissionDuration(missionDetails.type)
    && typeof missionDetails.duration_estimate_minutes === "number"
    && missionDetails.duration_estimate_minutes > 0;
  const compactDurationLabel = showMissionDuration ? `${mission.duration_estimate_minutes} min` : null;
  const compactXpLabel = `+${mission.xp_reward} XP`;
  const cardTitle = resolveMissionDisplayTitle(mission.title);
  const cardDescription = mission.description
    ? (localizeMissionText(mission.description) ?? mission.description)
    : null;
  const compactSummary = isWeeklyMission
    ? [
        hasTaskProgressMission
          ? `${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1} tarefas`
          : formatProgressAmount(mission, metricType, monthlyCurrent, monthlyTarget),
        compactXpLabel,
      ].join(" | ")
    : isMonthlyMission && circuitTasks.length > 0
      ? [`${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1} tarefas`, compactXpLabel].join(" | ")
      : isMonthlyMission
        ? [formatProgressAmount(mission, metricType, monthlyCurrent, monthlyTarget), compactXpLabel].join(" | ")
        : isCircuitMission
          ? [compactDurationLabel, `${circuitTasks.length || monthlyTarget} tarefas`].filter(Boolean).join(" | ")
          : [compactDurationLabel, formatGoal(mission, metricType)].filter(Boolean).join(" | ");
  const compactActionLabel = isAutoProgressMission ? "Ver progresso" : isTrackableWalkingMission ? "Iniciar caminhada" : isCircuitMission ? "Ver detalhes" : "Iniciar treino";

  // Switches between the compact row layout and the richer card layout.
  const triggerContent = layout === "compact" ? (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
        >
          <Dumbbell className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold" style={{ color: "var(--fl-color-text)" }}>
            {cardTitle}
          </h3>
          <p className="truncate text-[11px] font-medium" style={{ color: "var(--fl-color-text-muted)" }}>
            {compactSummary}
          </p>
        </div>
      </div>

      {isFailed ? (
        <span className="text-xs font-bold" style={{ color: "var(--fl-color-text-muted)" }}>
          Expirada
        </span>
      ) : isCompleted ? (
        <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: "var(--app-primary-color)" }} />
      ) : (
        <button
          type="button"
          onClick={() => { 
            if (isTrackableWalkingMission) {
              setShowWalkingExecution(true);
            } else {
              void openDetails();
            }
          }}
          disabled={completing}
          className="shrink-0 text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ color: "var(--app-primary-color)" }}
        >
          {completing ? "Finalizando..." : compactActionLabel}
        </button>
      )}
    </div>
  ) : (
    <Card
      tone="soft"
      className={`p-5 transition-all min-h-[280px] ${
        visualState === "failed"
          ? "border-2 border-red-200 bg-red-50 opacity-90"
          : visualState === "completed"
            ? "border-2 border-emerald-200 bg-emerald-50"
            : visualState === "in_progress"
              ? "border-2 border-teal-200 bg-teal-50/80"
              : "hover:shadow-xl"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`w-fit ${
            mission.type === "daily"
              ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
              : mission.type === "weekly"
                ? "bg-teal-100 text-teal-700 border border-teal-200"
                : "bg-cyan-100 text-cyan-700 border border-cyan-200"
          }`}>
            {missionTypeLabel}
          </Badge>
          <Badge className="w-fit bg-gray-100 text-gray-700 border border-gray-200">
            {primaryLabel}
          </Badge>
          {isAIMission ? (
            <Badge className="w-fit gap-1 bg-purple-100 text-purple-700 border border-purple-200">
              <Sparkles className="w-3 h-3" />
              IA
            </Badge>
          ) : null}
        </div>
        <Badge className={`w-fit ${
          visualState === "failed"
            ? "bg-red-100 text-red-700 border border-red-200"
            : visualState === "completed"
              ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
              : visualState === "in_progress"
                ? "bg-teal-100 text-teal-700 border border-teal-200"
                : "bg-gray-100 text-gray-700 border border-gray-200"
        }`}>
          {stateLabel}
        </Badge>
      </div>

      {!isAutoProgressMission && (missionMediaUrl || missionVideoUrl) ? (
        <div
          className="hidden sm:block relative w-full mb-3 aspect-video overflow-hidden rounded-2xl border"
          style={{ background: "#ffffff", borderColor: "var(--fl-border-soft)" }}
        >
          {missionVideoUrl ? (
            <video
              src={missionVideoUrl}
              poster={missionMediaUrl ?? undefined}
              className="absolute inset-0 h-full w-full object-contain"
              style={missionMediaStyle}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : missionMediaUrl ? (
              <img
                src={missionMediaUrl}
                alt={cardTitle}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-contain"
              style={missionMediaStyle}
            />
          ) : null}
        </div>
      ) : null}

      <h3 className="font-semibold text-gray-900 mb-1">{cardTitle}</h3>
      <p className="text-sm text-gray-500 mb-2">{primaryLabel}</p>
      {!isAutoProgressMission && cardDescription ? <p className="text-sm text-gray-600 mb-3 line-clamp-2">{cardDescription}</p> : null}

      {isAutoProgressMission ? (
        <div className="space-y-3 mb-3">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>{hasTaskProgressMission && isWeeklyMission ? "Progresso do circuito semanal" : autoProgressLabel}</span>
            <span>{hasTaskProgressMission ? `${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1}` : autoProgressCounter}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full"
              style={{
                width: `${hasTaskProgressMission ? circuitProgress : monthlyProgress}%`,
                background: isWeeklyMission ? "#10b981" : "#06b6d4",
              }}
            />
          </div>
          {hasTaskProgressMission ? (
            <div className="space-y-2">
              {circuitTasks.map((task) => {
                const progress = task.required_count > 0
                  ? Math.min(100, Math.round((task.current_count / task.required_count) * 100))
                  : 0;
                return (
                  <div key={task.id} className="rounded-xl border border-gray-200 p-2">
                    <div className="flex items-center justify-between text-xs text-gray-700 mb-1">
                      <span className="line-clamp-1">{localizeMissionText(task.label) ?? task.label}</span>
                      <span className="font-semibold">{task.current_count}/{task.required_count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-teal-500" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1 mb-3">
          <p className="text-sm text-gray-600">Meta: {formatGoal(mission, metricType)}</p>
          {mission.rest_seconds ? <p className="text-xs text-gray-500">Descanso entre séries: {mission.rest_seconds}s</p> : null}
        </div>
      )}

      <div className={`grid gap-2 mb-3 ${showMissionDuration ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-2 text-center">
          <p className="text-[10px] text-emerald-700 uppercase tracking-wide">XP</p>
          <p className="text-sm font-bold text-emerald-700">+{mission.xp_reward}</p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-2 text-center">
          <p className="text-[10px] text-teal-700 uppercase tracking-wide">Pontos</p>
          <p className="text-sm font-bold text-teal-700">+{mission.points_reward}</p>
        </div>
        {showMissionDuration ? (
          <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-2 text-center">
            <p className="text-[10px] text-cyan-700 uppercase tracking-wide">Tempo</p>
            <p className="text-sm font-bold text-cyan-700">{mission.duration_estimate_minutes ?? 10} min</p>
          </div>
        ) : null}
      </div>

      {mission.deadline ? (
        <div className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? "text-red-600" : "text-gray-500"}`}>
          <Clock3 className="w-3 h-3" />
          <span>{isFailed ? "Expirada/falhou" : "Em andamento"}</span>
        </div>
      ) : null}

      {isFailed ? (
        <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">Missão falhou por expiração</div>
      ) : isCompleted ? (
        <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">
          Missão concluída (+{mission.xp_reward} XP)
        </div>
      ) : (
        <Button 
          onClick={() => { 
            if (isTrackableWalkingMission) {
              setShowWalkingExecution(true);
            } else {
              void openDetails();
            }
          }} 
          variant="primary" 
          className="w-full py-3 rounded-xl shadow-md hover:shadow-lg" 
          disabled={completing}
        >
          {completing ? "Finalizando..." : isTrackableWalkingMission ? "Iniciar caminhada" : "Ver detalhes"}
        </Button>
      )}
    </Card>
  );

  return (
    <>
      {triggerContent}
      {showDetails && (
        <div className="fl-z-modal fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 md:p-8 overflow-y-auto">
          {/* Hosts the full mission-detail experience above the card grid. */}
          <div className="layout-content-container flex flex-col max-w-[600px] w-full rounded-xl shadow-2xl overflow-hidden relative" style={{ background: "var(--fl-surface-strong)", border: "1px solid color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
            
            {/* Keeps the detail header and close affordance pinned to the top of the modal. */}
            <header className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--fl-border-soft)" }}>
              <div className="flex items-center gap-3">
                <Dumbbell className="w-6 h-6" style={{ color: "var(--app-primary-color)" }} />
                <h2 className="text-xl font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>Detalhes da Missão</h2>
              </div>
              <button 
                onClick={() => setShowDetails(false)}
                className="flex items-center justify-center rounded-full h-10 w-10 transition-colors opacity-70 hover:opacity-100"
                style={{ background: "var(--fl-surface-muted)", color: "var(--fl-color-text)" }}
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="overflow-y-auto pb-32 min-h-[50vh] max-h-[75vh]">
              <div className="px-6 py-4">
                {!detailIsAutoProgressMission ? (
                  <div
                    className="relative w-full aspect-video rounded-xl overflow-hidden group border"
                    style={{ background: "#ffffff", borderColor: "var(--fl-border-soft)" }}
                  >
                    {detailMissionVideoUrl ? (
                      <video
                        src={detailMissionVideoUrl}
                        poster={detailMissionMediaUrl ?? undefined}
                        className="absolute inset-0 h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                        style={detailMissionMediaStyle}
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    ) : detailMissionMediaUrl ? (
                      <img
                        src={detailMissionMediaUrl}
                        alt={detailTitle}
                        className="absolute inset-0 h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                        style={detailMissionMediaStyle}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Dumbbell className="w-16 h-16 opacity-50" style={{ color: "var(--app-primary-color)" }} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <span className="rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-black" style={{ background: "var(--app-primary-color)" }}>
                        {stateLabel}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Summarizes the mission identity, difficulty, and load state. */}
              <div className="px-6 py-2">
                <h1 className="text-3xl font-black leading-tight" style={{ color: "var(--fl-color-text)" }}>{detailTitle}</h1>
                <p className="hidden text-base font-medium mt-1" style={{ color: "var(--app-primary-color)" }}>
                  Dificuldade: {missionDetails.difficulty_level ? missionDetails.difficulty_level.charAt(0).toUpperCase() + missionDetails.difficulty_level.slice(1) : "Iniciante"} • Est. {missionDetails.duration_estimate_minutes ?? 10} min
                </p>
                <p className="text-base font-medium mt-1" style={{ color: "var(--app-primary-color)" }}>
                  {[
                    `Dificuldade: ${formatDifficultyLabel(missionDetails.difficulty_level)}`,
                    detailIsAutoProgressMission
                      ? "Progresso automático"
                      : showDetailDuration
                        ? `Est. ${missionDetails.duration_estimate_minutes ?? 10} min`
                        : null,
                  ].filter(Boolean).join(" • ")}
                </p>
                {detailsLoading ? (
                  <div className="flex items-center gap-2 text-sm mt-3" style={{ color: "var(--fl-color-text-muted)" }}>
                    <LoadingBall size="sm" />
                    Carregando detalhes...
                  </div>
                ) : null}
                {detailsError ? (
                  <p className="text-sm text-red-600 mt-2">{detailsError}</p>
                ) : null}
              </div>

              {/* Shows either automatic-progress tracking or the manual execution briefing. */}
              {detailIsAutoProgressMission ? (
                <div className="px-6 pt-6">
                  <div
                    className="rounded-[28px] border p-5 space-y-4"
                    style={{
                      background: "linear-gradient(180deg, color-mix(in srgb, var(--app-primary-color) 14%, transparent), color-mix(in srgb, var(--fl-surface-muted) 72%, transparent))",
                      borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: "var(--app-primary-color)" }}>
                          {detailProgressSectionLabel}
                        </p>
                      </div>
                      <Badge className="shrink-0 border-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)", color: "var(--app-primary-color)" }}>
                        {Math.round(detailHasTaskProgressMission ? detailCircuitProgress : detailMonthlyProgress)}%
                      </Badge>
                    </div>

                    {detailHasTaskProgressMission ? (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold" style={{ color: "var(--fl-color-text-muted)" }}>
                            <span>{detailAutoProgressLabel}</span>
                            <span>{detailAutoProgressCurrentTotal}/{detailAutoProgressRequiredTotal || 1}</span>
                          </div>
                          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${detailCircuitProgress}%`,
                                background: detailIsWeeklyMission ? "linear-gradient(90deg, #10b981, #14b8a6)" : "linear-gradient(90deg, #06b6d4, #22d3ee)",
                              }}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          {detailCircuitTasks.map((task) => {
                            const taskProgress = task.required_count > 0
                              ? Math.min(100, Math.round((task.current_count / task.required_count) * 100))
                              : 0;
                            return (
                              <div
                                key={task.id}
                                className="rounded-2xl border p-3"
                                style={{
                                  background: "color-mix(in srgb, var(--fl-surface-strong) 84%, transparent)",
                                  borderColor: "var(--fl-border-soft)",
                                }}
                              >
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <CheckCircle2
                                      className="w-4 h-4 shrink-0"
                                      style={{ color: task.completed ? "var(--app-primary-color)" : "var(--fl-color-text-muted)" }}
                                    />
                                    <span className="text-sm font-semibold line-clamp-2" style={{ color: "var(--fl-color-text)" }}>
                                      {localizeMissionText(task.label) ?? task.label}
                                    </span>
                                  </div>
                                  <span className="text-xs font-bold shrink-0" style={{ color: "var(--fl-color-text-muted)" }}>
                                    {task.current_count}/{task.required_count}
                                  </span>
                                </div>
                                <div className="h-2 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }}>
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${taskProgress}%`,
                                      background: task.completed ? "var(--app-primary-color)" : (detailIsWeeklyMission ? "#14b8a6" : "#22d3ee"),
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold" style={{ color: "var(--fl-color-text-muted)" }}>
                            <span>{detailAutoProgressLabel}</span>
                            <span>{detailMonthlyProgressParts.current}/{detailMonthlyProgressParts.target}{detailMonthlyProgressParts.unitLabel ? ` ${detailMonthlyProgressParts.unitLabel}` : ""}</span>
                          </div>
                          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${detailMonthlyProgress}%`,
                                background: detailIsWeeklyMission
                                  ? "linear-gradient(90deg, #10b981, #14b8a6)"
                                  : "linear-gradient(90deg, #06b6d4, #22d3ee)",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {!detailIsAutoProgressMission ? (
                <>
                  <div className="px-6 pt-6">
                    <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                      <Dumbbell className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                      Músculos Alvo
                    </h3>
                    <div className="flex gap-2 flex-wrap">
                      {detailFocusLabels.map((label, idx) => (
                        <div
                          key={`${label}-${idx}`}
                          className="flex items-center gap-2 rounded-full px-4 py-1.5 border"
                          style={{ background: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}
                        >
                          <span className="font-semibold text-sm" style={{ color: "var(--app-primary-color)" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {safetyTips && safetyTips.length > 0 ? (
                    <div className="px-6 pt-8">
                      <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                        <Sparkles className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                        Instruções de Segurança
                      </h3>
                      <div className="space-y-3">
                        {safetyTips.map((tip, index) => (
                          <div
                            key={`${tip}-${index}`}
                            className="flex gap-3 p-3 rounded-lg border"
                            style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "var(--fl-border-soft)" }}
                          >
                            <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: "var(--app-primary-color)" }} />
                            <p className="text-sm" style={{ color: "var(--fl-color-text-muted)" }}>{tip}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {/* Highlights the rewards tied to completing the mission. */}
              <div className="px-6 pt-8 pb-4">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                  <Trophy className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                  Recompensas
                </h3>
                <div className={`grid gap-4 ${detailIsAutoProgressMission ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
                  <div className="min-w-0 p-4 rounded-xl flex items-center gap-4 border" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                      <Star className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] sm:text-xs font-bold uppercase leading-tight break-words" style={{ color: "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))" }}>Experiência</p>
                      <p className="text-[clamp(0.95rem,4vw,1.125rem)] font-bold leading-tight break-words tabular-nums" style={{ color: "var(--fl-color-text)" }}>+{missionDetails.xp_reward} XP</p>
                    </div>
                  </div>
                  {!detailIsAutoProgressMission ? (
                    <div className="min-w-0 p-4 rounded-xl flex items-center gap-4 border" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                        <Trophy className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] sm:text-xs font-bold uppercase leading-tight break-words" style={{ color: "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))" }}>FitCoins</p>
                        <p className="text-[clamp(0.95rem,4vw,1.125rem)] font-bold leading-tight break-words tabular-nums" style={{ color: "var(--fl-color-text)" }}>{missionDetails.points_reward}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Anchors the primary action that closes, continues, or starts the mission. */}
            <div className="absolute bottom-0 left-0 right-0 p-6 backdrop-blur-md flex flex-col items-center" style={{ borderTop: "1px solid var(--fl-border-soft)", background: "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)" }}>
              <button 
                onClick={() => {
                  if (detailIsAutoProgressMission || detailIsCircuitMission || detailIsCompleted || visualState === "failed") {
                    setShowDetails(false);
                  } else {
                    setShowDetails(false);
                    if (detailIsTrackableWalkingMission) {
                      setShowWalkingExecution(true);
                    } else {
                      setShowExecution(true);
                    }
                  }
                }}
                className="w-full text-black font-black text-lg py-4 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 relative z-10"
                style={{ 
                  background: "var(--app-primary-color)", 
                  boxShadow: "0 0 20px color-mix(in srgb, var(--app-primary-color) 25%, transparent)" 
                }}
              >
                {!detailIsCircuitMission && !detailIsAutoProgressMission && !detailIsCompleted && visualState !== "failed" ? <Play className="w-6 h-6 fill-black text-black" strokeWidth={1.5} /> : null}
                {detailIsCompleted
                  ? "CONCLUÍDA"
                  : visualState === "failed"
                    ? "FECHAR"
                    : detailIsAutoProgressMission || detailIsCircuitMission
                      ? "FECHAR"
                      : isInProgress
                        ? "CONTINUAR"
                        : detailIsTrackableWalkingMission
                          ? "INICIAR CAMINHADA"
                          : "INICIAR MISSÃO"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Opens the exercise execution flow only for trackable, non-auto-progress training missions. */}
      {!detailIsCircuitMission && !detailIsTrackableWalkingMission && !detailIsAutoProgressMission && (
        <MissionExecutionModal
          mission={missionDetails}
          metricType={detailMetricType}
          open={showExecution}
          onClose={() => setShowExecution(false)}
          onFinish={completeMission}
        />
      )}

      {/* Routes walking missions to the dedicated tracking experience. */}
      {showWalkingExecution && detailIsTrackableWalkingMission && (
        <WalkingMissionExecution
          mission={missionDetails}
          onComplete={async (id, value, verified) => {
            await onComplete(id, value, verified);
            setShowWalkingExecution(false);
          }}
          onClose={() => setShowWalkingExecution(false)}
        />
      )}

      {/* Keeps a lightweight footer context visible while the detail modal is open. */}
      {showDetails && !detailIsAutoProgressMission && (
        <div className="fl-z-modal fixed bottom-4 left-1/2 z-10 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full bg-white/88 px-3 py-2 text-[11px] leading-tight text-gray-500 shadow-lg backdrop-blur-sm sm:bottom-5 sm:max-w-[32rem] sm:text-xs">
          {detailFocusLabels[0] ? (
            <span className="flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap">
              <MapPinned className="h-3 w-3 shrink-0" />
              <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{detailFocusLabels[0]}</span>
            </span>
          ) : null}
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Trophy className="h-3 w-3 shrink-0" />
            <span>{missionDetails.xp_reward} XP</span>
          </span>
          {missionCycleDateLabel ? (
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Clock3 className="h-3 w-3 shrink-0" />
              <span>{missionCycleDateLabel}</span>
            </span>
          ) : null}
        </div>
      )}
    </>
  );
}

const MissionCard = memo(MissionCardComponent);
export default MissionCard;

