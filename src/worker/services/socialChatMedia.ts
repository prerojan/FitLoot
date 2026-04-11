import type { Env } from "../core/types";
import {
  extractManagedStoragePathFromUrl,
  isSupabaseStorageConfigured,
  removeSupabaseStoredObject,
  uploadSupabasePublicObject,
} from "./supabaseStorage";

const SUPABASE_SOCIAL_CHAT_BUCKET = "fitloot-avatars";
const MAX_SOCIAL_CHAT_IMAGE_BYTES = 6 * 1024 * 1024;

const IMAGE_EXTENSION_BY_MIME = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export type SocialChatMediaUploadInput = {
  env: Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">;
  userId: string;
  conversationId: number;
  bytes: Uint8Array;
  mimeType: string;
};

export type StoredSocialChatMedia = {
  path: string;
  publicUrl: string;
  mediaKind: "image";
};

export function isSocialChatMediaStorageConfigured(
  env: Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">,
): boolean {
  return isSupabaseStorageConfigured(env);
}

export function extractManagedSocialChatMediaPathFromUrl(
  value: string | null | undefined,
  supabaseUrl: string | undefined,
): string | null {
  return extractManagedStoragePathFromUrl(
    value,
    supabaseUrl,
    SUPABASE_SOCIAL_CHAT_BUCKET,
  );
}

export async function storeSocialChatImage({
  env,
  userId,
  conversationId,
  bytes,
  mimeType,
}: SocialChatMediaUploadInput): Promise<StoredSocialChatMedia> {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const extension = IMAGE_EXTENSION_BY_MIME.get(normalizedMimeType);
  if (!extension) {
    throw new Error("Tipo de midia nao suportado para o chat.");
  }

  if (bytes.byteLength === 0) {
    throw new Error("Arquivo de midia vazio.");
  }

  if (bytes.byteLength > MAX_SOCIAL_CHAT_IMAGE_BYTES) {
    throw new Error("A imagem excede o limite de 6 MB.");
  }

  const storagePath = [
    "social-chat",
    "conversations",
    String(conversationId),
    userId,
    `${crypto.randomUUID()}.${extension}`,
  ].join("/");

  const publicUrl = await uploadSupabasePublicObject({
    env,
    bucket: SUPABASE_SOCIAL_CHAT_BUCKET,
    storagePath,
    body: bytes,
    contentType: normalizedMimeType,
    cacheControl: "max-age=31536000, immutable",
  });

  return {
    path: storagePath,
    publicUrl,
    mediaKind: "image",
  };
}

export async function removeStoredSocialChatMedia(
  env: Pick<Env, "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL">,
  storagePath: string,
): Promise<void> {
  await removeSupabaseStoredObject(env, SUPABASE_SOCIAL_CHAT_BUCKET, storagePath);
}
