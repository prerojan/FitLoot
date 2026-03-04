export function safeGet<T>(arr: readonly T[], index: number): T | undefined {
  if (index < 0 || index >= arr.length) {
    return undefined;
  }
  return arr[index];
}

export function assertString(value: string | undefined | null, fallback = ""): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}
