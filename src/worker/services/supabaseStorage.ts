import type { Env } from "../core/types";

export type SupabaseStorageEnv = Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">;

export function isSupabaseStorageConfigured(env: SupabaseStorageEnv): boolean {
  return (
    typeof env.SUPABASE_URL === "string" &&
    env.SUPABASE_URL.trim().length > 0 &&
    typeof env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
    env.SUPABASE_SERVICE_ROLE_KEY.trim().length > 0
  );
}

export function ensureSupabaseStorageConfigured(env: SupabaseStorageEnv): void {
  if (!isSupabaseStorageConfigured(env)) {
    throw new Error("Armazenamento do Supabase nao configurado.");
  }
}

export function buildSupabasePublicObjectUrl(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
): string {
  const baseUrl = supabaseUrl.trim().replace(/\/$/u, "");
  return encodeURI(
    `${baseUrl}/storage/v1/object/public/${bucket}/${storagePath.trim()}`,
  );
}

export function extractManagedStoragePathFromUrl(
  value: string | null | undefined,
  supabaseUrl: string | undefined,
  bucket: string,
): string | null {
  if (typeof value !== "string" || typeof supabaseUrl !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  const trimmedBaseUrl = supabaseUrl.trim();
  if (!trimmedValue || !trimmedBaseUrl) return null;

  try {
    const parsedValue = new URL(trimmedValue);
    const parsedBaseUrl = new URL(trimmedBaseUrl);
    if (parsedValue.origin !== parsedBaseUrl.origin) {
      return null;
    }

    const publicPrefix = `/storage/v1/object/public/${bucket}/`;
    if (!parsedValue.pathname.startsWith(publicPrefix)) {
      return null;
    }

    const path = parsedValue.pathname
      .slice(publicPrefix.length)
      .trim();
    return path.length > 0 ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

export async function uploadSupabasePublicObject({
  env,
  bucket,
  storagePath,
  body,
  contentType,
  cacheControl = "max-age=3600",
  upsert = false,
}: {
  env: SupabaseStorageEnv;
  bucket: string;
  storagePath: string;
  body: BodyInit;
  contentType: string;
  cacheControl?: string;
  upsert?: boolean;
}): Promise<string> {
  ensureSupabaseStorageConfigured(env);

  const normalizedPath = storagePath.trim();
  if (!normalizedPath) {
    throw new Error("Caminho de storage invalido.");
  }

  const baseUrl = env.SUPABASE_URL!.trim().replace(/\/$/u, "");
  const response = await fetch(
    encodeURI(`${baseUrl}/storage/v1/object/${bucket}/${normalizedPath}`),
    {
      method: "POST",
      headers: {
        ...buildSupabaseStorageHeaders(env.SUPABASE_SERVICE_ROLE_KEY!.trim()),
        "cache-control": cacheControl,
        "content-type": contentType,
        "x-upsert": upsert ? "true" : "false",
      },
      body,
    },
  );

  if (!response.ok) {
    throw new Error(await readSupabaseStorageErrorMessage(response));
  }

  return buildSupabasePublicObjectUrl(baseUrl, bucket, normalizedPath);
}

export async function removeSupabaseStoredObject(
  env: SupabaseStorageEnv,
  bucket: string,
  storagePath: string,
): Promise<void> {
  ensureSupabaseStorageConfigured(env);

  const normalizedPath = storagePath.trim();
  if (!normalizedPath) return;

  const baseUrl = env.SUPABASE_URL!.trim().replace(/\/$/u, "");
  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      ...buildSupabaseStorageHeaders(env.SUPABASE_SERVICE_ROLE_KEY!.trim()),
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: [normalizedPath] }),
  });

  if (!response.ok) {
    throw new Error(await readSupabaseStorageErrorMessage(response));
  }
}

function buildSupabaseStorageHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  };
}

async function readSupabaseStorageErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as Record<string, unknown>;
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // noop
  }

  return `Falha no storage do Supabase (${response.status}).`;
}
