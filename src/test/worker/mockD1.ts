type QueryMatcher = string | RegExp | ((sql: string) => boolean);
type QueryMethod = "first" | "all" | "run";

type QueryResolver =
  | unknown
  | ((params: unknown[], sql: string, method: QueryMethod) => unknown | Promise<unknown>);

export type QueryHandler = {
  match: QueryMatcher;
  first?: QueryResolver;
  all?: QueryResolver;
  run?: QueryResolver;
};

export type QueryCall = {
  sql: string;
  params: unknown[];
  method: QueryMethod;
};

function matchesQuery(matcher: QueryMatcher, sql: string): boolean {
  if (typeof matcher === "string") {
    return sql.includes(matcher);
  }

  if (matcher instanceof RegExp) {
    return matcher.test(sql);
  }

  return matcher(sql);
}

async function resolveQueryResult(
  resolver: QueryResolver | undefined,
  params: unknown[],
  sql: string,
  method: QueryMethod,
) {
  if (typeof resolver === "function") {
    return await resolver(params, sql, method);
  }

  return resolver;
}

export function createMockD1Database(handlers: QueryHandler[]) {
  const calls: QueryCall[] = [];

  const findHandler = (sql: string) => handlers.find((handler) => matchesQuery(handler.match, sql));

  const database = {
    prepare(sql: string) {
      let params: unknown[] = [];

      return {
        bind(...boundParams: unknown[]) {
          params = boundParams;
          return this;
        },
        async first<T = unknown>() {
          calls.push({ sql, params, method: "first" });
          const handler = findHandler(sql);
          if (!handler) {
            throw new Error(`Missing D1 mock handler for first(): ${sql}`);
          }
          return (await resolveQueryResult(handler.first, params, sql, "first")) as T | null;
        },
        async all<T = unknown>() {
          calls.push({ sql, params, method: "all" });
          const handler = findHandler(sql);
          if (!handler) {
            throw new Error(`Missing D1 mock handler for all(): ${sql}`);
          }
          const result = await resolveQueryResult(handler.all, params, sql, "all");
          if (result && typeof result === "object" && "results" in (result as Record<string, unknown>)) {
            return result as { results: T[] };
          }
          return { results: Array.isArray(result) ? (result as T[]) : [] };
        },
        async run() {
          calls.push({ sql, params, method: "run" });
          const handler = findHandler(sql);
          if (!handler) {
            throw new Error(`Missing D1 mock handler for run(): ${sql}`);
          }
          const result = await resolveQueryResult(handler.run, params, sql, "run");
          return (result ?? { success: true, meta: {} }) as D1Result;
        },
      };
    },
  } as unknown as D1Database;

  return { db: database, calls };
}
