import type { Context } from "hono";

import type { AppContext } from "./types";

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const INVALID_PROMO_CODE_ERROR = "PROMO_CODE_INVALID";

export function createInvalidPromoCodeError(): Error {
  return new Error(INVALID_PROMO_CODE_ERROR);
}

export function isInvalidPromoCodeError(error: unknown): boolean {
  return getErrorMessage(error) === INVALID_PROMO_CODE_ERROR;
}

export function isMissingSchemaError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("no such column") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

export function schemaMismatchResponse(c: Context<AppContext>) {
  return c.json(
    {
      error: "Banco local desatualizado para esta funcionalidade.",
      code: "DB_SCHEMA_MISMATCH",
    },
    503,
  );
}

export function internalErrorResponse(c: Context<AppContext>) {
  return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
}
