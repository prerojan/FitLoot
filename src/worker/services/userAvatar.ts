import type { Env } from "../core/types";
import {
  ensureSupabaseStorageConfigured,
  extractManagedStoragePathFromUrl,
  isSupabaseStorageConfigured,
  removeSupabaseStoredObject,
  uploadSupabasePublicObject,
} from "./supabaseStorage";

const SUPABASE_AVATAR_BUCKET = "fitloot-avatars";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const AVATAR_EXTENSION_BY_MIME = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export type AvatarUploadInput = {
  env: Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">;
  imageBase64: string;
  imageMimeType: string;
  userId: string;
};

export type StoredAvatar = {
  path: string;
  publicUrl: string;
};

export function isSupabaseAvatarStorageConfigured(
  env: Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">,
): boolean {
  return isSupabaseStorageConfigured(env);
}

export function extractManagedAvatarPathFromUrl(
  value: string | null | undefined,
  supabaseUrl: string | undefined,
): string | null {
  return extractManagedStoragePathFromUrl(value, supabaseUrl, SUPABASE_AVATAR_BUCKET);
}

export async function storeUserAvatar({
  env,
  imageBase64,
  imageMimeType,
  userId,
}: AvatarUploadInput): Promise<StoredAvatar> {
  ensureSupabaseAvatarStorageConfigured(env);

  const mimeType = imageMimeType.trim().toLowerCase();
  const extension = AVATAR_EXTENSION_BY_MIME.get(mimeType);
  if (!extension) {
    throw new Error("Tipo de imagem nao suportado para avatar.");
  }

  const bytes = decodeAvatarBase64(imageBase64);
  const storagePath = `users/${userId}/avatar-${crypto.randomUUID()}.${extension}`;

  return {
    path: storagePath,
    publicUrl: await uploadSupabasePublicObject({
      env,
      bucket: SUPABASE_AVATAR_BUCKET,
      storagePath,
      body: bytes,
      contentType: mimeType,
    }),
  };
}

export async function removeStoredAvatar(
  env: Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">,
  storagePath: string,
): Promise<void> {
  await removeSupabaseStoredObject(env, SUPABASE_AVATAR_BUCKET, storagePath);
}

function ensureSupabaseAvatarStorageConfigured(
  env: Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">,
): void {
  ensureSupabaseStorageConfigured(env);
}

function decodeAvatarBase64(value: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Imagem de avatar vazia.");
  }

  let decoded: string;
  try {
    decoded = atob(normalized);
  } catch {
    throw new Error("Nao foi possivel decodificar o avatar enviado.");
  }

  if (decoded.length === 0) {
    throw new Error("Imagem de avatar vazia.");
  }
  if (decoded.length > MAX_AVATAR_BYTES) {
    throw new Error("Avatar excede o limite de 2 MB.");
  }

  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}
