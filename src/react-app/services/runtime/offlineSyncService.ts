import {
  type OfflineOperationConfidence,
  type OfflineOperationSource,
  type OfflineOperationType,
  type OfflineSyncRequest,
} from "@/shared/types";
import { api } from "@/react-app/utils/api";
import {
  OFFLINE_METRICS_CURSOR_STORAGE_KEY,
  OFFLINE_QUEUE_STORAGE_KEY,
} from "@/react-app/constants/storage";
import {
  getHostContext,
  subscribeToLifecycleState,
  subscribeToNetworkStatus,
  type HostLifecycleState,
} from "./hostRuntime";

type MissionCompletionPayload = {
  mission_id: number;
  metric_completed: number;
  sensor_verified: boolean;
};

type MetricDeltaPayload = {
  delta: number;
  total_after_delta: number;
  date: string;
};

type AchievementPayload = {
  achievement_name: string;
  progress_current?: number | undefined;
  progress_required?: number | undefined;
};

type MissionQueuedOperation = {
  operationId: string;
  type: "mission_completed";
  userId?: string | undefined;
  occurredAt: string;
  source: OfflineOperationSource;
  confidence: OfflineOperationConfidence;
  syncStatus: "pending" | "failed";
  payload: MissionCompletionPayload;
  lastError?: string | null;
};

type MetricsQueuedOperation = {
  operationId: string;
  type: "step_delta_recorded" | "calorie_delta_recorded" | "achievement_triggered";
  userId?: string | undefined;
  occurredAt: string;
  source: OfflineOperationSource;
  confidence: OfflineOperationConfidence;
  syncStatus: "pending" | "failed";
  payload: MetricDeltaPayload | AchievementPayload;
  lastError?: string | null;
};

export type QueuedOfflineOperation = MissionQueuedOperation | MetricsQueuedOperation;

export type OfflineSyncState = {
  operations: QueuedOfflineOperation[];
  syncing: boolean;
  lastError: string | null;
};

export type OfflineMissionSyncedDetail = {
  missionIds: number[];
  syncedAt: string;
};

export type MissionSyncResponse = {
  success: boolean;
  xpGained?: number;
  pointsGained?: number;
  leveledUp?: boolean;
  reward_events?: unknown[];
  streakMultiplier?: string;
};

type MetricsCursor = {
  date: string;
  steps: number;
  calories: number;
};

const FLUSH_EVENT_NAME = "fitloot:offline-sync-flushed";
const MISSION_SYNCED_EVENT_NAME = "fitloot:offline-missions-synced";
const DEFAULT_BATCH_SIZE = 40;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStorageValue<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorageValue(key: string, value: unknown): void {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best effort persistence only.
  }
}

function resolveOfflineSource(): OfflineOperationSource {
  return getHostContext().platform === "android" ? "android-native" : "browser";
}

function isOnline(): boolean {
  const hostContext = getHostContext();
  if (hostContext.platform === "android") {
    return hostContext.networkOnline !== false;
  }

  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function createOperationId(type: OfflineOperationType): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${type}:${crypto.randomUUID()}`;
  }

  return `${type}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function chunkOperations<T>(items: readonly T[], chunkSize: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    output.push(items.slice(index, index + chunkSize));
  }
  return output;
}

function buildDefaultState(): OfflineSyncState {
  return {
    operations: [],
    syncing: false,
    lastError: null,
  };
}

class OfflineSyncService {
  private state: OfflineSyncState = buildDefaultState();
  private listeners = new Set<(state: OfflineSyncState) => void>();
  private flushInFlight: Promise<void> | null = null;
  private started = false;
  private networkOnline = isOnline();
  private unsubscribeNetwork: (() => void) | null = null;
  private unsubscribeLifecycle: (() => void) | null = null;

  constructor() {
    this.state = {
      ...buildDefaultState(),
      operations: this.readQueue(),
    };
  }

  getState(): OfflineSyncState {
    return this.state;
  }

  subscribe(listener: (state: OfflineSyncState) => void): () => void {
    this.start();
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.started || typeof window === "undefined") {
      return;
    }

    this.started = true;
    this.unsubscribeNetwork = subscribeToNetworkStatus((status) => {
      this.networkOnline = status.online;
      if (status.online) {
        void this.flush();
      }
    });
    this.unsubscribeLifecycle = subscribeToLifecycleState((state) => {
      if (state === "foreground") {
        void this.flush();
      }
    });
  }

  hydrateMetricsBaseline(baseline: {
    date: string;
    steps: number;
    calories: number;
  }): void {
    const current = this.readMetricsCursor();
    if (current.date !== baseline.date) {
      this.writeMetricsCursor({
        date: baseline.date,
        steps: Math.max(0, Math.round(baseline.steps)),
        calories: Math.max(0, Math.round(baseline.calories)),
      });
      return;
    }

    this.writeMetricsCursor({
      date: baseline.date,
      steps: Math.max(current.steps, Math.max(0, Math.round(baseline.steps))),
      calories: Math.max(current.calories, Math.max(0, Math.round(baseline.calories))),
    });
  }

  async syncMissionCompletion(params: {
    missionId: number;
    metricCompleted: number;
    sensorVerified: boolean;
    userId?: string | undefined;
    confidence?: OfflineOperationConfidence | undefined;
  }): Promise<{
    status: "queued" | "synced";
    operationId: string;
    result?: MissionSyncResponse | undefined;
  }> {
    this.start();

    const operation: MissionQueuedOperation = {
      operationId: createOperationId("mission_completed"),
      type: "mission_completed",
      userId: params.userId,
      occurredAt: new Date().toISOString(),
      source: resolveOfflineSource(),
      confidence: params.confidence ?? (params.sensorVerified ? "official" : "derived"),
      syncStatus: "pending",
      payload: {
        mission_id: params.missionId,
        metric_completed: params.metricCompleted,
        sensor_verified: params.sensorVerified,
      },
    };

    const existingQueuedOperation = this.findMissionOperation(params.missionId, params.userId);
    if (existingQueuedOperation) {
      const queuedOperation = this.enqueueMissionOperation(operation);
      if (this.networkOnline) {
        void this.flush();
      }
      return {
        status: "queued",
        operationId: queuedOperation.operationId,
      };
    }

    if (this.networkOnline) {
      try {
        const result = await this.flushMissionOperation(operation);
        this.dispatchFlushEvent();
        return {
          status: "synced",
          operationId: operation.operationId,
          result,
        };
      } catch (error) {
        const queuedOperation = this.enqueueMissionOperation({
          ...operation,
          syncStatus: "failed",
          lastError: error instanceof Error ? error.message : "Falha ao sincronizar missao.",
        });
        return {
          status: "queued",
          operationId: queuedOperation.operationId,
        };
      }
    }

    const queuedOperation = this.enqueueMissionOperation(operation);
    return {
      status: "queued",
      operationId: queuedOperation.operationId,
    };
  }

  async publishMetricsSnapshot(params: {
    date: string;
    steps: number;
    calories: number;
    confidence: OfflineOperationConfidence;
  }): Promise<void> {
    this.start();

    const nextSteps = Math.max(0, Math.round(params.steps));
    const nextCalories = Math.max(0, Math.round(params.calories));
    const cursor = this.readMetricsCursor();

    if (!cursor.date || cursor.date !== params.date) {
      this.writeMetricsCursor({
        date: params.date,
        steps: nextSteps,
        calories: nextCalories,
      });
      return;
    }

    const stepDelta = Math.max(0, nextSteps - cursor.steps);
    const calorieDelta = Math.max(0, nextCalories - cursor.calories);
    if (stepDelta <= 0 && calorieDelta <= 0) {
      return;
    }

    if (stepDelta > 0) {
      this.enqueueOperation({
        operationId: createOperationId("step_delta_recorded"),
        type: "step_delta_recorded",
        occurredAt: new Date().toISOString(),
        source: resolveOfflineSource(),
        confidence: params.confidence,
        syncStatus: "pending",
        payload: {
          delta: stepDelta,
          total_after_delta: nextSteps,
          date: params.date,
        },
      });
    }

    if (calorieDelta > 0) {
      this.enqueueOperation({
        operationId: createOperationId("calorie_delta_recorded"),
        type: "calorie_delta_recorded",
        occurredAt: new Date().toISOString(),
        source: resolveOfflineSource(),
        confidence: params.confidence,
        syncStatus: "pending",
        payload: {
          delta: calorieDelta,
          total_after_delta: nextCalories,
          date: params.date,
        },
      });
    }

    this.writeMetricsCursor({
      date: params.date,
      steps: nextSteps,
      calories: nextCalories,
    });

    if (this.networkOnline) {
      void this.flush();
    }
  }

  getPendingMissionIds(): Set<number> {
    return new Set(
      this.state.operations
        .filter(
          (operation): operation is MissionQueuedOperation =>
            operation.type === "mission_completed" && operation.syncStatus === "pending",
        )
        .map((operation) => operation.payload.mission_id),
    );
  }

  async flush(): Promise<void> {
    if (!this.networkOnline) {
      return;
    }

    if (this.flushInFlight) {
      return this.flushInFlight;
    }

    this.flushInFlight = this.performFlush().finally(() => {
      this.flushInFlight = null;
    });

    return this.flushInFlight;
  }

  private async performFlush(): Promise<void> {
    const operations = [...this.state.operations];
    if (operations.length === 0) {
      return;
    }

    this.setState({
      ...this.state,
      syncing: true,
      lastError: null,
    });

    const nextQueue = [...operations];
    let flushedAnyOperation = false;
    const syncedMissionIds = new Set<number>();

    for (const operation of operations.filter((item): item is MissionQueuedOperation => item.type === "mission_completed")) {
      try {
        await this.flushMissionOperation(operation);
        flushedAnyOperation = true;
        syncedMissionIds.add(operation.payload.mission_id);
        this.removeOperationFromQueue(nextQueue, operation.operationId);
      } catch (error) {
        this.markOperationFailed(
          nextQueue,
          operation.operationId,
          error instanceof Error ? error.message : "Falha ao sincronizar missao pendente.",
        );
        break;
      }
    }

    const metricOperations = nextQueue.filter(
      (operation): operation is MetricsQueuedOperation => operation.type !== "mission_completed",
    );

    if (metricOperations.length > 0) {
      for (const batch of chunkOperations(metricOperations, DEFAULT_BATCH_SIZE)) {
        try {
          await this.flushMetricBatch(batch);
          flushedAnyOperation = true;
          batch.forEach((operation) => {
            this.removeOperationFromQueue(nextQueue, operation.operationId);
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Falha ao sincronizar metricas pendentes.";
          batch.forEach((operation) => {
            this.markOperationFailed(nextQueue, operation.operationId, message);
          });
          break;
        }
      }
    }

    this.replaceQueue(nextQueue);
    this.setState({
      operations: nextQueue,
      syncing: false,
      lastError: nextQueue.some((operation) => operation.syncStatus === "failed")
        ? "Algumas operacoes offline ainda aguardam sincronizacao."
        : null,
    });

    if (flushedAnyOperation) {
      this.dispatchFlushEvent();
    }

    if (syncedMissionIds.size > 0) {
      this.dispatchMissionSyncedEvent(Array.from(syncedMissionIds));
    }
  }

  private async flushMissionOperation(
    operation: MissionQueuedOperation,
  ): Promise<MissionSyncResponse> {
    const response = await api("/api/missions/complete", {
      method: "POST",
      body: JSON.stringify({
        mission_id: operation.payload.mission_id,
        metric_completed: operation.payload.metric_completed,
        reps_completed: operation.payload.metric_completed,
        sensor_verified: operation.payload.sensor_verified,
        operation_id: operation.operationId,
        occurred_at: operation.occurredAt,
      }),
      requestClass: "background",
    });

    const payload = (await response.json().catch(() => null)) as
      | (MissionSyncResponse & {
          error?: string | undefined;
        })
      | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? "Falha ao sincronizar missao.");
    }

    return payload ?? { success: true };
  }

  private async flushMetricBatch(batch: MetricsQueuedOperation[]): Promise<void> {
    const requestBody: OfflineSyncRequest = {
      operations: batch.map((operation) => {
        if (operation.type === "step_delta_recorded") {
          return {
            operation_id: operation.operationId,
            type: operation.type,
            user_id: operation.userId,
            occurred_at: operation.occurredAt,
            source: operation.source,
            confidence: operation.confidence,
            payload: operation.payload as MetricDeltaPayload,
          };
        }

        if (operation.type === "calorie_delta_recorded") {
          return {
            operation_id: operation.operationId,
            type: operation.type,
            user_id: operation.userId,
            occurred_at: operation.occurredAt,
            source: operation.source,
            confidence: operation.confidence,
            payload: operation.payload as MetricDeltaPayload,
          };
        }

        return {
          operation_id: operation.operationId,
          type: operation.type,
          user_id: operation.userId,
          occurred_at: operation.occurredAt,
          source: operation.source,
          confidence: operation.confidence,
          payload: operation.payload as AchievementPayload,
        };
      }),
    };

    const response = await api("/api/offline/sync", {
      method: "POST",
      body: JSON.stringify(requestBody),
      requestClass: "background",
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string | undefined }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? "Falha ao sincronizar metricas offline.");
    }
  }

  private readQueue(): QueuedOfflineOperation[] {
    const queue = readStorageValue<QueuedOfflineOperation[]>(OFFLINE_QUEUE_STORAGE_KEY, []);
    return Array.isArray(queue) ? queue : [];
  }

  private replaceQueue(nextQueue: QueuedOfflineOperation[]): void {
    writeStorageValue(OFFLINE_QUEUE_STORAGE_KEY, nextQueue);
  }

  private enqueueMissionOperation(operation: MissionQueuedOperation): MissionQueuedOperation {
    const nextQueue = [...this.state.operations];
    const existingIndex = nextQueue.findIndex(
      (item) =>
        item.type === "mission_completed" &&
        item.payload.mission_id === operation.payload.mission_id &&
        item.userId === operation.userId,
    );

    if (existingIndex >= 0) {
      const existing = nextQueue[existingIndex] as MissionQueuedOperation;
      const nextOperation: MissionQueuedOperation = {
        ...existing,
        source: operation.source,
        confidence: operation.confidence,
        syncStatus: "pending",
        payload: operation.payload,
        lastError: null,
        userId: operation.userId ?? existing.userId,
      };
      nextQueue[existingIndex] = nextOperation;
      this.replaceQueue(nextQueue);
      this.setState({
        ...this.state,
        operations: nextQueue,
        lastError: null,
      });
      return nextOperation;
    }

    nextQueue.push(operation);
    this.replaceQueue(nextQueue);
    this.setState({
      ...this.state,
      operations: nextQueue,
      lastError: null,
    });
    return operation;
  }

  private enqueueOperation(operation: QueuedOfflineOperation): void {
    const nextQueue = [...this.state.operations, operation];
    this.replaceQueue(nextQueue);
    this.setState({
      ...this.state,
      operations: nextQueue,
      lastError: null,
    });
  }

  private findMissionOperation(
    missionId: number,
    userId?: string | undefined,
  ): MissionQueuedOperation | null {
    return (
      this.state.operations.find(
        (operation): operation is MissionQueuedOperation =>
          operation.type === "mission_completed" &&
          operation.payload.mission_id === missionId &&
          operation.userId === userId,
      ) ?? null
    );
  }

  private removeOperationFromQueue(
    queue: QueuedOfflineOperation[],
    operationId: string,
  ): void {
    const index = queue.findIndex((operation) => operation.operationId === operationId);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }

  private markOperationFailed(
    queue: QueuedOfflineOperation[],
    operationId: string,
    message: string,
  ): void {
    const match = queue.find((operation) => operation.operationId === operationId);
    if (!match) return;
    match.syncStatus = "failed";
    match.lastError = message;
  }

  private readMetricsCursor(): MetricsCursor {
    return readStorageValue<MetricsCursor>(OFFLINE_METRICS_CURSOR_STORAGE_KEY, {
      date: "",
      steps: 0,
      calories: 0,
    });
  }

  private writeMetricsCursor(cursor: MetricsCursor): void {
    writeStorageValue(OFFLINE_METRICS_CURSOR_STORAGE_KEY, cursor);
  }

  clearPersistedState(): void {
    const nextState = buildDefaultState();
    this.replaceQueue(nextState.operations);
    this.writeMetricsCursor({
      date: "",
      steps: 0,
      calories: 0,
    });
    this.setState(nextState);
  }

  private dispatchFlushEvent(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(new CustomEvent(FLUSH_EVENT_NAME));
  }

  private dispatchMissionSyncedEvent(missionIds: number[]): void {
    if (typeof window === "undefined" || missionIds.length === 0) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent<OfflineMissionSyncedDetail>(MISSION_SYNCED_EVENT_NAME, {
        detail: {
          missionIds,
          syncedAt: new Date().toISOString(),
        },
      }),
    );
  }

  private setState(nextState: OfflineSyncState): void {
    this.state = nextState;
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export const offlineSyncService = new OfflineSyncService();
export const OFFLINE_SYNC_FLUSH_EVENT = FLUSH_EVENT_NAME;
export const OFFLINE_MISSION_SYNCED_EVENT = MISSION_SYNCED_EVENT_NAME;

export function shouldFlushOnLifecycle(state: HostLifecycleState): boolean {
  return state === "foreground";
}

export default offlineSyncService;
