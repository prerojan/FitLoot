import { cn } from '@/react-app/utils';

interface AvatarProps {
  src?: string | null | undefined;
  name?: string | undefined;
  className?: string | undefined;
}

export function Avatar({ src, name, className }: AvatarProps) {
  // Deriva iniciais legiveis quando o usuario nao possui imagem carregada.
  const initials = name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

  if (src) {
    return <img src={src} alt={name || 'avatar'} className={cn('h-12 w-12 rounded-full object-cover', className)} />;
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
