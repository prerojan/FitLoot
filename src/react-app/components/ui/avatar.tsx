import { useEffect, useState } from "react";

import { cn } from "@/react-app/utils";
import { resolveApiRequestUrl } from "@/react-app/utils/api";

interface AvatarProps {
  src?: string | null | undefined;
  name?: string | undefined;
  className?: string | undefined;
}

export function Avatar({ src, name, className }: AvatarProps) {
  const normalizedSrc = normalizeAvatarSrc(src);
  const [imageErrored, setImageErrored] = useState(false);

  useEffect(() => {
    setImageErrored(false);
  }, [normalizedSrc]);

  // Deriva iniciais legiveis quando o usuario nao possui imagem carregada.
  const initials = name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

  if (normalizedSrc && !imageErrored) {
    return (
      <img
        src={normalizedSrc}
        alt={name || "avatar"}
        className={cn("h-12 w-12 rounded-full object-cover", className)}
        decoding="async"
        loading="lazy"
        onError={() => {
          setImageErrored(true);
        }}
      />
    );
  }

  // Fallback visual padrao para perfis sem avatar remoto.
  return (
    <div
      className={cn('flex h-12 w-12 items-center justify-center rounded-full font-semibold', className)}
      style={{
        background: 'color-mix(in srgb, var(--app-primary-color) 18%, var(--fl-surface-strong))',
        color: 'var(--fl-color-text)',
      }}
    >
      {initials}
    </div>
  );
}

function normalizeAvatarSrc(src: string | null | undefined): string | null {
  if (typeof src !== "string") return null;
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return resolveApiRequestUrl(trimmed);
  }
  return trimmed;
}
