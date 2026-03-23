import * as React from 'react';

type BadgeVariant = 'default' | 'success' | 'destructive' | 'outline' | 'vfr' | 'ifr';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-muted text-foreground',
  success: 'bg-success/20 text-success',
  destructive: 'bg-destructive/20 text-destructive',
  outline: 'border border-border text-muted-foreground',
  vfr: 'bg-success/20 text-success',
  ifr: 'bg-primary/20 text-primary',
};

export function Badge({ variant = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </span>
  );
}
