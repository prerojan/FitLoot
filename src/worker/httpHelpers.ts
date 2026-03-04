import type { ContentfulStatusCode } from "hono/utils/http-status";

export function toStatusCode(status: number): ContentfulStatusCode {
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return status as ContentfulStatusCode;
  }
  return 500;
}
