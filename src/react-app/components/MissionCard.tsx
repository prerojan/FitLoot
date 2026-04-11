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
import { localizeMissionText } from "@/shared/missionLocalization";
import { api } from "@/react-app/utils/api";
import { useAppChrome } from "@/react-app/contexts/appChrome";
import {
  formatDistanceMissionAmount,
  formatDistanceMissionDuration,
  isDistanceRouteMission,
  resolveDistanceMissionActivityLabel,
  resolveDistanceMissionMinimumDurationSeconds,
  resolveDistanceMissionTargetMeters,
} from "@/react-app/services/distanceMissionRoute";
import DistanceMissionRoutePreview from "./mission-card/DistanceMissionRoutePreview";
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
  onComplete: (
    id: number,
    reps: number,
    verified: boolean,
  ) => Promise<void> | void;
  layout?: "default" | "compact";
};

function formatMissionCycleDate(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string" || value.trim().length < 10) return null;
  const [yearRaw, monthRaw, dayRaw] = value.trim().slice(0, 10).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  const reference = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(reference);
}

function resolveRouteMissionIntelCopy(
  mission: Mission,
  activityLabel: string,
  distanceLabel: string,
): string {
  const description =
    typeof mission.description === "string" ? mission.description.trim() : "";
  if (description.length > 0) {
    return localizeMissionText(description) ?? description;
  }

  const goal = typeof mission.goal === "string" ? mission.goal.trim() : "";
  if (goal.length > 0) {
    return `Percurso guiado para ${activityLabel.toLowerCase()} com meta de ${distanceLabel}. ${localizeMissionText(goal) ?? goal}.`;
  }

  return `Percurso guiado para ${activityLabel.toLowerCase()} com meta de ${distanceLabel}. Mantenha hidratacao, ritmo constante e postura solta durante toda a missao.`;
}

function hasNonEmptyItems(
  value: ReadonlyArray<unknown> | null | undefined,
): value is ReadonlyArray<unknown> {
  return Array.isArray(value) && value.length > 0;
}

function normalizeMissionProgressValue(
  value: number | null | undefined,
): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.max(0, numeric);
}

function resolveProgressPercent(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (current / target) * 100));
}

function resolveProgressBarWidth(percent: number): string {
  if (percent <= 0) {
    return "0%";
  }

  const visiblePercent = percent < 1 ? 1 : percent;
  return `${Math.min(100, visiblePercent)}%`;
}

function formatProgressPercentLabel(percent: number): string {
  if (percent <= 0) {
    return "0%";
  }

  if (percent < 1) {
    return "<1%";
  }

  if (percent < 10) {
    return `${percent.toFixed(1).replace(".", ",")}%`;
  }

  return `${Math.round(percent)}%`;
}

function shouldPreserveLivePeriodicProgress(
  baseMission: Mission,
  detailedMission: Mission,
): boolean {
  const missionType = detailedMission.type ?? baseMission.type;
  if (missionType !== "weekly" && missionType !== "monthly") {
    return false;
  }

  const hasTaskProgressMission =
    hasNonEmptyItems(baseMission.circuit_tasks) ||
    hasNonEmptyItems(detailedMission.circuit_tasks);

  return !hasTaskProgressMission;
}

function mergeMissionDetailPayload(
  baseMission: Mission,
  detailedMission: Mission | null,
): Mission {
  if (!detailedMission) {
    return baseMission;
  }

  const mergedProgressValue = (() => {
    const baseProgressValue = normalizeMissionProgressValue(
      baseMission.progress_value,
    );
    const detailedProgressValue = normalizeMissionProgressValue(
      detailedMission.progress_value,
    );

    if (!shouldPreserveLivePeriodicProgress(baseMission, detailedMission)) {
      return detailedProgressValue ?? baseProgressValue;
    }

    if (baseProgressValue === undefined) {
      return detailedProgressValue;
    }

    if (detailedProgressValue === undefined) {
      return baseProgressValue;
    }

    return Math.max(baseProgressValue, detailedProgressValue);
  })();

  const mergedMission: Mission = {
    ...baseMission,
    ...detailedMission,
    ...(mergedProgressValue !== undefined
      ? { progress_value: mergedProgressValue }
      : {}),
    instructions: hasNonEmptyItems(detailedMission.instructions)
      ? detailedMission.instructions
      : baseMission.instructions,
    exercise_instructions_en: hasNonEmptyItems(
      detailedMission.exercise_instructions_en,
    )
      ? detailedMission.exercise_instructions_en
      : baseMission.exercise_instructions_en,
    exercise_instructions_pt: hasNonEmptyItems(
      detailedMission.exercise_instructions_pt,
    )
      ? detailedMission.exercise_instructions_pt
      : baseMission.exercise_instructions_pt,
    muscle_groups: hasNonEmptyItems(detailedMission.muscle_groups)
      ? detailedMission.muscle_groups
      : baseMission.muscle_groups,
    exercise_secondary_muscles: hasNonEmptyItems(
      detailedMission.exercise_secondary_muscles,
    )
      ? detailedMission.exercise_secondary_muscles
      : baseMission.exercise_secondary_muscles,
    safety_tips: hasNonEmptyItems(detailedMission.safety_tips)
      ? detailedMission.safety_tips
      : baseMission.safety_tips,
    circuit_tasks: hasNonEmptyItems(detailedMission.circuit_tasks)
      ? detailedMission.circuit_tasks
      : baseMission.circuit_tasks,
    execution_mode:
      detailedMission.execution_mode ?? baseMission.execution_mode,
    activity_kind: detailedMission.activity_kind ?? baseMission.activity_kind,
    exercise_db_id:
      detailedMission.exercise_db_id ?? baseMission.exercise_db_id,
    exercise_target:
      detailedMission.exercise_target ?? baseMission.exercise_target,
    exercise_body_part:
      detailedMission.exercise_body_part ?? baseMission.exercise_body_part,
    exercise_category:
      detailedMission.exercise_category ?? baseMission.exercise_category,
  };

  if (
    isDistanceRouteMission(baseMission) &&
    !isDistanceRouteMission(mergedMission)
  ) {
    return {
      ...mergedMission,
      metric_type: baseMission.metric_type,
      metric_value: baseMission.metric_value,
      metric_unit: baseMission.metric_unit,
      goal: baseMission.goal ?? mergedMission.goal,
      title: baseMission.title,
      description: baseMission.description ?? mergedMission.description,
      exercise_name: baseMission.exercise_name ?? mergedMission.exercise_name,
      exercise_category:
        baseMission.exercise_category ?? mergedMission.exercise_category,
      execution_mode: baseMission.execution_mode,
      activity_kind: baseMission.activity_kind,
    };
  }

  return mergedMission;
}

function MissionCardComponent({
  mission,
  onComplete,
  layout = "default",
}: MissionCardProps) {
  const { setMissionDetailsOpen, setMissionExecutionOpen } = useAppChrome();
  const [showDetails, setShowDetails] = useState(false);
  const [showExecution, setShowExecution] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailedMission, setDetailedMission] = useState<Mission | null>(null);

  // Derives the mission state used by the compact card, details modal, and execution entrypoints.
  const metricType = useMemo(() => normalizeMetricType(mission), [mission]);
  const missionStatus =
    (mission as Mission & { status?: string | undefined }).status ||
    (mission.is_completed === 1 ? "completed" : "pending");
  const isFailed = missionStatus === "failed" || missionStatus === "expired";
  const isCompleted =
    mission.is_completed === 1 || missionStatus === "completed";
  const isCircuitMission = metricType === "circuit_tasks";
  const isWeeklyMission = mission.type === "weekly";
  const isMonthlyMission = mission.type === "monthly";
  const isAutoProgressMission = isWeeklyMission || isMonthlyMission;
  const isAIMission =
    Number(mission.is_ai_special ?? 0) === 1 || mission.mission_origin === "ai";
  const isDistanceRouteDailyMission = isDistanceRouteMission(mission);
  const isTrackableWalkingMission = isDistanceRouteDailyMission;
  const circuitTasks = useMemo(() => resolveCircuitTasks(mission), [mission]);
  const focusLabels = useMemo(
    () => resolveMissionFocusLabels(mission),
    [mission],
  );
  const hasTaskProgressMission = circuitTasks.length > 0;
  const autoProgressRequiredTotal = circuitTasks.reduce(
    (total, task) => total + Math.max(1, task.required_count),
    0,
  );
  const autoProgressCurrentTotal = circuitTasks.reduce(
    (total, task) =>
      total +
      Math.min(
        Math.max(0, task.current_count),
        Math.max(1, task.required_count),
      ),
    0,
  );
  const circuitProgress =
    autoProgressRequiredTotal > 0
      ? (autoProgressCurrentTotal / autoProgressRequiredTotal) * 100
      : 0;
  const missionMediaUrl = resolveMissionMediaUrl(mission);
  const missionGoalText = resolveMissionGoalText(mission, metricType);
  const primaryLabel = hasTaskProgressMission
    ? summarizeAutoProgressLabel(circuitTasks)
    : isAutoProgressMission
      ? missionGoalText
      : (focusLabels[0] ?? missionGoalText);
  const hasCircuitProgress = circuitTasks.some(
    (task) => task.current_count > 0,
  );
  const isInProgress =
    !isFailed &&
    !isCompleted &&
    (missionStatus === "in_progress" || hasCircuitProgress);
  const visualState = isFailed
    ? "failed"
    : isCompleted
      ? "completed"
      : isInProgress
        ? "in_progress"
        : "available";
  const stateLabel =
    visualState === "failed"
      ? "Falhou"
      : visualState === "completed"
        ? "Concluida"
        : visualState === "in_progress"
          ? "Em progresso"
          : "Disponivel";
  const missionTypeLabel =
    mission.type === "daily"
      ? "Diaria"
      : mission.type === "weekly"
        ? "Semanal"
        : "Mensal";
  const monthlyTarget = resolveProgressTarget(mission, metricType);
  const monthlyProgressValue = Number(
    (mission as Mission & { progress_value?: number | undefined })
      .progress_value ?? 0,
  );
  const monthlyCurrent =
    circuitTasks.length > 0
      ? isCompleted
        ? autoProgressRequiredTotal
        : autoProgressCurrentTotal
      : isCompleted
        ? monthlyTarget
        : Math.max(0, Math.min(monthlyTarget, monthlyProgressValue));
  const monthlyProgress = resolveProgressPercent(monthlyCurrent, monthlyTarget);
  const monthlyProgressBarWidth = resolveProgressBarWidth(monthlyProgress);
  const monthlyProgressLabel = formatProgressPercentLabel(monthlyProgress);
  const monthlyProgressParts = resolveProgressCounterParts(
    mission,
    metricType,
    monthlyCurrent,
    monthlyTarget,
  );
  const autoProgressLabel = "Progresso";
  const autoProgressCounter = `${monthlyProgressParts.current}/${monthlyProgressParts.target}${monthlyProgressParts.unitLabel ? ` ${monthlyProgressParts.unitLabel}` : ""}`;
  const hasInlineInstructions =
    (Array.isArray(mission.instructions) && mission.instructions.length > 0) ||
    (Array.isArray(mission.exercise_instructions_pt) &&
      mission.exercise_instructions_pt.length > 0) ||
    (Array.isArray(mission.exercise_instructions_en) &&
      mission.exercise_instructions_en.length > 0);
  const hasInlineMuscles =
    Array.isArray(mission.muscle_groups) && mission.muscle_groups.length > 0;
  const hasInlineDetails =
    hasInlineInstructions &&
    hasInlineMuscles &&
    Array.isArray(mission.safety_tips) &&
    mission.safety_tips.length > 0;

  // Loads the rich mission payload only when inline data is incomplete.
  const loadMissionDetails = useCallback(
    async (options?: { silent?: boolean }) => {
      if (hasInlineDetails) return;
      if (detailsLoading || detailedMission) return;

      try {
        setDetailsLoading(true);
        if (!options?.silent) {
          setDetailsError(null);
        }
        const response = await api(`/api/missions/${mission.id}`);
        if (!response.ok) {
          throw new Error("Falha ao carregar detalhes da missao.");
        }
        const payload = (await response.json()) as Mission;
        setDetailedMission(payload);
      } catch {
        if (!options?.silent) {
          setDetailsError(
            "Nao foi possivel carregar os detalhes completos desta missao agora.",
          );
        }
      } finally {
        setDetailsLoading(false);
      }
    },
    [detailedMission, detailsLoading, hasInlineDetails, mission.id],
  );

  const completeMission = async (value: number, verified = true) => {
    setCompleting(true);
    try {
      await onComplete(mission.id, value, verified);
      setShowDetails(false);
      setShowExecution(false);
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
    return () => {
      setMissionDetailsOpen(false);
    };
  }, [setMissionDetailsOpen, showDetails]);

  useEffect(() => {
    setMissionExecutionOpen(showExecution);
    return () => {
      setMissionExecutionOpen(false);
    };
  }, [setMissionExecutionOpen, showExecution]);

  // Recomputes the detail-modal state from the best mission payload currently available.
  const missionDetails = useMemo(
    () => mergeMissionDetailPayload(mission, detailedMission),
    [detailedMission, mission],
  );
  const detailMetricType = normalizeMetricType(missionDetails);
  const detailCircuitTasks = resolveCircuitTasks(missionDetails);
  const detailIsWeeklyMission = missionDetails.type === "weekly";
  const detailIsMonthlyMission = missionDetails.type === "monthly";
  const detailIsAutoProgressMission =
    detailIsWeeklyMission || detailIsMonthlyMission;
  const detailIsCompleted =
    missionDetails.is_completed === 1 ||
    ((missionDetails as Mission & { status?: string | undefined }).status ??
      "") === "completed";
  const detailHasTaskProgressMission = detailCircuitTasks.length > 0;
  const detailAutoProgressRequiredTotal = detailCircuitTasks.reduce(
    (total, task) => total + Math.max(1, task.required_count),
    0,
  );
  const detailAutoProgressCurrentTotal = detailCircuitTasks.reduce(
    (total, task) =>
      total +
      Math.min(
        Math.max(0, task.current_count),
        Math.max(1, task.required_count),
      ),
    0,
  );
  const detailCircuitProgress =
    detailAutoProgressRequiredTotal > 0
      ? (detailAutoProgressCurrentTotal / detailAutoProgressRequiredTotal) * 100
      : 0;
  const detailMonthlyTarget = resolveProgressTarget(
    missionDetails,
    detailMetricType,
  );
  const detailMonthlyProgressValue = Number(
    (missionDetails as Mission & { progress_value?: number | undefined })
      .progress_value ?? 0,
  );
  const detailMonthlyCurrent =
    detailCircuitTasks.length > 0
      ? detailIsCompleted
        ? detailAutoProgressRequiredTotal
        : detailAutoProgressCurrentTotal
      : detailIsCompleted
        ? detailMonthlyTarget
        : Math.max(
            0,
            Math.min(detailMonthlyTarget, detailMonthlyProgressValue),
          );
  const detailMonthlyProgress = resolveProgressPercent(
    detailMonthlyCurrent,
    detailMonthlyTarget,
  );
  const detailMonthlyProgressBarWidth =
    resolveProgressBarWidth(detailMonthlyProgress);
  const detailMonthlyProgressLabel =
    formatProgressPercentLabel(detailMonthlyProgress);
  const detailCircuitProgressBarWidth =
    resolveProgressBarWidth(detailCircuitProgress);
  const detailCircuitProgressLabel =
    formatProgressPercentLabel(detailCircuitProgress);
  const detailMonthlyProgressParts = resolveProgressCounterParts(
    missionDetails,
    detailMetricType,
    detailMonthlyCurrent,
    detailMonthlyTarget,
  );
  const detailAutoProgressLabel = detailHasTaskProgressMission
    ? detailIsWeeklyMission
      ? "Progresso semanal"
      : "Progresso mensal"
    : "Progresso";
  const detailProgressSectionLabel = detailHasTaskProgressMission
    ? detailIsWeeklyMission
      ? "Circuito semanal"
      : "Meta mensal"
    : detailIsWeeklyMission
      ? "Meta semanal"
      : "Meta mensal";
  const detailFocusLabels = detailIsAutoProgressMission
    ? []
    : resolveMissionFocusLabels(missionDetails);
  const detailMissionMediaUrl = resolveMissionMediaUrl(missionDetails);
  const missionVideoUrl = resolveMissionVideoUrl(mission);
  const detailMissionVideoUrl = resolveMissionVideoUrl(missionDetails);
  const detailTitle = resolveMissionDisplayTitle(missionDetails.title);
  const detailSafetyInstructions = [
    "Mantenha amplitude segura e postura alinhada durante toda a execucao.",
    "Faca alongamentos leves antes de iniciar a missao para preparar musculos e articulacoes.",
    "Apos concluir a missao, faca alongamentos leves para apoiar a recuperacao muscular.",
  ];
  const missionMediaStyle = resolveMissionMediaStyle(missionMediaUrl);
  const detailMissionMediaStyle = resolveMissionMediaStyle(
    detailMissionMediaUrl,
  );
  const detailIsDistanceRouteDailyMission =
    isDistanceRouteMission(missionDetails);
  const detailIsTrackableWalkingMission = detailIsDistanceRouteDailyMission;
  const detailRouteActivityLabel =
    resolveDistanceMissionActivityLabel(missionDetails);
  const detailRouteTargetMeters = detailIsDistanceRouteDailyMission
    ? resolveDistanceMissionTargetMeters(missionDetails)
    : 0;
  const detailRouteTargetLabel = detailIsDistanceRouteDailyMission
    ? formatDistanceMissionAmount(detailRouteTargetMeters)
    : null;
  const detailRouteDurationLabel = detailIsDistanceRouteDailyMission
    ? formatDistanceMissionDuration(
        resolveDistanceMissionMinimumDurationSeconds(missionDetails),
      )
    : null;
  const detailRouteIntelCopy =
    detailIsDistanceRouteDailyMission && detailRouteTargetLabel
      ? resolveRouteMissionIntelCopy(
          missionDetails,
          detailRouteActivityLabel,
          detailRouteTargetLabel,
        )
      : null;
  const detailWalkingActionLabel = detailIsDistanceRouteDailyMission
    ? "INICIAR PERCURSO"
    : "INICIAR MISSAO";
  const detailIsCircuitMission = detailMetricType === "circuit_tasks";
  const missionCycleDateLabel = useMemo(
    () => formatMissionCycleDate(missionDetails.cycle_date),
    [missionDetails.cycle_date],
  );
  const DetailHeaderIcon = detailIsDistanceRouteDailyMission
    ? MapPinned
    : Dumbbell;
  const detailSummaryCopy = missionDetails.description?.trim()
    ? (localizeMissionText(missionDetails.description) ??
      missionDetails.description)
    : detailIsDistanceRouteDailyMission && detailRouteIntelCopy
      ? detailRouteIntelCopy
      : detailIsAutoProgressMission
        ? null
      : resolveMissionGoalText(missionDetails, detailMetricType);
  const showPrimaryLabel =
    !isAutoProgressMission &&
    typeof primaryLabel === "string" &&
    primaryLabel.trim().length > 0;
  const showMissionDuration =
    shouldShowMissionDuration(mission.type) &&
    (
      isTrackableWalkingMission
      || (
        typeof mission.duration_estimate_minutes === "number" &&
        mission.duration_estimate_minutes > 0
      )
    );
  const showDetailDuration =
    shouldShowMissionDuration(missionDetails.type) &&
    (
      detailIsDistanceRouteDailyMission
      || (
        typeof missionDetails.duration_estimate_minutes === "number" &&
        missionDetails.duration_estimate_minutes > 0
      )
    );
  const detailModalShellClassName = detailIsDistanceRouteDailyMission
    ? "max-w-[700px] rounded-[34px]"
    : "max-w-[580px] rounded-[34px]";
  const detailModalShellStyle = {
    background:
      "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 92%, transparent), color-mix(in srgb, var(--fl-surface-muted) 90%, transparent))",
    border:
      "1px solid color-mix(in srgb, var(--app-primary-color) 16%, transparent)",
    boxShadow: "var(--fl-shadow-glass)",
  } as const;
  const detailGlassCardStyle = {
    background:
      "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 82%, transparent), color-mix(in srgb, var(--app-bg-color) 46%, transparent))",
    borderColor: "color-mix(in srgb, var(--fl-color-text) 8%, transparent)",
    boxShadow: "var(--fl-shadow-glass)",
  } as const;
  const detailGlassInsetCardStyle = {
    background: "color-mix(in srgb, var(--app-bg-color) 40%, transparent)",
    borderColor: "color-mix(in srgb, var(--fl-color-text) 8%, transparent)",
  } as const;
  const mediaPreviewBackdrop = "#ffffff";
  const detailMissionPreviewOverlayStyle = {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.02) 100%)",
  } as const;
  const missionPreviewSurfaceStyle = {
    ...missionMediaStyle,
    backgroundColor: mediaPreviewBackdrop,
  } as const;
  const detailMissionPreviewSurfaceStyle = {
    ...detailMissionMediaStyle,
    backgroundColor: mediaPreviewBackdrop,
  } as const;
  const compactDurationLabel = showMissionDuration
    ? isTrackableWalkingMission
      ? formatDistanceMissionDuration(
          resolveDistanceMissionMinimumDurationSeconds(mission),
        )
      : `${mission.duration_estimate_minutes} min`
    : null;
  const compactXpLabel = `+${mission.xp_reward} XP`;
  const cardTitle = resolveMissionDisplayTitle(mission.title);
  const cardDescription = mission.description
    ? (localizeMissionText(mission.description) ?? mission.description)
    : null;
  const compactSummary = isWeeklyMission
    ? [
        hasTaskProgressMission
          ? `${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1} tarefas`
          : formatProgressAmount(
              mission,
              metricType,
              monthlyCurrent,
              monthlyTarget,
            ),
        compactXpLabel,
      ].join(" | ")
    : isMonthlyMission && circuitTasks.length > 0
      ? [
          `${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1} tarefas`,
          compactXpLabel,
        ].join(" | ")
      : isMonthlyMission
        ? [
            formatProgressAmount(
              mission,
              metricType,
              monthlyCurrent,
              monthlyTarget,
            ),
            compactXpLabel,
          ].join(" | ")
        : isCircuitMission
          ? [
              compactDurationLabel,
              `${circuitTasks.length || monthlyTarget} tarefas`,
            ]
              .filter(Boolean)
              .join(" | ")
          : [compactDurationLabel, formatGoal(mission, metricType)]
              .filter(Boolean)
              .join(" | ");
  const compactActionLabel = isAutoProgressMission
    ? "Ver progresso"
    : isTrackableWalkingMission
      ? "Ver detalhes"
      : isCircuitMission
        ? "Ver detalhes"
        : "Iniciar treino";

  // Switches between the compact row layout and the richer card layout.
  const triggerContent =
    layout === "compact" ? (
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "var(--app-primary-color)",
              color: "var(--fl-nav-item-active-text)",
            }}
          >
            <Dumbbell className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3
              className="truncate text-base font-bold"
              style={{ color: "var(--fl-color-text)" }}
            >
              {cardTitle}
            </h3>
            <p
              className="truncate text-[11px] font-medium"
              style={{ color: "var(--fl-color-text-muted)" }}
            >
              {compactSummary}
            </p>
          </div>
        </div>

        {isFailed ? (
          <span
            className="text-xs font-bold"
            style={{ color: "var(--fl-color-text-muted)" }}
          >
            Expirada
          </span>
        ) : isCompleted ? (
          <CheckCircle2
            className="h-5 w-5 shrink-0"
            style={{ color: "var(--app-primary-color)" }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (isTrackableWalkingMission) {
                void openDetails();
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
            <Badge
              className={`w-fit ${
                mission.type === "daily"
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : mission.type === "weekly"
                    ? "bg-teal-100 text-teal-700 border border-teal-200"
                    : "bg-cyan-100 text-cyan-700 border border-cyan-200"
              }`}
            >
              {missionTypeLabel}
            </Badge>
            {showPrimaryLabel ? (
              <Badge className="w-fit bg-gray-100 text-gray-700 border border-gray-200">
                {primaryLabel}
              </Badge>
            ) : null}
            {isAIMission ? (
              <Badge className="w-fit gap-1 bg-purple-100 text-purple-700 border border-purple-200">
                <Sparkles className="w-3 h-3" />
                IA
              </Badge>
            ) : null}
          </div>
          <Badge
            className={`w-fit ${
              visualState === "failed"
                ? "bg-red-100 text-red-700 border border-red-200"
                : visualState === "completed"
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : visualState === "in_progress"
                    ? "bg-teal-100 text-teal-700 border border-teal-200"
                    : "bg-gray-100 text-gray-700 border border-gray-200"
            }`}
          >
            {stateLabel}
          </Badge>
        </div>

        {!isAutoProgressMission && isDistanceRouteDailyMission ? (
          <DistanceMissionRoutePreview
            mission={mission}
            variant="card"
            loadStrategy="passive"
            className="mb-3 hidden sm:block"
          />
        ) : !isAutoProgressMission && (missionMediaUrl || missionVideoUrl) ? (
          <div
            className="hidden sm:block relative w-full mb-3 aspect-video overflow-hidden rounded-2xl border"
            style={{
              background: mediaPreviewBackdrop,
              borderColor: "var(--fl-border-soft)",
            }}
          >
            {missionVideoUrl ? (
              <video
                src={missionVideoUrl}
                poster={missionMediaUrl ?? undefined}
                className="absolute inset-0 h-full w-full object-contain"
                style={missionPreviewSurfaceStyle}
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
                style={missionPreviewSurfaceStyle}
              />
            ) : null}
          </div>
        ) : null}

        <h3 className="font-semibold text-gray-900 mb-1">{cardTitle}</h3>
        {showPrimaryLabel ? (
          <p className="text-sm text-gray-500 mb-2">{primaryLabel}</p>
        ) : null}
        {!isAutoProgressMission && cardDescription ? (
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">
            {cardDescription}
          </p>
        ) : null}

        {isAutoProgressMission ? (
          <div className="space-y-3 mb-3">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>
                {hasTaskProgressMission && isWeeklyMission
                  ? "Progresso do circuito semanal"
                  : autoProgressLabel}
              </span>
              <span>
                {hasTaskProgressMission
                  ? `${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1}`
                  : autoProgressCounter}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full"
                aria-label={`Progresso atual ${hasTaskProgressMission ? formatProgressPercentLabel(circuitProgress) : monthlyProgressLabel}`}
                style={{
                  width: hasTaskProgressMission
                    ? resolveProgressBarWidth(circuitProgress)
                    : monthlyProgressBarWidth,
                  minWidth:
                    !hasTaskProgressMission && monthlyCurrent > 0
                      ? "12px"
                      : "0px",
                  background: isWeeklyMission ? "#10b981" : "#06b6d4",
                }}
              />
            </div>
            {hasTaskProgressMission ? (
              <div className="space-y-2">
                {circuitTasks.map((task) => {
                  const progress =
                    task.required_count > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (task.current_count / task.required_count) * 100,
                          ),
                        )
                      : 0;
                  return (
                    <div
                      key={task.id}
                      className="rounded-xl border border-gray-200 p-2"
                    >
                      <div className="flex items-center justify-between text-xs text-gray-700 mb-1">
                        <span className="line-clamp-1">
                          {localizeMissionText(task.label) ?? task.label}
                        </span>
                        <span className="font-semibold">
                          {task.current_count}/{task.required_count}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full bg-teal-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1 mb-3">
            <p className="text-sm text-gray-600">
              Meta: {formatGoal(mission, metricType)}
            </p>
            {mission.rest_seconds ? (
              <p className="text-xs text-gray-500">
                Descanso entre series: {mission.rest_seconds}s
              </p>
            ) : null}
          </div>
        )}

        <div
          className={`grid gap-2 mb-3 ${showMissionDuration ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-2 text-center">
            <p className="text-[10px] text-emerald-700 uppercase tracking-wide">
              XP
            </p>
            <p className="text-sm font-bold text-emerald-700">
              +{mission.xp_reward}
            </p>
          </div>
          <div className="rounded-xl border border-teal-100 bg-teal-50 p-2 text-center">
            <p className="text-[10px] text-teal-700 uppercase tracking-wide">
              Pontos
            </p>
            <p className="text-sm font-bold text-teal-700">
              +{mission.points_reward}
            </p>
          </div>
          {showMissionDuration ? (
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-2 text-center">
              <p className="text-[10px] text-cyan-700 uppercase tracking-wide">
                Tempo
              </p>
              <p className="text-sm font-bold text-cyan-700">
                {isTrackableWalkingMission
                  ? formatDistanceMissionDuration(
                      resolveDistanceMissionMinimumDurationSeconds(mission),
                    )
                  : `${mission.duration_estimate_minutes ?? 10} min`}
              </p>
            </div>
          ) : null}
        </div>

        {mission.deadline ? (
          <div
            className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? "text-red-600" : "text-gray-500"}`}
          >
            <Clock3 className="w-3 h-3" />
            <span>{isFailed ? "Expirada/falhou" : "Em andamento"}</span>
          </div>
        ) : null}

        {isFailed ? (
          <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">
            Missao falhou por expiracao
          </div>
        ) : isCompleted ? (
          <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">
            Missao concluida (+{mission.xp_reward} XP)
          </div>
        ) : (
          <Button
            onClick={() => {
              void openDetails();
            }}
            variant="primary"
            className="w-full py-3 rounded-xl shadow-md hover:shadow-lg"
            disabled={completing}
          >
            {completing ? "Finalizando..." : "Ver detalhes"}
          </Button>
        )}
      </Card>
    );

  return (
    <>
      <div className={showDetails ? "pointer-events-none opacity-0" : ""}>
        {triggerContent}
      </div>
      {showDetails && (
        <div className="fl-z-modal fixed inset-0 bg-black/68 backdrop-blur-xl flex items-center justify-center overflow-x-hidden overflow-y-auto p-4 md:p-8">
          {/* Hosts the full mission-detail experience above the card grid. */}
          <div
            className={`layout-content-container relative flex w-full flex-col overflow-hidden ${detailModalShellClassName}`}
            style={detailModalShellStyle}
          >
            {/* Keeps the detail header and close affordance pinned to the top of the modal. */}
            <header
              className="flex items-center justify-between px-6 py-5 backdrop-blur-xl"
              style={{
                borderBottom:
                  "1px solid color-mix(in srgb, var(--fl-color-text) 8%, transparent)",
              }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border"
                  style={{
                    background:
                      "color-mix(in srgb, var(--app-bg-color) 48%, transparent)",
                    borderColor:
                      "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                  }}
                >
                  <DetailHeaderIcon
                    className="h-5 w-5"
                    style={{ color: "var(--app-primary-color)" }}
                  />
                </div>
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-black uppercase tracking-[0.28em]"
                    style={{ color: "var(--app-primary-color)" }}
                  >
                    Detalhes da missao
                  </p>
                  <p
                    className="mt-1 text-xs font-semibold uppercase tracking-[0.2em]"
                    style={{ color: "var(--fl-color-text-muted)" }}
                  >
                    {missionTypeLabel}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDetails(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-opacity hover:opacity-90"
                style={{
                  background:
                    "color-mix(in srgb, var(--app-bg-color) 46%, transparent)",
                  borderColor:
                    "color-mix(in srgb, var(--fl-color-text) 10%, transparent)",
                  color: "var(--fl-color-text)",
                }}
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div
              className={`overflow-x-hidden overflow-y-auto scrollbar-hide ${detailIsDistanceRouteDailyMission ? "min-h-[56vh] max-h-[78vh] pb-28" : "min-h-[50vh] max-h-[75vh] pb-32"}`}
            >
              {!detailIsAutoProgressMission ? (
                detailIsDistanceRouteDailyMission ? (
                  <div
                    className="relative overflow-hidden border-b"
                    style={{
                      borderColor: "var(--fl-border-soft)",
                      background:
                        "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)",
                    }}
                  >
                    <DistanceMissionRoutePreview
                      mission={missionDetails}
                      variant="details"
                      loadStrategy="eager"
                      showStats={false}
                      showTopChips={false}
                      className="h-[34vh] min-h-[272px] rounded-none border-0 sm:h-[38vh]"
                    >
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(180deg, color-mix(in srgb, var(--app-bg-color) 12%, transparent), color-mix(in srgb, var(--app-bg-color) 74%, transparent))",
                        }}
                      />
                      <div
                        className="absolute bottom-5 left-[11px] right-[11px] flex items-end justify-between gap-3 sm:left-[11px] sm:right-[11px]"
                      >
                        <div
                          className="rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em]"
                          style={{
                            color: "var(--fl-color-text)",
                            background:
                              "color-mix(in srgb, var(--app-bg-color) 74%, transparent)",
                            border:
                              "1px solid color-mix(in srgb, var(--fl-color-text) 12%, transparent)",
                            backdropFilter: "blur(18px)",
                          }}
                        >
                          Rota verificada
                        </div>
                        <div
                          className="rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em]"
                          style={{
                            color: "var(--app-primary-color)",
                            background:
                              "color-mix(in srgb, var(--app-bg-color) 76%, transparent)",
                            border:
                              "1px solid color-mix(in srgb, var(--app-primary-color) 24%, transparent)",
                            backdropFilter: "blur(18px)",
                          }}
                        >
                          {stateLabel}
                        </div>
                      </div>
                    </DistanceMissionRoutePreview>
                  </div>
                ) : (
                  <div
                    className="relative overflow-hidden border-b"
                    style={{
                      borderColor: "var(--fl-border-soft)",
                      background: mediaPreviewBackdrop,
                    }}
                  >
                    <div
                      className="group relative h-[38vh] min-h-[300px] sm:h-[44vh]"
                      style={{
                        background: mediaPreviewBackdrop,
                      }}
                    >
                      {detailMissionVideoUrl ? (
                        <div className="absolute inset-0 flex items-center justify-center px-5 py-6 sm:px-8">
                          <video
                            src={detailMissionVideoUrl}
                            poster={detailMissionMediaUrl ?? undefined}
                            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]"
                            style={detailMissionPreviewSurfaceStyle}
                            autoPlay
                            loop
                            muted
                            playsInline
                          />
                        </div>
                      ) : detailMissionMediaUrl ? (
                        <div className="absolute inset-0 flex items-center justify-center px-5 py-6 sm:px-8">
                          <img
                            src={detailMissionMediaUrl}
                            alt={detailTitle}
                            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]"
                            style={detailMissionPreviewSurfaceStyle}
                          />
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Dumbbell
                            className="h-20 w-20 opacity-50"
                            style={{ color: "var(--app-primary-color)" }}
                          />
                        </div>
                      )}
                      <div
                        className="absolute inset-0"
                        style={detailMissionPreviewOverlayStyle}
                      />
                      <div className="absolute bottom-5 left-6">
                        <span
                          className="rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-black"
                          style={{ background: "var(--app-primary-color)" }}
                        >
                          {stateLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              ) : null}

              {/* Summarizes the mission identity, difficulty, and load state. */}
              <div className="px-6 py-2">
                <div className="pt-4">
                  <p
                    className="text-[10px] font-black uppercase tracking-[0.28em]"
                    style={{ color: "var(--app-primary-color)" }}
                  >
                    Resumo da missao
                  </p>
                  <h1
                    className="mt-3 text-[clamp(1.8rem,6vw,2.5rem)] font-black leading-[0.98]"
                    style={{ color: "var(--fl-color-text)" }}
                  >
                    {detailTitle}
                  </h1>
                  {detailSummaryCopy ? (
                    <p
                      className="mt-3 max-w-2xl text-sm leading-relaxed sm:text-base"
                      style={{ color: "var(--fl-color-text-muted)" }}
                    >
                      {detailSummaryCopy}
                    </p>
                  ) : null}
                  <div className="mt-5 flex flex-wrap gap-3">
                    {!detailIsDistanceRouteDailyMission &&
                    !detailIsAutoProgressMission ? (
                      <div
                        className="rounded-[22px] border px-4 py-3"
                        style={detailGlassInsetCardStyle}
                      >
                        <p
                          className="text-[10px] font-bold uppercase tracking-[0.22em]"
                          style={{ color: "var(--fl-color-text-muted)" }}
                        >
                          Dificuldade
                        </p>
                        <p
                          className="mt-1 text-sm font-bold"
                          style={{ color: "var(--fl-color-text)" }}
                        >
                          {formatDifficultyLabel(
                            missionDetails.difficulty_level,
                          )}
                        </p>
                      </div>
                    ) : null}
                    {detailIsDistanceRouteDailyMission ? (
                      <>
                        <div
                          className="rounded-[22px] border px-4 py-3"
                          style={detailGlassInsetCardStyle}
                        >
                          <p
                            className="text-[10px] font-bold uppercase tracking-[0.22em]"
                            style={{ color: "var(--fl-color-text-muted)" }}
                          >
                            Tempo minimo
                          </p>
                          <p
                            className="mt-1 text-sm font-bold"
                            style={{ color: "var(--fl-color-text)" }}
                          >
                            {detailRouteDurationLabel}
                          </p>
                        </div>
                        <div
                          className="rounded-[22px] border px-4 py-3"
                          style={detailGlassInsetCardStyle}
                        >
                          <p
                            className="text-[10px] font-bold uppercase tracking-[0.22em]"
                            style={{ color: "var(--fl-color-text-muted)" }}
                          >
                            Distancia
                          </p>
                          <p
                            className="mt-1 text-sm font-bold"
                            style={{ color: "var(--fl-color-text)" }}
                          >
                            {detailRouteTargetLabel}
                          </p>
                        </div>
                      </>
                    ) : showDetailDuration ? (
                      <div
                        className="rounded-[22px] border px-4 py-3"
                        style={detailGlassInsetCardStyle}
                      >
                        <p
                          className="text-[10px] font-bold uppercase tracking-[0.22em]"
                          style={{ color: "var(--fl-color-text-muted)" }}
                        >
                          Tempo estimado
                        </p>
                        <p
                          className="mt-1 text-sm font-bold"
                          style={{ color: "var(--fl-color-text)" }}
                        >
                          {detailIsDistanceRouteDailyMission
                            ? formatDistanceMissionDuration(
                                resolveDistanceMissionMinimumDurationSeconds(
                                  missionDetails,
                                ),
                              )
                            : `${missionDetails.duration_estimate_minutes ?? 10} min`}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
                {detailsLoading ? (
                  <div
                    className="flex items-center gap-2 text-sm mt-3"
                    style={{ color: "var(--fl-color-text-muted)" }}
                  >
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
                      background:
                        "linear-gradient(180deg, color-mix(in srgb, var(--app-primary-color) 14%, transparent), color-mix(in srgb, var(--fl-surface-muted) 72%, transparent))",
                      borderColor:
                        "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p
                          className="text-[11px] font-bold uppercase tracking-[0.28em]"
                          style={{ color: "var(--app-primary-color)" }}
                        >
                          {detailProgressSectionLabel}
                        </p>
                      </div>
                      <Badge
                        className="shrink-0 border-0"
                        style={{
                          background:
                            "color-mix(in srgb, var(--app-primary-color) 14%, transparent)",
                          color: "var(--app-primary-color)",
                        }}
                      >
                        {detailHasTaskProgressMission
                          ? detailCircuitProgressLabel
                          : detailMonthlyProgressLabel}
                      </Badge>
                    </div>

                    {detailHasTaskProgressMission ? (
                      <>
                        <div className="space-y-2">
                          <div
                            className="flex items-center justify-between text-xs font-semibold"
                            style={{ color: "var(--fl-color-text-muted)" }}
                          >
                            <span>{detailAutoProgressLabel}</span>
                            <span>
                              {detailAutoProgressCurrentTotal}/
                              {detailAutoProgressRequiredTotal || 1}
                            </span>
                          </div>
                          <div
                            className="h-2.5 rounded-full overflow-hidden"
                            style={{
                              background:
                                "color-mix(in srgb, var(--fl-color-text) 10%, transparent)",
                            }}
                          >
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              aria-label={`Progresso atual ${detailCircuitProgressLabel}`}
                              style={{
                                width: detailCircuitProgressBarWidth,
                                background: detailIsWeeklyMission
                                  ? "linear-gradient(90deg, #10b981, #14b8a6)"
                                  : "linear-gradient(90deg, #06b6d4, #22d3ee)",
                              }}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          {detailCircuitTasks.map((task) => {
                            const taskProgress =
                              task.required_count > 0
                                ? Math.min(
                                    100,
                                    Math.round(
                                      (task.current_count /
                                        task.required_count) *
                                        100,
                                    ),
                                  )
                                : 0;
                            return (
                              <div
                                key={task.id}
                                className="rounded-2xl border p-3"
                                style={{
                                  background:
                                    "color-mix(in srgb, var(--fl-surface-strong) 84%, transparent)",
                                  borderColor: "var(--fl-border-soft)",
                                }}
                              >
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <CheckCircle2
                                      className="w-4 h-4 shrink-0"
                                      style={{
                                        color: task.completed
                                          ? "var(--app-primary-color)"
                                          : "var(--fl-color-text-muted)",
                                      }}
                                    />
                                    <span
                                      className="text-sm font-semibold line-clamp-2"
                                      style={{ color: "var(--fl-color-text)" }}
                                    >
                                      {localizeMissionText(task.label) ??
                                        task.label}
                                    </span>
                                  </div>
                                  <span
                                    className="text-xs font-bold shrink-0"
                                    style={{
                                      color: "var(--fl-color-text-muted)",
                                    }}
                                  >
                                    {task.current_count}/{task.required_count}
                                  </span>
                                </div>
                                <div
                                  className="h-2 rounded-full overflow-hidden"
                                  style={{
                                    background:
                                      "color-mix(in srgb, var(--fl-color-text) 10%, transparent)",
                                  }}
                                >
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${taskProgress}%`,
                                      background: task.completed
                                        ? "var(--app-primary-color)"
                                        : detailIsWeeklyMission
                                          ? "#14b8a6"
                                          : "#22d3ee",
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
                          <div
                            className="flex items-center justify-between text-xs font-semibold"
                            style={{ color: "var(--fl-color-text-muted)" }}
                          >
                            <span>{detailAutoProgressLabel}</span>
                            <span>
                              {detailMonthlyProgressParts.current}/
                              {detailMonthlyProgressParts.target}
                              {detailMonthlyProgressParts.unitLabel
                                ? ` ${detailMonthlyProgressParts.unitLabel}`
                                : ""}
                            </span>
                          </div>
                          <div
                            className="h-2.5 rounded-full overflow-hidden"
                            style={{
                              background:
                                "color-mix(in srgb, var(--fl-color-text) 10%, transparent)",
                            }}
                          >
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              aria-label={`Progresso atual ${detailMonthlyProgressLabel}`}
                              style={{
                                width: detailMonthlyProgressBarWidth,
                                minWidth:
                                  detailMonthlyCurrent > 0 ? "12px" : "0px",
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
                detailIsDistanceRouteDailyMission ? (
                  <div className="space-y-7 px-6 pt-6">
                    <div>
                      <h3
                        className="mb-4 flex items-center gap-2 text-lg font-bold"
                        style={{ color: "var(--fl-color-text)" }}
                      >
                        <Sparkles
                          className="h-5 w-5"
                          style={{ color: "var(--app-primary-color)" }}
                        />
                        Instrucoes de seguranca
                      </h3>
                      <div className="space-y-3">
                        {detailSafetyInstructions.map((tip, index) => (
                          <div
                            key={`${tip}-${index}`}
                            className="flex gap-3 rounded-[22px] border p-3"
                            style={detailGlassInsetCardStyle}
                          >
                            <CheckCircle2
                              className="h-5 w-5 shrink-0"
                              style={{ color: "var(--app-primary-color)" }}
                            />
                            <p
                              className="text-sm"
                              style={{ color: "var(--fl-color-text-muted)" }}
                            >
                              {tip}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-7 px-6 pt-6">
                    {detailFocusLabels.length > 0 ? (
                      <div>
                        <h3
                          className="mb-4 flex items-center gap-2 text-lg font-bold"
                          style={{ color: "var(--fl-color-text)" }}
                        >
                          <Dumbbell
                            className="h-5 w-5"
                            style={{ color: "var(--app-primary-color)" }}
                          />
                          Musculos alvo
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {detailFocusLabels.map((label, idx) => (
                            <div
                              key={`${label}-${idx}`}
                              className="flex items-center gap-2 rounded-full border px-4 py-2"
                              style={{
                                background:
                                  "color-mix(in srgb, var(--app-primary-color) 10%, transparent)",
                                borderColor:
                                  "color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
                              }}
                            >
                              <span
                                className="text-sm font-semibold"
                                style={{ color: "var(--app-primary-color)" }}
                              >
                                {label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {detailSafetyInstructions.length > 0 ? (
                      <div>
                        <h3
                          className="mb-4 flex items-center gap-2 text-lg font-bold"
                          style={{ color: "var(--fl-color-text)" }}
                        >
                          <Sparkles
                            className="h-5 w-5"
                            style={{ color: "var(--app-primary-color)" }}
                          />
                          Instrucoes de seguranca
                        </h3>
                        <div className="space-y-3">
                          {detailSafetyInstructions.map((tip, index) => (
                            <div
                              key={`${tip}-${index}`}
                              className="flex gap-3 rounded-[22px] border p-3"
                              style={detailGlassInsetCardStyle}
                            >
                              <CheckCircle2
                                className="h-5 w-5 shrink-0"
                                style={{ color: "var(--app-primary-color)" }}
                              />
                              <p
                                className="text-sm"
                                style={{ color: "var(--fl-color-text-muted)" }}
                              >
                                {tip}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              ) : null}

              {/* Highlights the rewards tied to completing the mission. */}
              <div className="px-6 pt-8 pb-4">
                <h3
                  className="mb-3 flex items-center gap-2 text-lg font-bold"
                  style={{ color: "var(--fl-color-text)" }}
                >
                  <Trophy
                    className="w-5 h-5"
                    style={{ color: "var(--app-primary-color)" }}
                  />
                  Recompensas
                </h3>
                <div
                  className={`grid gap-4 ${detailIsAutoProgressMission ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}
                >
                  <div
                    className="min-w-0 flex items-center gap-4 rounded-[24px] border p-4"
                    style={detailGlassCardStyle}
                  >
                    <div
                      className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          "color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
                      }}
                    >
                      <Star
                        className="w-5 h-5"
                        style={{ color: "var(--app-primary-color)" }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[11px] sm:text-xs font-bold uppercase leading-tight break-words"
                        style={{
                          color:
                            "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))",
                        }}
                      >
                        Experiencia
                      </p>
                      <p
                        className="text-[clamp(0.95rem,4vw,1.125rem)] font-bold leading-tight break-words tabular-nums"
                        style={{ color: "var(--fl-color-text)" }}
                      >
                        +{missionDetails.xp_reward} XP
                      </p>
                    </div>
                  </div>
                  {!detailIsAutoProgressMission ? (
                    <div
                      className="min-w-0 flex items-center gap-4 rounded-[24px] border p-4"
                      style={detailGlassCardStyle}
                    >
                      <div
                        className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center"
                        style={{
                          background:
                            "color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
                        }}
                      >
                        <Trophy
                          className="w-5 h-5"
                          style={{ color: "var(--app-primary-color)" }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-[11px] sm:text-xs font-bold uppercase leading-tight break-words"
                          style={{
                            color:
                              "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))",
                          }}
                        >
                          FitCoins
                        </p>
                        <p
                          className="text-[clamp(0.95rem,4vw,1.125rem)] font-bold leading-tight break-words tabular-nums"
                          style={{ color: "var(--fl-color-text)" }}
                        >
                          {missionDetails.points_reward}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Anchors the primary action that closes, continues, or starts the mission. */}
            <div
              className={`absolute bottom-0 left-0 right-0 flex flex-col items-center backdrop-blur-md ${detailIsDistanceRouteDailyMission ? "px-6 pb-4 pt-4" : "p-6"}`}
              style={{
                borderTop: "1px solid var(--fl-border-soft)",
                background: detailIsDistanceRouteDailyMission
                  ? "linear-gradient(180deg, color-mix(in srgb, var(--app-bg-color) 16%, transparent), color-mix(in srgb, var(--fl-surface-strong) 96%, transparent))"
                  : "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)",
              }}
            >
              <button
                onClick={() => {
                  if (
                    detailIsAutoProgressMission ||
                    detailIsCircuitMission ||
                    detailIsCompleted ||
                    visualState === "failed"
                  ) {
                    setShowDetails(false);
                  } else {
                    setShowDetails(false);
                    setShowExecution(true);
                  }
                }}
                className={`relative z-10 flex w-full items-center justify-center gap-3 text-black font-black transition-all active:scale-95 ${detailIsDistanceRouteDailyMission ? "rounded-[24px] py-4 text-base sm:py-5 sm:text-lg" : "rounded-[24px] py-4 text-lg"}`}
                style={{
                  background: "var(--app-primary-color)",
                  boxShadow: detailIsDistanceRouteDailyMission
                    ? "0 18px 36px color-mix(in srgb, var(--app-primary-color) 20%, transparent)"
                    : "0 0 20px color-mix(in srgb, var(--app-primary-color) 25%, transparent)",
                }}
              >
                {!detailIsCircuitMission &&
                !detailIsAutoProgressMission &&
                !detailIsCompleted &&
                visualState !== "failed" ? (
                  <Play
                    className="w-6 h-6 fill-black text-black"
                    strokeWidth={1.5}
                  />
                ) : null}
                {detailIsCompleted
                  ? "CONCLUIDA"
                  : visualState === "failed"
                    ? "FECHAR"
                    : detailIsAutoProgressMission || detailIsCircuitMission
                      ? "FECHAR"
                      : isInProgress
                        ? "CONTINUAR"
                        : detailIsTrackableWalkingMission
                          ? detailWalkingActionLabel
                          : "INICIAR MISSAO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Opens the exercise execution flow only for trackable, non-auto-progress training missions. */}
      {!detailIsCircuitMission &&
        !detailIsTrackableWalkingMission &&
        !detailIsAutoProgressMission && (
          <MissionExecutionModal
            mission={missionDetails}
            metricType={detailMetricType}
            open={showExecution}
            onClose={() => setShowExecution(false)}
            onFinish={completeMission}
          />
        )}

      {detailIsTrackableWalkingMission && !detailIsAutoProgressMission && (
        <MissionExecutionModal
          mission={missionDetails}
          metricType={detailMetricType}
          open={showExecution}
          onClose={() => setShowExecution(false)}
          onFinish={completeMission}
        />
      )}

      {/* Keeps a lightweight footer context visible while the detail modal is open. */}
      {showDetails && !detailIsAutoProgressMission && (
        <div className="fl-z-modal fixed bottom-3 left-1/2 z-10 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full bg-white/88 px-3 py-2 text-[11px] leading-tight text-gray-500 shadow-lg backdrop-blur-sm sm:bottom-4 sm:max-w-[32rem] sm:text-xs">
          {!detailIsDistanceRouteDailyMission && detailFocusLabels[0] ? (
            <span className="flex min-w-0 max-w-full items-center gap-1">
              <MapPinned className="h-3 w-3 shrink-0" />
              <span className="max-w-[8.5rem] truncate sm:max-w-[14rem]">
                {detailFocusLabels[0]}
              </span>
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
