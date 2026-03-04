import * as React from 'react';
import { cn } from '@/react-app/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'neutral';
}

const variants: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-emerald-100 text-emerald-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-700',
};

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', variants[variant], className)}
      {...props}
    />
  );
}
