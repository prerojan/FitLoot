import type { Env } from "../core/types";

export type WithTransaction = <T>(
  db: D1Database,
  run: () => Promise<T>,
  env?: Pick<Env, "DB_BACKEND"> | undefined,
) => Promise<T>;
