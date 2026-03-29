import * as React from "react";
import { cn } from "@/react-app/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    // Primitive de input alinhado ao tema visual e aos estados de foco do app.
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-[var(--fl-auth-input-border)] bg-[var(--fl-auth-input-bg)] px-3 py-2 text-sm text-[var(--fl-color-text)] ring-offset-[var(--app-bg-color)] placeholder:text-[var(--fl-color-text-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary-color)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input };

