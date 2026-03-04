import { cn } from '@/react-app/utils';

interface AvatarProps {
  src?: string | null;
  name?: string;
  className?: string;
}

export function Avatar({ src, name, className }: AvatarProps) {
  const initials = name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

  if (src) {
    return <img src={src} alt={name || 'avatar'} className={cn('h-12 w-12 rounded-full object-cover', className)} />;
  }

  return (
    <div className={cn('h-12 w-12 rounded-full bg-white/20 text-white font-semibold flex items-center justify-center', className)}>
      {initials}
    </div>
  );
}
