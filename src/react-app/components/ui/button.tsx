import * as React from "react";
import { cn } from "@/react-app/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'default';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => {
    const baseClasses = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

    const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
      default: 'bg-emerald-600 text-white hover:bg-emerald-700',
      primary: 'fl-btn-primary text-white',
      secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
      outline: 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-700',
      ghost: 'hover:bg-gray-100 text-gray-700',
      danger: 'bg-red-500 text-white hover:bg-red-600',
    };

    const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
      default: 'h-10 px-4 py-2',
      sm: 'h-8 px-3 text-sm',
      lg: 'h-12 px-8',
      icon: 'h-10 w-10',
    };

    return (
      <button
        type={type}
        className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };
