export type WithTransaction = <T>(
  db: D1Database,
  run: () => Promise<T>,
) => Promise<T>;
