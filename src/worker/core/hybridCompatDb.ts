import { DomainDbRouter } from "./domainDbRouter";
import { getErrorMessage } from "./errors";
import { isRetryableReadError, type RuntimeDatabase } from "./supabaseCompatDb";

type HybridCompatDatabaseConfig = {
  supabaseWriteDb: RuntimeDatabase;
  supabaseReadDb?: RuntimeDatabase | null;
  runtimeDb: D1Database;
  readFallbackToWrite?: boolean;
};

type PreparedMethod = "first" | "all" | "run" | "raw";

type RawOptions = { columnNames: true } | { columnNames?: false };

function toD1Database(db: RuntimeDatabase | D1Database): D1Database {
  return db as unknown as D1Database;
}

class HybridPreparedStatement {
  private boundValues: unknown[] = [];

  constructor(
    private readonly db: HybridCompatDatabase,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundValues = [...values];
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    return this.db.executePrepared<T>("first", this.query, this.boundValues, {
      colName,
    }) as Promise<T | null>;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.db.executePrepared<D1Result<T>>("all", this.query, this.boundValues);
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.db.executePrepared<D1Result<T>>("run", this.query, this.boundValues);
  }

  async raw<T = unknown[]>(
    options: RawOptions = {},
  ): Promise<T[] | [string[], ...T[]]> {
    return this.db.executePrepared<T[] | [string[], ...T[]]>(
      "raw",
      this.query,
      this.boundValues,
      { rawOptions: options },
    );
  }
}

class HybridCompatDatabase {
  readonly __backend = "supabase" as const;
  private transactionDepth = 0;
  private readonly readFallbackToWrite: boolean;
  private readonly router: DomainDbRouter;
  private readonly supabaseWriteDb: D1Database;
  private readonly supabaseReadDb: D1Database | null;
  private readonly runtimeDb: D1Database;

  constructor(config: HybridCompatDatabaseConfig) {
    this.readFallbackToWrite = config.readFallbackToWrite !== false;
    this.supabaseWriteDb = toD1Database(config.supabaseWriteDb);
    this.supabaseReadDb = config.supabaseReadDb
      ? toD1Database(config.supabaseReadDb)
      : null;
    this.runtimeDb = config.runtimeDb;
    this.router = new DomainDbRouter({
      enableReadPath: this.supabaseReadDb !== null,
    });
  }

  prepare(query: string): D1PreparedStatement {
    return new HybridPreparedStatement(this, query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const output: D1Result<T>[] = [];
    for (const statement of statements) {
      output.push(await statement.run<T>());
    }
    return output;
  }

  async exec(query: string): Promise<D1ExecResult> {
    const result = await this.prepare(query).run();
    return {
      count: Number(result.meta.changes ?? 0),
      duration: 0,
    };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession is not implemented for hybrid compatibility backend.");
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("dump is not available for hybrid compatibility backend.");
  }

  async runInTransaction<T>(run: () => Promise<T>): Promise<T> {
    const writeRuntimeDb = this.supabaseWriteDb as RuntimeDatabase;
    const executeWithTx = writeRuntimeDb.__transaction;
    this.transactionDepth += 1;

    try {
      if (typeof executeWithTx === "function") {
        return await executeWithTx(run);
      }
      return await run();
    } finally {
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);
    }
  }

  private resolvePrimaryTarget(sql: string): {
    primary: D1Database;
    fallback: D1Database | null;
  } {
    const decision = this.router.resolve(sql, {
      inTransaction: this.transactionDepth > 0,
    });

    if (decision.target === "runtime") {
      return {
        primary: this.runtimeDb,
        fallback: null,
      };
    }

    if (decision.target === "supabase_read" && this.supabaseReadDb) {
      const fallback =
        this.readFallbackToWrite && this.supabaseReadDb !== this.supabaseWriteDb
          ? this.supabaseWriteDb
          : null;
      return {
        primary: this.supabaseReadDb,
        fallback,
      };
    }

    return {
      primary: this.supabaseWriteDb,
      fallback: null,
    };
  }

  private async callTarget<T>(
    target: D1Database,
    method: PreparedMethod,
    sql: string,
    values: readonly unknown[],
    options: {
      colName?: string;
      rawOptions?: RawOptions;
    },
  ): Promise<T> {
    const statement = target.prepare(sql).bind(...values);
    if (method === "first") {
      if (typeof options.colName === "string" && options.colName.length > 0) {
        return statement.first<T>(options.colName) as Promise<T>;
      }
      return statement.first<T>() as Promise<T>;
    }
    if (method === "all") {
      return statement.all<T>() as Promise<T>;
    }
    if (method === "run") {
      return statement.run<T>() as Promise<T>;
    }
    if (options.rawOptions?.columnNames === true) {
      return statement.raw({ columnNames: true }) as Promise<T>;
    }
    return statement.raw() as Promise<T>;
  }

  async executePrepared<T>(
    method: PreparedMethod,
    sql: string,
    values: readonly unknown[],
    options: {
      colName?: string;
      rawOptions?: RawOptions;
    } = {},
  ): Promise<T> {
    const { primary, fallback } = this.resolvePrimaryTarget(sql);
    try {
      return await this.callTarget<T>(primary, method, sql, values, options);
    } catch (error) {
      if (!fallback || !isRetryableReadError(error)) {
        throw error;
      }

      console.warn("[hybrid-db][read-fallback]", {
        message: getErrorMessage(error),
        sql: sql.trim().slice(0, 120),
      });

      return this.callTarget<T>(fallback, method, sql, values, options);
    }
  }
}

export function createHybridCompatDatabase(
  config: HybridCompatDatabaseConfig,
): RuntimeDatabase {
  const hybridDb = new HybridCompatDatabase(config);
  const db = hybridDb as unknown as RuntimeDatabase;
  db.__backend = "supabase";
  db.__transaction = <T>(run: () => Promise<T>) => hybridDb.runInTransaction(run);
  return db;
}
