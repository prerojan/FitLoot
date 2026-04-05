const schemaInitializationState = new WeakMap<D1Database, Map<string, Promise<void>>>();
const cleanupThrottleState = new WeakMap<D1Database, Map<string, number>>();

function getSchemaInitializationMap(db: D1Database): Map<string, Promise<void>> {
  const cached = schemaInitializationState.get(db);
  if (cached) {
    return cached;
  }

  const created = new Map<string, Promise<void>>();
  schemaInitializationState.set(db, created);
  return created;
}

function getCleanupThrottleMap(db: D1Database): Map<string, number> {
  const cached = cleanupThrottleState.get(db);
  if (cached) {
    return cached;
  }

  const created = new Map<string, number>();
  cleanupThrottleState.set(db, created);
  return created;
}

export async function ensureRuntimeSchemaReady(
  db: D1Database,
  schemaKey: string,
  initializer: () => Promise<void>,
): Promise<void> {
  const schemaMap = getSchemaInitializationMap(db);
  const cached = schemaMap.get(schemaKey);
  if (cached) {
    await cached;
    return;
  }

  const started = (async () => {
    await initializer();
  })();

  schemaMap.set(schemaKey, started);

  try {
    await started;
  } catch (error) {
    schemaMap.delete(schemaKey);
    throw error;
  }
}

export async function runRuntimeCleanupThrottled(
  db: D1Database,
  cleanupKey: string,
  minIntervalMs: number,
  cleanup: () => Promise<void>,
  now = Date.now(),
): Promise<void> {
  const cleanupMap = getCleanupThrottleMap(db);
  const lastRunAt = cleanupMap.get(cleanupKey);
  if (typeof lastRunAt === "number" && now - lastRunAt < minIntervalMs) {
    return;
  }

  await cleanup();
  cleanupMap.set(cleanupKey, now);
}
