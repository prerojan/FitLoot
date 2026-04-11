export type RouteMissionActivityKind = "walking" | "running" | null | undefined;

const WALKING_SPEED_METERS_PER_SECOND = 1.4;
const RUNNING_SPEED_METERS_PER_SECOND = 2.5;

export function routeMissionMetersPerSecond(
  activityKind: RouteMissionActivityKind,
): number {
  return activityKind === "running"
    ? RUNNING_SPEED_METERS_PER_SECOND
    : WALKING_SPEED_METERS_PER_SECOND;
}

export function estimateRouteMissionDurationSecondsFromMeters(
  distanceMeters: number,
  activityKind: RouteMissionActivityKind,
): number {
  const safeDistanceMeters = Math.max(0, Math.round(Number(distanceMeters) || 0));
  return Math.max(
    60,
    Math.round(safeDistanceMeters / routeMissionMetersPerSecond(activityKind)),
  );
}

export function estimateRouteMissionDurationMinutesFromMeters(
  distanceMeters: number,
  activityKind: RouteMissionActivityKind,
): number {
  return Math.max(
    1,
    Math.round(
      estimateRouteMissionDurationSecondsFromMeters(distanceMeters, activityKind) / 60,
    ),
  );
}
