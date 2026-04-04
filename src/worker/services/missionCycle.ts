export type MissionPeriod = "daily" | "weekly" | "monthly";

const WEEKDAY_ORDER = [
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
] as const;

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

function extractDateParts(
  reference: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  return { year, month, day };
}

function formatDateKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${padTwo(parts.month)}-${padTwo(parts.day)}`;
}

function addDaysToDateKey(dateKey: string, amount: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const next = new Date(Date.UTC(year, month - 1, day + amount, 12, 0, 0));
  return formatDateKey(extractDateParts(next, "UTC"));
}

export function shiftMissionDateKey(dateKey: string, amount: number): string {
  return addDaysToDateKey(dateKey, amount);
}

function weekdayIndexForDateKey(dateKey: string): number {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function parseOffsetMinutes(offsetLabel: string): number | null {
  const normalized = offsetLabel.replace("GMT", "").trim();
  const match = normalized.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function resolveOffsetMinutes(reference: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const label = formatter
    .formatToParts(reference)
    .find((part) => part.type === "timeZoneName")?.value;
  return parseOffsetMinutes(label ?? "") ?? 0;
}

function localMidnightToUtcIso(
  dateKey: string,
  timeZone: string,
): string {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const reference = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = resolveOffsetMinutes(reference, timeZone);
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60_000;
  return new Date(utcMs).toISOString();
}

export function sanitizeMissionTimeZone(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    return null;
  }
}

export function resolveMissionTimeZone(value: string | null | undefined): string {
  return sanitizeMissionTimeZone(value) ?? "UTC";
}

export function currentDateKeyInTimeZone(
  reference: Date,
  timeZone: string,
): string {
  return formatDateKey(extractDateParts(reference, resolveMissionTimeZone(timeZone)));
}

export function missionCycleDateKey(
  period: MissionPeriod,
  timeZone: string,
  reference = new Date(),
): string {
  const safeTimeZone = resolveMissionTimeZone(timeZone);
  const today = currentDateKeyInTimeZone(reference, safeTimeZone);

  if (period === "daily") {
    return today;
  }

  if (period === "monthly") {
    const [yearRaw, monthRaw] = today.split("-");
    return `${yearRaw}-${monthRaw}-01`;
  }

  const weekday = weekdayIndexForDateKey(today);
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDaysToDateKey(today, offset);
}

export function nextMissionCycleStartIso(
  period: MissionPeriod,
  timeZone: string,
  reference = new Date(),
): string {
  const safeTimeZone = resolveMissionTimeZone(timeZone);
  const currentCycleDate = missionCycleDateKey(period, safeTimeZone, reference);

  if (period === "daily") {
    return localMidnightToUtcIso(addDaysToDateKey(currentCycleDate, 1), safeTimeZone);
  }

  if (period === "weekly") {
    return localMidnightToUtcIso(addDaysToDateKey(currentCycleDate, 7), safeTimeZone);
  }

  const [yearRaw, monthRaw] = currentCycleDate.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const nextMonthReference = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  const nextMonthDateKey = formatDateKey(extractDateParts(nextMonthReference, "UTC"));
  return localMidnightToUtcIso(nextMonthDateKey, safeTimeZone);
}

export function missionCycleEndDateKey(
  period: MissionPeriod,
  cycleDate: string,
): string {
  if (period === "daily") {
    return cycleDate;
  }

  if (period === "weekly") {
    return addDaysToDateKey(cycleDate, 6);
  }

  const [yearRaw, monthRaw] = cycleDate.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const nextMonthReference = new Date(Date.UTC(year, month, 1, 12, 0, 0));
  return addDaysToDateKey(
    formatDateKey(extractDateParts(nextMonthReference, "UTC")),
    -1,
  );
}

export function missionWeekdayPtBr(
  reference = new Date(),
  timeZone = "UTC",
): string {
  const safeTimeZone = resolveMissionTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    weekday: "short",
  });
  const shortWeekday = formatter.format(reference).toLowerCase();
  if (shortWeekday.startsWith("mon")) return "segunda";
  if (shortWeekday.startsWith("tue")) return "terca";
  if (shortWeekday.startsWith("wed")) return "quarta";
  if (shortWeekday.startsWith("thu")) return "quinta";
  if (shortWeekday.startsWith("fri")) return "sexta";
  if (shortWeekday.startsWith("sat")) return "sabado";
  return "domingo";
}

export function isMissionCycleCurrent(
  period: MissionPeriod,
  cycleDate: string | null | undefined,
  timeZone: string,
  reference = new Date(),
): boolean {
  if (typeof cycleDate !== "string" || cycleDate.trim().length === 0) return false;
  return cycleDate.trim() === missionCycleDateKey(period, timeZone, reference);
}

export function missionCycleDateByRow(
  period: MissionPeriod,
  cycleDate: string | null | undefined,
  createdAt: string | null | undefined,
  timeZone: string,
): string {
  if (typeof cycleDate === "string" && cycleDate.trim().length > 0) {
    return cycleDate.trim();
  }
  const reference = typeof createdAt === "string" && createdAt.trim().length > 0
    ? new Date(createdAt)
    : new Date();
  return missionCycleDateKey(period, timeZone, reference);
}

export function allMissionCycleDates(
  timeZone: string,
  reference = new Date(),
): Record<MissionPeriod, string> {
  return {
    daily: missionCycleDateKey("daily", timeZone, reference),
    weekly: missionCycleDateKey("weekly", timeZone, reference),
    monthly: missionCycleDateKey("monthly", timeZone, reference),
  };
}

export function missionMonthKey(
  timeZone: string,
  reference = new Date(),
): string {
  return missionCycleDateKey("monthly", timeZone, reference).slice(0, 7);
}

export function weekdayOrderPtBr(): readonly string[] {
  return WEEKDAY_ORDER;
}
