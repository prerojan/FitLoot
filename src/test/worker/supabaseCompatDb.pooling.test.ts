import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function createEnv(overrides: Partial<Record<string, string>> = {}) {
  return {
    SUPABASE_DB_URL: "postgres://user:pass@db.example.com:5432/postgres",
    SUPABASE_POOL_MAX: "4",
    SUPABASE_CONNECT_TIMEOUT_MS: "8000",
    SUPABASE_IDLE_TIMEOUT_MS: "30000",
    SUPABASE_QUERY_TIMEOUT_MS: "8000",
    SUPABASE_STATEMENT_TIMEOUT_MS: "12000",
    SUPABASE_READ_MAX_ATTEMPTS: "1",
    SUPABASE_READ_RETRY_BASE_DELAY_MS: "120",
    SUPABASE_READ_RETRY_MAX_DELAY_MS: "750",
    ...overrides,
  };
}

describe("supabaseCompatDb pooled client lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("pg");
  });

  it("returns healthy clients to the pool without destroying them", async () => {
    const client: MockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [{ one: 1 }],
        rowCount: 1,
      }),
      release: vi.fn(),
    };
    const connect = vi.fn(async () => client);
    const on = vi.fn();
    const end = vi.fn(async () => undefined);
    const Pool = vi.fn().mockImplementation(() => ({
      connect,
      on,
      end,
    }));
    vi.doMock("pg", () => ({ Pool }));

    const { createSupabaseCompatDatabase } = await import("../../worker/core/supabaseCompatDb");
    const db = createSupabaseCompatDatabase(createEnv());

    const result = await db.prepare("SELECT 1 AS one").first<{ one: number }>();

    expect(result).toEqual({ one: 1 });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]).toEqual([]);
    expect(end).not.toHaveBeenCalled();
  });

  it("evicts broken clients when the query fails", async () => {
    const client: MockClient = {
      query: vi.fn().mockRejectedValue(new Error("socket hang up")),
      release: vi.fn(),
    };
    const connect = vi.fn(async () => client);
    const on = vi.fn();
    const end = vi.fn(async () => undefined);
    const Pool = vi.fn().mockImplementation(() => ({
      connect,
      on,
      end,
    }));
    vi.doMock("pg", () => ({ Pool }));

    const { createSupabaseCompatDatabase } = await import("../../worker/core/supabaseCompatDb");
    const db = createSupabaseCompatDatabase(createEnv());

    await expect(
      db.prepare("SELECT 1 AS one").first<{ one: number }>(),
    ).rejects.toThrow("socket hang up");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("recycles the cached pool after a retryable read timeout so the next attempt uses a fresh pool", async () => {
    const firstClient: MockClient = {
      query: vi.fn().mockRejectedValue(new Error("query read timeout")),
      release: vi.fn(),
    };
    const secondClient: MockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [{ one: 1 }],
        rowCount: 1,
      }),
      release: vi.fn(),
    };

    const firstPool = {
      connect: vi.fn(async () => firstClient),
      on: vi.fn(),
      end: vi.fn(async () => undefined),
    };
    const secondPool = {
      connect: vi.fn(async () => secondClient),
      on: vi.fn(),
      end: vi.fn(async () => undefined),
    };

    const Pool = vi
      .fn()
      .mockImplementationOnce(() => firstPool)
      .mockImplementationOnce(() => secondPool);
    vi.doMock("pg", () => ({ Pool }));

    const { createSupabaseCompatDatabase } = await import("../../worker/core/supabaseCompatDb");
    const db = createSupabaseCompatDatabase(createEnv({ SUPABASE_READ_MAX_ATTEMPTS: "1" }));

    await expect(
      db.prepare("SELECT 1 AS one").first<{ one: number }>(),
    ).rejects.toThrow("query read timeout");

    const retryResult = await db.prepare("SELECT 1 AS one").first<{ one: number }>();

    expect(retryResult).toEqual({ one: 1 });
    expect(firstClient.release).toHaveBeenCalledWith(true);
    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(secondPool.connect).toHaveBeenCalledTimes(1);
    expect(secondClient.release).toHaveBeenCalledTimes(1);
  });

  it("retries the same read with a fresh pool when local retry budget allows it", async () => {
    const firstClient: MockClient = {
      query: vi.fn().mockRejectedValue(new Error("query read timeout")),
      release: vi.fn(),
    };
    const secondClient: MockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [{ one: 1 }],
        rowCount: 1,
      }),
      release: vi.fn(),
    };

    const firstPool = {
      connect: vi.fn(async () => firstClient),
      on: vi.fn(),
      end: vi.fn(async () => undefined),
    };
    const secondPool = {
      connect: vi.fn(async () => secondClient),
      on: vi.fn(),
      end: vi.fn(async () => undefined),
    };

    const Pool = vi
      .fn()
      .mockImplementationOnce(() => firstPool)
      .mockImplementationOnce(() => secondPool);
    vi.doMock("pg", () => ({ Pool }));

    const { createSupabaseCompatDatabase } = await import("../../worker/core/supabaseCompatDb");
    const db = createSupabaseCompatDatabase(createEnv({ SUPABASE_READ_MAX_ATTEMPTS: "2" }));

    const result = await db.prepare("SELECT 1 AS one").first<{ one: number }>();

    expect(result).toEqual({ one: 1 });
    expect(firstClient.release).toHaveBeenCalledWith(true);
    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(secondClient.release).toHaveBeenCalledTimes(1);
    expect(Pool).toHaveBeenCalledTimes(2);
  });
});
