import * as React from "react";
import { cn } from "@/react-app/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'soft';
}

const toneClasses: Record<NonNullable<CardProps['tone']>, string> = {
  default: 'fl-card',
  soft: 'fl-card-soft',
};

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  // Wrapper minimo para superfices reutilizaveis com dois tons padrao.
  ({ className, tone = 'default', ...props }, ref) => (
    <div ref={ref} className={cn(toneClasses[tone], className)} {...props} />
  )
);

Card.displayName = "Card";

export { Card };
