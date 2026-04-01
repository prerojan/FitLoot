export type ActivationNotice = {
  title: string;
  message: string;
  badge?: string | undefined;
  tone: "success" | "warning" | "error";
};

const ACTIVATION_NOTICE_KEY = "fitloot_activation_notice";

function isActivationNotice(value: unknown): value is ActivationNotice {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const tone = record.tone;
  return (
    typeof record.title === "string" &&
    typeof record.message === "string" &&
    (typeof record.badge === "undefined" || typeof record.badge === "string") &&
    (tone === "success" || tone === "warning" || tone === "error")
  );
}

export function queueActivationNotice(notice: ActivationNotice): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(ACTIVATION_NOTICE_KEY, JSON.stringify(notice));
}

export function clearActivationNotice(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ACTIVATION_NOTICE_KEY);
}

export function consumeActivationNotice(): ActivationNotice | null {
  if (typeof window === "undefined") return null;

  const rawValue = sessionStorage.getItem(ACTIVATION_NOTICE_KEY);
  if (!rawValue) return null;

  sessionStorage.removeItem(ACTIVATION_NOTICE_KEY);

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!isActivationNotice(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
